//! Windows recording stays on native D3D surfaces. The capture pool has two
//! buffers, the handoff holds only the latest frame, and Media Foundation owns
//! at most six reusable input surfaces. No frame bytes cross the webview IPC.

use anyhow::{Context, Result, anyhow, bail};
use parking_lot::Mutex;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::SyncSender,
    },
    thread,
    time::{Duration, Instant},
};
use windows::{
    Foundation::TypedEventHandler,
    Graphics::{
        Capture::{
            Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem,
            GraphicsCaptureSession, IDirect3D11CaptureFramePoolStatics2,
            IGraphicsCaptureSessionStatics,
        },
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        SizeInt32,
    },
    Win32::{
        Foundation::{HMODULE, HWND},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_UNKNOWN,
            Direct3D10::ID3D10Multithread,
            Direct3D11::*,
            Dxgi::{
                Common::*, CreateDXGIFactory1, IDXGIAdapter1, IDXGIDevice, IDXGIFactory1,
                IDXGIOutput6,
            },
            Gdi::{HMONITOR, MONITOR_DEFAULTTONEAREST, MonitorFromWindow},
        },
        Media::MediaFoundation::*,
        System::WinRT::{
            Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
            Graphics::Capture::IGraphicsCaptureItemInterop,
            RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize,
        },
        UI::WindowsAndMessaging::{IsIconic, IsWindow},
    },
    core::{GUID, Interface, PCWSTR, factory},
};

#[path = "color.rs"]
mod color;

/// Resolve these WinRT factories in the current apartment. The projected
/// static methods cache factories across calls, which can outlive the last
/// initialized apartment when an isolated recording worker exits.
pub fn capture_supported() -> windows::core::Result<bool> {
    let statics = factory::<GraphicsCaptureSession, IGraphicsCaptureSessionStatics>()?;
    let mut supported = false;
    unsafe {
        (statics.vtable().IsSupported)(statics.as_raw(), &mut supported).ok()?;
    }
    Ok(supported)
}

fn frame_pool(
    device: &IDirect3DDevice,
    size: SizeInt32,
) -> windows::core::Result<Direct3D11CaptureFramePool> {
    let statics = factory::<Direct3D11CaptureFramePool, IDirect3D11CaptureFramePoolStatics2>()?;
    let mut pool = std::ptr::null_mut();
    unsafe {
        (statics.vtable().CreateFreeThreaded)(
            statics.as_raw(),
            device.as_raw(),
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
            &mut pool,
        )
        .ok()?;
        windows::core::Type::from_abi(pool)
    }
}

#[derive(Clone, Debug)]
pub enum Source {
    /// The native display name returned by EnumDisplayMonitors, e.g. \\.\DISPLAY1.
    Monitor(String),
    Window(isize),
}

pub struct Options {
    pub source: Source,
    pub path: PathBuf,
    pub fps: u32,
    pub cursor: bool,
}

#[derive(Debug)]
pub struct Started {
    pub width: u32,
    pub height: u32,
    pub encoder: String,
}

#[derive(Debug)]
pub struct Finished {
    pub frames: u64,
    pub duration_ms: u64,
}

#[derive(Default)]
pub struct Progress {
    pub frames: AtomicU64,
    pub dropped_frames: AtomicU64,
    pub duration_ms: AtomicU64,
}

/// Run on a dedicated background thread. All COM and graphics objects are
/// created and released on that thread; only atomic controls cross threads.
pub fn run(
    options: Options,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    ready: SyncSender<std::result::Result<Started, String>>,
    progress: Arc<Progress>,
) -> Result<Finished> {
    let mut notified = false;
    let result = run_inner(options, stop, paused, &ready, &mut notified, progress);
    if !notified {
        let message = result
            .as_ref()
            .err()
            .map(|e| format!("{e:#}"))
            .unwrap_or_else(|| "Recording was stopped before it could start.".into());
        let _ = ready.send(Err(message));
    }
    result
}

