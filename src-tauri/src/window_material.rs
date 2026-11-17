use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, Serialize)]
pub struct WindowMaterialStatus {
    pub active: bool,
    pub revision: u32,
}

struct MaterialInner {
    requested_glass: bool,
    web_allowed: bool,
    observer_ready: bool,
    native_installed: bool,
    status: WindowMaterialStatus,
}

pub struct WindowMaterialState {
    inner: Mutex<MaterialInner>,
}

impl WindowMaterialState {
    pub fn new(style: &str) -> Self {
        Self { inner: Mutex::new(MaterialInner {
            requested_glass: style == "glass",
            web_allowed: false,
            observer_ready: false,
            native_installed: false,
            status: WindowMaterialStatus { active: false, revision: 0 },
        }) }
    }

    pub fn set_requested_style(&self, style: &str) {
        self.inner.lock().unwrap().requested_glass = style == "glass";
    }
}

pub fn install_observers(app: &AppHandle) -> Result<(), String> {
    platform::install(app)?;
    app.state::<WindowMaterialState>().inner.lock().unwrap().observer_ready = true;
    Ok(())
}

fn reconcile(app: &AppHandle) -> WindowMaterialStatus {
    let state = app.state::<WindowMaterialState>();
    let (requested_glass, web_allowed, observer_ready, installed, previously_active) = {
        let inner = state.inner.lock().unwrap();
        (inner.requested_glass, inner.web_allowed, inner.observer_ready, inner.native_installed, inner.status.active)
    };
    let requested = requested_glass && web_allowed && observer_ready;
    let permitted = if requested {
        match platform::allowed() {
            Ok(allowed) => allowed,
            Err(error) => { log::warn!("Window material policy unavailable: {error}"); false }
        }
    } else { false };
    let mut still_installed = installed;
    let mut active = permitted && installed && previously_active;
    if permitted && installed && !previously_active {
        match platform::clear(app) {
            Ok(()) => still_installed = false,
            Err(error) => log::warn!("Window material removal failed: {error}"),
        }
    }
    if permitted && !still_installed {
        match platform::apply(app) {
            Ok(()) => { still_installed = true; active = true; }
            Err(error) => {
                log::warn!("Window material installation failed: {error}");
                still_installed = match platform::clear(app) {
                    Ok(()) => false,
                    Err(error) => { log::warn!("Window material cleanup failed: {error}"); true }
                };
            }
        }
    } else if !permitted && installed {
        match platform::clear(app) {
            Ok(()) => still_installed = false,
            Err(error) => log::warn!("Window material removal failed: {error}"),
        }
        active = false;
    }
    let status = {
        let mut inner = state.inner.lock().unwrap();
        inner.native_installed = still_installed;
        inner.status.active = active;
        inner.status.revision = inner.status.revision.saturating_add(1);
        inner.status
    };
    log::info!(
        "[material] glass={requested_glass} web_allowed={web_allowed} observers={observer_ready} policy_allowed={permitted} installed={still_installed} active={} revision={}",
        status.active, status.revision,
    );
    if let Err(error) = app.emit("window:material-changed", status) {
        log::warn!("Window material status emission failed: {error}");
    }
    status
}

pub fn schedule_reconcile(app: &AppHandle) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || { reconcile(&handle); }) {
        log::warn!("Window material dispatch failed: {error}");
    }
}

pub async fn set_allowed(app: AppHandle, allowed: bool) -> Result<WindowMaterialStatus, String> {
    app.state::<WindowMaterialState>().inner.lock().unwrap().web_allowed = allowed;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || { let _ = sender.send(reconcile(&handle)); })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())
}

pub fn shutdown() { platform::shutdown(); }

