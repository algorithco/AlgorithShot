//! Own a stop shortcut without changing the app's screenshot shortcuts.

use anyhow::{Context, Result, bail};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::thread::JoinHandle;
use std::time::Duration;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, RegisterHotKey, UnregisterHotKey, VK_F9,
};
use windows::Win32::UI::WindowsAndMessaging::{MSG, PM_REMOVE, PeekMessageW, WM_HOTKEY};

pub struct StopShortcut {
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl StopShortcut {
    pub fn start(stop: Arc<AtomicBool>) -> Result<Self> {
        let (ready, receive) = mpsc::sync_channel(1);
        let signal = stop.clone();
        let worker = std::thread::Builder::new().name("recording-stop-key".into()).spawn(move || unsafe {
            const ID: i32 = 0x4153;
            let registered = RegisterHotKey(None, ID, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_F9.0 as u32);
            if let Err(error) = registered {
                let _ = ready.send(Err(format!("Ctrl+Shift+F9 is unavailable ({error}). Free this stop shortcut before recording.")));
                return;
            }
            if ready.send(Ok(())).is_err() {
                let _ = UnregisterHotKey(None, ID);
                return;
            }
            while !signal.load(Ordering::Acquire) {
                let mut msg = MSG::default();
                while PeekMessageW(&mut msg, None, WM_HOTKEY, WM_HOTKEY, PM_REMOVE).as_bool() {
                    if msg.wParam.0 == ID as usize { signal.store(true, Ordering::Release); }
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let _ = UnregisterHotKey(None, ID);
        }).context("Could not start the recording stop shortcut")?;
        match receive.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => Ok(Self {
                stop,
                worker: Some(worker),
            }),
            Ok(Err(error)) => {
                let _ = worker.join();
                bail!("{error}");
            }
            Err(error) => {
                stop.store(true, Ordering::Release);
                // If the receiver disappears, the worker also unregisters its
                // shortcut when registration eventually returns.
                bail!("Could not reserve the recording stop shortcut: {error}");
            }
        }
    }
}

impl Drop for StopShortcut {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