struct Runtime;
impl Runtime {
    fn new() -> Result<Self> {
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED).context("Initialize Windows capture")?;
            if let Err(error) = MFStartup(MF_VERSION, MFSTARTUP_FULL) {
                RoUninitialize();
                return Err(error).context("Initialize Media Foundation");
            }
        }
        Ok(Self)
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        unsafe {
            let _ = MFShutdown();
            RoUninitialize();
        }
    }
}

/// Releasing an interface alone does not return a WGC buffer to its pool.
struct CaptureFrame(Direct3D11CaptureFrame);
impl Drop for CaptureFrame {
    fn drop(&mut self) {
        let _ = self.0.Close();
    }
}

struct Capture {
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    item: GraphicsCaptureItem,
    arrived: i64,
    closed: i64,
    latest: Arc<Mutex<Option<CaptureFrame>>>,
    ended: Arc<AtomicBool>,
}
impl Capture {
    fn new(device: &IDirect3DDevice, item: GraphicsCaptureItem, cursor: bool) -> Result<Self> {
        let size = item.Size()?;
        let pool = frame_pool(device, size)?;
        let session = pool.CreateCaptureSession(&item)?;
        session
            .SetIsCursorCaptureEnabled(cursor)
            .context("Configure cursor capture (Windows 10 2004 or newer is required)")?;
        let latest: Arc<Mutex<Option<CaptureFrame>>> = Arc::default();
        let pending = latest.clone();
        let arrived = pool.FrameArrived(&TypedEventHandler::new(
            move |sender: windows::core::Ref<Direct3D11CaptureFramePool>, _| {
                if let Some(pool) = sender.as_ref() {
                    if let Ok(frame) = pool.TryGetNextFrame() {
                        *pending.lock() = Some(CaptureFrame(frame));
                    }
                }
                Ok(())
            },
        ))?;
        let ended = Arc::new(AtomicBool::new(false));
        let closed_flag = ended.clone();
        let closed = item.Closed(&TypedEventHandler::new(move |_, _| {
            closed_flag.store(true, Ordering::Release);
            Ok(())
        }))?;
        Ok(Self {
            pool,
            session,
            item,
            arrived,
            closed,
            latest,
            ended,
        })
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.RemoveFrameArrived(self.arrived);
        let _ = self.item.RemoveClosed(self.closed);
        self.latest.lock().take();
        let _ = self.pool.Close();
    }
}

