//! Explicit GPU color conversion avoids Media Foundation inserting a CPU RGB
//! converter before the hardware encoder. Dimensions remain unchanged.

use anyhow::{Context, Result, bail};
use std::mem::ManuallyDrop;
use windows::{
    Win32::{
        Foundation::RECT,
        Graphics::{Direct3D11::*, Dxgi::Common::*},
    },
    core::Interface,
};

pub struct Converter {
    device: ID3D11VideoDevice,
    context: ID3D11VideoContext1,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    input: ID3D11VideoProcessorInputView,
}

impl Converter {
    pub fn new(
        device: &ID3D11Device,
        context: &ID3D11DeviceContext,
        source: &ID3D11Texture2D,
        width: u32,
        height: u32,
        fps: u32,
    ) -> Result<Self> {
        let device: ID3D11VideoDevice = device.cast().context("Access GPU video processing")?;
        let context: ID3D11VideoContext1 =
            context.cast().context("Access GPU color-space controls")?;
        unsafe {
            let enumerator = device
                .CreateVideoProcessorEnumerator(&D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                    InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                    InputFrameRate: DXGI_RATIONAL {
                        Numerator: fps,
                        Denominator: 1,
                    },
                    InputWidth: width,
                    InputHeight: height,
                    OutputFrameRate: DXGI_RATIONAL {
                        Numerator: fps,
                        Denominator: 1,
                    },
                    OutputWidth: width,
                    OutputHeight: height,
                    Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
                })
                .context("Create GPU color-conversion configuration")?;
            if enumerator.CheckVideoProcessorFormat(DXGI_FORMAT_B8G8R8A8_UNORM)?
                & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_INPUT.0 as u32
                == 0
                || enumerator.CheckVideoProcessorFormat(DXGI_FORMAT_NV12)?
                    & D3D11_VIDEO_PROCESSOR_FORMAT_SUPPORT_OUTPUT.0 as u32
                    == 0
            {
                bail!(
                    "The graphics driver cannot convert desktop pixels to NV12 on the GPU. Update the graphics driver before recording."
                );
            }
            let processor = device
                .CreateVideoProcessor(&enumerator, 0)
                .context("Create GPU video processor")?;
            let mut input = None;
            device
                .CreateVideoProcessorInputView(
                    source,
                    &enumerator,
                    &D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                        FourCC: 0,
                        ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                        Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
                            Texture2D: D3D11_TEX2D_VPIV {
                                MipSlice: 0,
                                ArraySlice: 0,
                            },
                        },
                    },
                    Some(&mut input),
                )
                .context("Create GPU desktop input view")?;
            let input = input.context("GPU did not return a desktop input view")?;
            context.VideoProcessorSetStreamFrameFormat(
                &processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );
            context.VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);
            context.VideoProcessorSetStreamColorSpace1(
                &processor,
                0,
                DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
            );
            context.VideoProcessorSetOutputColorSpace1(
                &processor,
                DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
            );
            let rect = RECT {
                left: 0,
                top: 0,
                right: width as i32,
                bottom: height as i32,
            };
            context.VideoProcessorSetStreamSourceRect(&processor, 0, true, Some(&rect));
            context.VideoProcessorSetStreamDestRect(&processor, 0, true, Some(&rect));
            context.VideoProcessorSetOutputTargetRect(&processor, true, Some(&rect));
            Ok(Self {
                device,
                context,
                enumerator,
                processor,
                input,
            })
        }
    }

    pub fn convert(&self, destination: &ID3D11Texture2D, subresource: u32) -> Result<()> {
        unsafe {
            let mut view = None;
            // The sample allocator uses one mip and one texture per sample.
            // Reject unexpected subresource layouts instead of writing a wrong plane.
            if subresource != 0 {
                bail!("The encoder returned an unsupported GPU sample layout.");
            }
            self.device
                .CreateVideoProcessorOutputView(
                    destination,
                    &self.enumerator,
                    &D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                        ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                        Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                            Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
                        },
                    },
                    Some(&mut view),
                )
                .context("Create GPU NV12 output view")?;
            let view = view.context("GPU did not return an NV12 output view")?;
            let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                pInputSurface: ManuallyDrop::new(Some(self.input.clone())),
                ..Default::default()
            };
            let result = self.context.VideoProcessorBlt(
                &self.processor,
                &view,
                0,
                std::slice::from_ref(&stream),
            );
            // The Win32 ABI's stream structure does not release COM fields.
            ManuallyDrop::drop(&mut stream.pInputSurface);
            result.context("Convert desktop pixels to NV12 on the GPU")?;
        }
        Ok(())
    }
}