#[cfg(target_os = "macos")]
mod platform {
    use std::{cell::RefCell, ptr::NonNull};
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::ProtocolObject};
    use objc2_app_kit::{NSWorkspace, NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification};
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSOperationQueue};
    use tauri::{AppHandle, Manager};
    use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};

    struct Observer {
        center: Retained<NSNotificationCenter>,
        token: Retained<ProtocolObject<dyn NSObjectProtocol>>,
    }
    impl Drop for Observer {
        fn drop(&mut self) {
            let token: &ProtocolObject<dyn NSObjectProtocol> = &self.token;
            // SAFETY: this token belongs to this center and is revoked on the AppKit thread.
            unsafe { self.center.removeObserver(token.as_ref()); }
        }
    }
    thread_local! { static OBSERVER: RefCell<Option<Observer>> = const { RefCell::new(None) }; }

    pub fn install(app: &AppHandle) -> Result<(), String> {
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        let handle = app.clone();
        let block = RcBlock::new(move |_: NonNull<NSNotification>| super::schedule_reconcile(&handle));
        let token = unsafe { center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification), None,
            Some(&NSOperationQueue::mainQueue()), &block,
        ) };
        OBSERVER.with(|holder| *holder.borrow_mut() = Some(Observer { center, token }));
        Ok(())
    }
    pub fn allowed() -> Result<bool, String> {
        let workspace = NSWorkspace::sharedWorkspace();
        Ok(!workspace.accessibilityDisplayShouldReduceTransparency() && !workspace.accessibilityDisplayShouldIncreaseContrast())
    }
    pub fn apply(app: &AppHandle) -> Result<(), String> {
        let window = app.get_webview_window("main").ok_or("main window unavailable")?;
        window_vibrancy::apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, Some(NSVisualEffectState::Active), None).map_err(|error| error.to_string())
    }
    pub fn clear(app: &AppHandle) -> Result<(), String> {
        let window = app.get_webview_window("main").ok_or("main window unavailable")?;
        window_vibrancy::clear_vibrancy(&window).map(|_| ()).map_err(|error| error.to_string())
    }
    pub fn shutdown() { OBSERVER.with(|holder| { holder.borrow_mut().take(); }); }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::cell::RefCell;
    use tauri::{AppHandle, Manager};
    use windows::{core::IInspectable, Foundation::TypedEventHandler, UI::ViewManagement::{AccessibilitySettings, UISettings}, Win32::{Foundation::HWND, Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_NONE, DWMSBT_TRANSIENTWINDOW, DWM_SYSTEMBACKDROP_TYPE}}};

    struct Observer { ui: UISettings, accessibility: AccessibilitySettings, ui_token: i64, accessibility_token: i64 }
    impl Drop for Observer {
        fn drop(&mut self) {
            let _ = self.ui.RemoveAdvancedEffectsEnabledChanged(self.ui_token);
            let _ = self.accessibility.RemoveHighContrastChanged(self.accessibility_token);
        }
    }
    thread_local! { static OBSERVER: RefCell<Option<Observer>> = const { RefCell::new(None) }; }

    #[repr(C)]
    struct VersionInfo { size: u32, major: u32, minor: u32, build: u32, platform: u32, service_pack: [u16; 128] }
    #[link(name = "ntdll")]
    extern "system" { fn RtlGetVersion(info: *mut VersionInfo) -> i32; }
    fn supported() -> bool {
        let mut info = VersionInfo { size: std::mem::size_of::<VersionInfo>() as u32, major: 0, minor: 0, build: 0, platform: 0, service_pack: [0; 128] };
        unsafe { RtlGetVersion(&mut info) == 0 && info.major >= 10 && info.build >= 22621 }
    }
    pub fn install(app: &AppHandle) -> Result<(), String> {
        if !supported() { return Err("Desktop Acrylic requires Windows 11 build 22621".into()); }
        let ui = UISettings::new().map_err(|e| e.to_string())?;
        let accessibility = AccessibilitySettings::new().map_err(|e| e.to_string())?;
        let handle = app.clone();
        let ui_handler = TypedEventHandler::<UISettings, IInspectable>::new(move |_, _| { super::schedule_reconcile(&handle); Ok(()) });
        let ui_token = ui.AdvancedEffectsEnabledChanged(&ui_handler).map_err(|e| e.to_string())?;
        let handle = app.clone();
        let accessibility_handler = TypedEventHandler::<AccessibilitySettings, IInspectable>::new(move |_, _| { super::schedule_reconcile(&handle); Ok(()) });
        let accessibility_token = match accessibility.HighContrastChanged(&accessibility_handler) {
            Ok(token) => token,
            Err(error) => { let _ = ui.RemoveAdvancedEffectsEnabledChanged(ui_token); return Err(error.to_string()); }
        };
        OBSERVER.with(|holder| *holder.borrow_mut() = Some(Observer { ui, accessibility, ui_token, accessibility_token }));
        Ok(())
    }
    pub fn allowed() -> Result<bool, String> {
        OBSERVER.with(|holder| {
            let holder = holder.borrow();
            let observer = holder.as_ref().ok_or("window material observers unavailable")?;
            Ok(observer.ui.AdvancedEffectsEnabled().map_err(|e| e.to_string())? && !observer.accessibility.HighContrast().map_err(|e| e.to_string())?)
        })
    }
    fn set(app: &AppHandle, value: DWM_SYSTEMBACKDROP_TYPE) -> Result<(), String> {
        let window = app.get_webview_window("main").ok_or("main window unavailable")?;
        let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0);
        unsafe { DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &value as *const _ as *const _, std::mem::size_of_val(&value) as u32) }.map_err(|e| e.to_string())
    }
    pub fn apply(app: &AppHandle) -> Result<(), String> { set(app, DWMSBT_TRANSIENTWINDOW) }
    pub fn clear(app: &AppHandle) -> Result<(), String> { set(app, DWMSBT_NONE) }
    pub fn shutdown() { OBSERVER.with(|holder| { holder.borrow_mut().take(); }); }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use tauri::AppHandle;
    pub fn install(_: &AppHandle) -> Result<(), String> { Err("native window material unsupported".into()) }
    pub fn allowed() -> Result<bool, String> { Ok(false) }
    pub fn apply(_: &AppHandle) -> Result<(), String> { Err("native window material unsupported".into()) }
    pub fn clear(_: &AppHandle) -> Result<(), String> { Ok(()) }
    pub fn shutdown() {}
}