fn run_inner(
    options: Options,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    ready: &SyncSender<std::result::Result<Started, String>>,
    notified: &mut bool,
    progress: Arc<Progress>,
) -> Result<Finished> {
    if !matches!(options.fps, 30 | 60) {
        bail!("Choose 30 or 60 frames per second.");
    }
    if stop.load(Ordering::Acquire) {
        bail!("Recording was cancelled.");
    }
    let _runtime = Runtime::new()?;
    if !capture_supported().context("Check Windows Graphics Capture support")? {
        bail!("Windows Graphics Capture is unavailable on this desktop.");
    }
    let (adapter, monitor) =
        source_adapter(&options.source).context("Locate the recording source graphics adapter")?;
    let interop: IGraphicsCaptureItemInterop =
        factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
            .context("Activate Windows capture interop")?;
    let item: GraphicsCaptureItem = unsafe {
        match &options.source {
            Source::Monitor(_) => interop
                .CreateForMonitor(monitor)
                .context("Create the monitor capture source")?,
            Source::Window(handle) => interop
                .CreateForWindow(HWND(*handle as *mut _))
                .context("Create the window capture source")?,
        }
    };
    let original = item.Size().context("Read recording source size")?;
    // H.264 4:2:0 requires even dimensions. Never scale text: remove at most a
    // single right/bottom pixel, and report the real output size to the UI.
    let width = (original.Width.max(0) as u32) & !1;
    let height = (original.Height.max(0) as u32) & !1;
    if width < 2 || height < 2 || width > 4096 || height > 4096 {
        bail!("Select a source between 2 and 4096 pixels in each dimension.");
    }
    let (device, context) = create_device(&adapter).context("Create recording D3D11 device")?;
    let dxgi: IDXGIDevice = device.cast().context("Access recording DXGI device")?;
    let winrt_device: IDirect3DDevice = unsafe {
        CreateDirect3D11DeviceFromDXGIDevice(&dxgi)
            .context("Bridge recording D3D11 device to WinRT")?
            .cast()
            .context("Access recording WinRT D3D11 device")?
    };
    let capture = Capture::new(&winrt_device, item, options.cursor)
        .context("Create the Windows capture frame pool")?;
    let last = create_texture(&device, width, height)?;
    let mut encoder = Encoder::new(&device, &context, &last, &options.path, width, height, options.fps)
        .context("Create a hardware H.264 recorder; try 30 fps or a smaller source if your GPU cannot encode this size")?;
    capture
        .session
        .StartCapture()
        .context("Start Windows screen capture")?;
    let first_deadline = Instant::now() + Duration::from_secs(10);
    let first = loop {
        if stop.load(Ordering::Acquire) {
            bail!("Recording was cancelled.");
        }
        if capture.ended.load(Ordering::Acquire) {
            bail!("The selected source closed before recording began.");
        }
        if let Some(frame) = capture.latest.lock().take() {
            break frame;
        }
        if Instant::now() >= first_deadline {
            bail!("The source did not produce a frame. Restore the selected window and try again.");
        }
        thread::sleep(Duration::from_millis(5));
    };
    check_size(&first.0, original.Width, original.Height)?;
    copy_capture(&context, &first.0, &last, width, height)
        .context("Copy first capture frame to a recording surface")?;
    drop(first);
    let start = Instant::now();
    let mut timeline = Timeline::new(start);
    let frame_duration = Duration::from_nanos(1_000_000_000 / u64::from(options.fps));
    let sample_duration = 10_000_000i64 / i64::from(options.fps);
    let mut due = start;
    let mut frames = 0u64;
    let mut last_timestamp = 0i64;
    // Warm up the real path before reporting success. A silent software
    // fallback is rejected by Encoder::new, before any frame is accepted.
    encoder
        .write(&context, &last, 0, sample_duration)
        .context("Encode the first recording frame")?;
    frames += 1;
    progress.frames.store(frames, Ordering::Release);
    *notified = true;
    let _ = ready.send(Ok(Started {
        width,
        height,
        encoder: encoder.name.clone(),
    }));
    due += frame_duration;
    let mut next_source_check = start;
    let mut outcome = (|| -> Result<()> {
        while !stop.load(Ordering::Acquire) && !capture.ended.load(Ordering::Acquire) {
            let now = Instant::now();
            if now >= next_source_check {
                // Some Windows builds leave the frame pool alive after the
                // source HWND is destroyed without delivering Closed promptly.
                if let Source::Window(handle) = &options.source {
                    if !unsafe { IsWindow(Some(HWND(*handle as *mut _))) }.as_bool() {
                        break;
                    }
                }
                next_source_check = now + Duration::from_millis(200);
            }
            let is_paused = paused.load(Ordering::Acquire);
            let elapsed = timeline.elapsed(now, is_paused);
            if is_paused {
                // Drain the frozen pool even while paused; the newest source
                // image is ready immediately when recording resumes.
                if let Some(frame) = capture.latest.lock().take() {
                    check_size(&frame.0, original.Width, original.Height)?;
                    copy_capture(&context, &frame.0, &last, width, height)?;
                }
                due = now;
                thread::sleep(Duration::from_millis(10));
                continue;
            }
            if now.saturating_duration_since(due) > Duration::from_secs(5) {
                bail!(
                    "Recording was interrupted for more than five seconds, possibly by sleep or a graphics-driver stall. Start a new recording to continue."
                );
            }
            if now < due {
                thread::sleep((due - now).min(Duration::from_millis(5)));
                continue;
            }
            if let Some(frame) = capture.latest.lock().take() {
                check_size(&frame.0, original.Width, original.Height)?;
                copy_capture(&context, &frame.0, &last, width, height)?;
            }
            let timestamp = (elapsed.as_nanos() / 100).min(i64::MAX as u128) as i64;
            match encoder.write(
                &context,
                &last,
                timestamp.max(last_timestamp + 1),
                sample_duration,
            ) {
                Ok(()) => {
                    frames += 1;
                    last_timestamp = timestamp.max(last_timestamp + 1);
                    progress.frames.store(frames, Ordering::Release);
                }
                Err(error)
                    if error
                        .downcast_ref::<windows::core::Error>()
                        .is_some_and(|e| e.code() == MF_E_SAMPLEALLOCATOR_EMPTY) =>
                {
                    // All six input surfaces are still owned by the encoder.
                    // Drop this raw frame and preserve the wall-clock timestamp.
                    progress.dropped_frames.fetch_add(1, Ordering::Relaxed);
                }
                Err(error) => return Err(error).context("Encode recording frame"),
            }
            progress.duration_ms.store(
                elapsed.as_millis().min(u64::MAX as u128) as u64,
                Ordering::Release,
            );
            due += frame_duration;
            let after = Instant::now();
            if after.saturating_duration_since(now) > Duration::from_secs(5) {
                bail!(
                    "The recording encoder stalled for more than five seconds. Start a new recording to continue."
                );
            }
            if after.saturating_duration_since(due) > frame_duration {
                let missed =
                    (after.duration_since(due).as_nanos() / frame_duration.as_nanos()) as u64;
                progress.dropped_frames.fetch_add(missed, Ordering::Relaxed);
                // Never catch up by encoding a burst of stale frames.
                due = after + frame_duration;
            }
        }
        Ok(())
    })();
    let elapsed = timeline.elapsed(Instant::now(), paused.load(Ordering::Acquire));
    // A final held frame preserves the end of a static screen, and paused time
    // remains excluded. Fragmented MP4 retains completed fragments on a crash.
    let end_timestamp = (elapsed.as_nanos() / 100).min(i64::MAX as u128) as i64;
    if outcome.is_ok() && end_timestamp > last_timestamp + sample_duration {
        match encoder.write(&context, &last, end_timestamp, sample_duration) {
            Ok(()) => frames += 1,
            Err(error)
                if error
                    .downcast_ref::<windows::core::Error>()
                    .is_some_and(|e| e.code() == MF_E_SAMPLEALLOCATOR_EMPTY) => {}
            Err(error) => outcome = Err(error).context("Encode the final recording frame"),
        }
    }
    drop(capture);
    let finalized = encoder.finish().context("Finalize recording; completed MP4 fragments remain in the recording file if finalization failed");
    if let Err(error) = outcome {
        return match finalized {
            Ok(()) => Err(error),
            Err(finalize_error) => Err(error.context(format!("{finalize_error:#}"))),
        };
    }
    finalized?;
    let duration_ms = elapsed.as_millis().min(u64::MAX as u128) as u64;
    progress.frames.store(frames, Ordering::Release);
    progress.duration_ms.store(duration_ms, Ordering::Release);
    Ok(Finished {
        frames,
        duration_ms,
    })
}

fn check_size(frame: &Direct3D11CaptureFrame, width: i32, height: i32) -> Result<()> {
    let size = frame.ContentSize()?;
    if size.Width != width || size.Height != height {
        bail!(
            "The source changed size. Recording was stopped to preserve its original pixel dimensions."
        );
    }
    Ok(())
}

fn source_adapter(source: &Source) -> Result<(IDXGIAdapter1, HMONITOR)> {
    let wanted_monitor = if let Source::Window(handle) = source {
        let window = HWND(*handle as *mut _);
        unsafe {
            if !IsWindow(Some(window)).as_bool() || IsIconic(window).as_bool() {
                bail!("Restore the selected window before recording.");
            }
            Some(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST))
        }
    } else {
        None
    };
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let mut adapter_index = 0;
    while let Ok(adapter) = unsafe { factory.EnumAdapters1(adapter_index) } {
        let mut output_index = 0;
        while let Ok(output) = unsafe { adapter.EnumOutputs(output_index) } {
            let desc = unsafe { output.GetDesc()? };
            let device_name = String::from_utf16_lossy(&desc.DeviceName)
                .trim_end_matches('\0')
                .to_owned();
            let selected = match source {
                Source::Monitor(name) => name == &device_name,
                Source::Window(_) => wanted_monitor == Some(desc.Monitor),
            };
            if selected && desc.AttachedToDesktop.as_bool() {
                if let Ok(output6) = output.cast::<IDXGIOutput6>() {
                    let color = unsafe { output6.GetDesc1()? }.ColorSpace;
                    if color == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020
                        || color == DXGI_COLOR_SPACE_RGB_FULL_G10_NONE_P709
                    {
                        bail!(
                            "HDR recording is not available yet. Turn off HDR for the selected display before recording to preserve accurate colors."
                        );
                    }
                }
                return Ok((adapter, desc.Monitor));
            }
            output_index += 1;
        }
        adapter_index += 1;
    }
    bail!("The selected display is no longer connected. Refresh the recording sources.")
}

fn create_device(adapter: &IDXGIAdapter1) -> Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    let device = device.context("D3D11 did not return a graphics device")?;
    let context = context.context("D3D11 did not return a graphics context")?;
    // WGC and the hardware encoder use the same device from their own threads.
    let multithread: ID3D10Multithread = device.cast()?;
    unsafe {
        let _ = multithread.SetMultithreadProtected(true);
    }
    Ok((device, context))
}

fn create_texture(device: &ID3D11Device, width: u32, height: u32) -> Result<ID3D11Texture2D> {
    let mut texture = None;
    unsafe {
        device.CreateTexture2D(
            &D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET).0 as u32,
                ..Default::default()
            },
            None,
            Some(&mut texture),
        )?;
    }
    texture.context("D3D11 did not return a texture")
}

fn copy_capture(
    context: &ID3D11DeviceContext,
    frame: &Direct3D11CaptureFrame,
    destination: &ID3D11Texture2D,
    width: u32,
    height: u32,
) -> Result<()> {
    let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
    let source: ID3D11Texture2D = unsafe { access.GetInterface()? };
    unsafe {
        context.CopySubresourceRegion(
            destination,
            0,
            0,
            0,
            0,
            &source,
            0,
            Some(&D3D11_BOX {
                left: 0,
                top: 0,
                front: 0,
                right: width,
                bottom: height,
                back: 1,
            }),
        );
    }
    Ok(())
}

struct Encoder {
    writer: IMFSinkWriter,
    allocator: IMFVideoSampleAllocatorEx,
    _manager: IMFDXGIDeviceManager,
    stream: u32,
    name: String,
    converter: color::Converter,
    finished: bool,
}
impl Encoder {
    fn new(
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        source: &ID3D11Texture2D,
        path: &std::path::Path,
        width: u32,
        height: u32,
        fps: u32,
    ) -> Result<Self> {
        let converter = color::Converter::new(device, context, source, width, height, fps)?;
        unsafe {
            let mut manager = None;
            let mut reset_token = 0;
            MFCreateDXGIDeviceManager(&mut reset_token, &mut manager)?;
            let manager = manager.context("Missing DXGI device manager")?;
            manager.ResetDevice(device, reset_token)?;
            let mut attributes = None;
            MFCreateAttributes(&mut attributes, 6)?;
            let attributes = attributes.context("Missing encoder attributes")?;
            attributes.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)?;
            attributes.SetUnknown(&MF_SINK_WRITER_D3D_MANAGER, &manager)?;
            attributes.SetUINT32(&MF_LOW_LATENCY, 1)?;
            attributes.SetGUID(
                &MF_TRANSCODE_CONTAINERTYPE,
                &MFTranscodeContainerType_FMPEG4,
            )?;
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            let writer = MFCreateSinkWriterFromURL(PCWSTR(wide.as_ptr()), None, &attributes)
                .context("Create fragmented MP4 sink")?;
            let output = media_type(width, height, fps, &MFVideoFormat_H264)?;
            let bitrate = (u64::from(width) * u64::from(height) * u64::from(fps) / 6)
                .clamp(8_000_000, 100_000_000) as u32;
            output.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            output.SetUINT32(&MF_MT_MPEG2_PROFILE, 100)?; // H.264 High profile.
            let stream = writer
                .AddStream(&output)
                .context("Configure H.264 output stream")?;
            let input = media_type(width, height, fps, &MFVideoFormat_NV12)?;
            input.SetUINT32(&MF_MT_FIXED_SIZE_SAMPLES, 1)?;
            input.SetUINT32(&MF_MT_SAMPLE_SIZE, width * height * 3 / 2)?;
            // NV12 comes from our GPU processor. Media Foundation rejects a
            // disable-converters attribute together with hardware transforms,
            // so verify the actual transform chain after negotiation instead.
            writer
                .SetInputMediaType(stream, &input, None)
                .context("Negotiate GPU NV12 encoder input")?;
            let name = hardware_encoder_name(&writer, stream)?;
            let mut raw = std::ptr::null_mut();
            MFCreateVideoSampleAllocatorEx(&IMFVideoSampleAllocatorEx::IID, &mut raw)?;
            let allocator = IMFVideoSampleAllocatorEx::from_raw(raw);
            allocator.SetDirectXManager(&manager)?;
            let mut allocator_attributes = None;
            MFCreateAttributes(&mut allocator_attributes, 2)?;
            let allocator_attributes =
                allocator_attributes.context("Missing sample allocator attributes")?;
            allocator_attributes.SetUINT32(&MF_SA_D3D11_USAGE, D3D11_USAGE_DEFAULT.0 as u32)?;
            allocator_attributes
                .SetUINT32(&MF_SA_D3D11_BINDFLAGS, D3D11_BIND_RENDER_TARGET.0 as u32)?;
            allocator
                .InitializeSampleAllocatorEx(3, 6, &allocator_attributes, &input)
                .context("Initialize six bounded NV12 encoder surfaces")?;
            writer
                .BeginWriting()
                .context("Begin writing hardware-encoded MP4")?;
            Ok(Self {
                writer,
                allocator,
                _manager: manager,
                stream,
                name,
                converter,
                finished: false,
            })
        }
    }
    fn write(
        &mut self,
        _context: &ID3D11DeviceContext,
        _source: &ID3D11Texture2D,
        timestamp: i64,
        duration: i64,
    ) -> Result<()> {
        unsafe {
            let sample = self
                .allocator
                .AllocateSample()
                .context("Allocate a bounded recording sample")?;
            let media_buffer = sample
                .GetBufferByIndex(0)
                .context("Access recording sample buffer")?;
            let buffer: IMFDXGIBuffer = media_buffer
                .cast()
                .context("Access recording sample GPU surface")?;
            let mut raw = std::ptr::null_mut();
            buffer
                .GetResource(&ID3D11Texture2D::IID, &mut raw)
                .context("Access recording sample texture")?;
            let destination = ID3D11Texture2D::from_raw(raw);
            let subresource = buffer
                .GetSubresourceIndex()
                .context("Read recording sample texture index")?;
            self.converter.convert(&destination, subresource)?;
            media_buffer
                .SetCurrentLength(media_buffer.GetMaxLength()?)
                .context("Set recording sample buffer length")?;
            sample
                .SetSampleTime(timestamp)
                .context("Set recording sample timestamp")?;
            sample
                .SetSampleDuration(duration)
                .context("Set recording sample duration")?;
            self.writer
                .WriteSample(self.stream, &sample)
                .context("Submit recording sample to the hardware encoder")?;
        }
        Ok(())
    }
    fn finish(&mut self) -> Result<()> {
        if !self.finished {
            self.finished = true;
            let finalized = unsafe { self.writer.Finalize() };
            let released = unsafe { self.allocator.UninitializeSampleAllocator() };
            finalized?;
            released?;
        }
        Ok(())
    }
}
impl Drop for Encoder {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

use std::os::windows::ffi::OsStrExt;

unsafe fn media_type(width: u32, height: u32, fps: u32, subtype: &GUID) -> Result<IMFMediaType> {
    unsafe {
        let ty = MFCreateMediaType()?;
        ty.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        ty.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        ty.SetUINT64(
            &MF_MT_FRAME_SIZE,
            (u64::from(width) << 32) | u64::from(height),
        )?;
        ty.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(fps) << 32) | 1)?;
        ty.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
        ty.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        ty.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32)?;
        ty.SetUINT32(&MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709.0 as u32)?;
        ty.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
        // Full-range desktop RGB input is converted to conventional video range
        // for H.264, with explicit metadata instead of driver-specific guesses.
        ty.SetUINT32(
            &MF_MT_VIDEO_NOMINAL_RANGE,
            if subtype == &MFVideoFormat_ARGB32 {
                MFNominalRange_0_255.0 as u32
            } else {
                MFNominalRange_16_235.0 as u32
            },
        )?;
        Ok(ty)
    }
}

unsafe fn hardware_encoder_name(writer: &IMFSinkWriter, stream: u32) -> Result<String> {
    unsafe {
        let extended: IMFSinkWriterEx = writer.cast()?;
        for index in 0..16 {
            let mut transform = None;
            let mut category = GUID::zeroed();
            if extended
                .GetTransformForStream(stream, index, Some(&mut category), &mut transform)
                .is_err()
            {
                break;
            }
            if category == MFT_CATEGORY_VIDEO_PROCESSOR {
                bail!(
                    "Windows inserted a second video conversion stage. The selected hardware encoder cannot consume this GPU format directly."
                );
            }
            if category == MFT_CATEGORY_VIDEO_ENCODER {
                let attributes = transform
                    .context("Missing video encoder transform")?
                    .GetAttributes()?;
                // Microsoft requires hardware MFTs to expose this attribute.
                // Enable-hardware alone allows a silent software fallback.
                if attributes
                    .GetStringLength(&MFT_ENUM_HARDWARE_URL_Attribute)
                    .is_err()
                {
                    bail!(
                        "No compatible hardware H.264 encoder was selected. Update your graphics driver or choose a smaller source; software encoding is disabled to protect responsiveness."
                    );
                }
                if let Ok(length) = attributes.GetStringLength(&MFT_FRIENDLY_NAME_Attribute) {
                    let mut name = vec![0u16; length as usize + 1];
                    if attributes
                        .GetString(&MFT_FRIENDLY_NAME_Attribute, &mut name, None)
                        .is_ok()
                    {
                        return Ok(String::from_utf16_lossy(&name)
                            .trim_end_matches('\0')
                            .to_owned());
                    }
                }
                return Ok("Hardware H.264".into());
            }
        }
    }
    Err(anyhow!(
        "Windows did not expose a verifiable hardware H.264 encoder for this source."
    ))
}

/// Wall-clock timestamps preserve real-time playback after dropped frames.
/// A pause removes only paused wall time and never resets frame timestamps.
struct Timeline {
    start: Instant,
    paused_at: Option<Instant>,
    paused_for: Duration,
}
impl Timeline {
    fn new(start: Instant) -> Self {
        Self {
            start,
            paused_at: None,
            paused_for: Duration::ZERO,
        }
    }
    fn elapsed(&mut self, now: Instant, paused: bool) -> Duration {
        if paused && self.paused_at.is_none() {
            self.paused_at = Some(now);
        }
        if !paused {
            if let Some(at) = self.paused_at.take() {
                self.paused_for += now.saturating_duration_since(at);
            }
        }
        self.paused_at
            .unwrap_or(now)
            .saturating_duration_since(self.start)
            .saturating_sub(self.paused_for)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pause_excludes_wall_time_without_resetting_the_timeline() {
        let start = Instant::now();
        let mut timeline = Timeline::new(start);
        assert_eq!(
            timeline.elapsed(start + Duration::from_secs(2), false),
            Duration::from_secs(2)
        );
        assert_eq!(
            timeline.elapsed(start + Duration::from_secs(3), true),
            Duration::from_secs(3)
        );
        assert_eq!(
            timeline.elapsed(start + Duration::from_secs(8), true),
            Duration::from_secs(3)
        );
        assert_eq!(
            timeline.elapsed(start + Duration::from_secs(9), false),
            Duration::from_secs(3)
        );
        assert_eq!(
            timeline.elapsed(start + Duration::from_secs(10), false),
            Duration::from_secs(4)
        );
    }
}
