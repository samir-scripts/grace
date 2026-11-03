use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Size};

pub const SETTINGS_VIEW_WIDTH: f64 = 840.0;
pub const SETTINGS_VIEW_HEIGHT: f64 = 520.0;
pub const STATS_VIEW_WIDTH: f64 = 840.0;
pub const STATS_VIEW_HEIGHT: f64 = 520.0;
pub const DEFAULT_TIMER_WIDTH: f64 = 360.0;
pub const DEFAULT_TIMER_HEIGHT: f64 = 478.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViewKind {
    Timer,
    Settings,
    Stats,
}

impl ViewKind {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "timer" => Ok(Self::Timer),
            "settings" => Ok(Self::Settings),
            "stats" => Ok(Self::Stats),
            other => Err(format!("Unknown view kind: {other}")),
        }
    }
}

pub fn optimal_view_logical_size(view: ViewKind) -> Option<(f64, f64)> {
    match view {
        ViewKind::Timer => None,
        ViewKind::Settings => Some((SETTINGS_VIEW_WIDTH, SETTINGS_VIEW_HEIGHT)),
        ViewKind::Stats => Some((STATS_VIEW_WIDTH, STATS_VIEW_HEIGHT)),
    }
}

#[derive(Debug)]
struct InnerState {
    current_view: ViewKind,
    saved_timer_size: Option<PhysicalSize<u32>>,
    saved_timer_position: Option<PhysicalPosition<i32>>,
}

#[derive(Debug)]
pub struct WindowViewState {
    inner: Mutex<InnerState>,
    is_transitioning: std::sync::atomic::AtomicBool,
}

impl WindowViewState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(InnerState {
                current_view: ViewKind::Timer,
                saved_timer_size: None,
                saved_timer_position: None,
            }),
            is_transitioning: std::sync::atomic::AtomicBool::new(false),
        }
    }

    pub fn is_timer_view(&self) -> bool {
        self.inner.lock().unwrap().current_view == ViewKind::Timer
    }

    pub fn is_transitioning(&self) -> bool {
        self.is_transitioning.load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn set_transitioning(&self, val: bool) {
        self.is_transitioning.store(val, std::sync::atomic::Ordering::SeqCst);
    }
    pub fn transition_to(
        &self,
        target_view: ViewKind,
        current_physical_size: Option<PhysicalSize<u32>>,
        current_physical_position: Option<PhysicalPosition<i32>>,
    ) -> SizePlan {
        let mut guard = self.inner.lock().unwrap();
        if guard.current_view == target_view {
            return SizePlan::NoChange;
        }
        match (guard.current_view, target_view) {
            (ViewKind::Timer, secondary) => {
                // Leaving timer view: snapshot current size and position if present
                if let Some(size) = current_physical_size {
                    guard.saved_timer_size = Some(size);
                }
                if let Some(pos) = current_physical_position {
                    guard.saved_timer_position = Some(pos);
                }
                guard.current_view = secondary;
                let (w, h) = optimal_view_logical_size(secondary).unwrap();
                SizePlan::ResizeLogical(w, h)
            }
            (ViewKind::Settings, ViewKind::Stats) => {
                // Secondary to secondary: preserve original timer snapshot
                guard.current_view = ViewKind::Stats;
                let (w, h) = optimal_view_logical_size(ViewKind::Stats).unwrap();
                SizePlan::ResizeLogical(w, h)
            }
            (ViewKind::Stats, ViewKind::Settings) => {
                // Secondary to secondary: preserve original timer snapshot
                guard.current_view = ViewKind::Settings;
                let (w, h) = optimal_view_logical_size(ViewKind::Settings).unwrap();
                SizePlan::ResizeLogical(w, h)
            }
            (_, ViewKind::Timer) => {
                // Returning to timer: restore snapshot or default logical
                guard.current_view = ViewKind::Timer;
                if let Some(saved_size) = guard.saved_timer_size.take() {
                    let saved_pos = guard.saved_timer_position.take();
                    SizePlan::RestorePhysical(saved_size, saved_pos)
                } else {
                    SizePlan::ResizeLogical(DEFAULT_TIMER_WIDTH, DEFAULT_TIMER_HEIGHT)
                }
            }
            _ => SizePlan::NoChange,
        }
    }
}

impl Default for WindowViewState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, PartialEq)]
pub enum SizePlan {
    NoChange,
    ResizeLogical(f64, f64),
    RestorePhysical(PhysicalSize<u32>, Option<PhysicalPosition<i32>>),
}

static RESIZE_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(target_os = "macos")]
fn animate_frame_macos(
    window: &tauri::WebviewWindow,
    target_w: f64,
    target_h: f64,
    preferred_origin: Option<objc2_foundation::NSPoint>,
) -> Result<bool, String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let handle = window.window_handle().map_err(|e| e.to_string())?;
    if let RawWindowHandle::AppKit(h) = handle.as_raw() {
        let ns_view = h.ns_view.as_ptr() as *mut AnyObject;
        let ns_window: *mut AnyObject = unsafe { msg_send![ns_view, window] };
        if !ns_window.is_null() {
            unsafe {
                let cur_frame: NSRect = msg_send![ns_window, frame];
                let (mut new_x, mut new_y) = if let Some(pref) = preferred_origin {
                    (pref.x, pref.y)
                } else {
                    let top_y = cur_frame.origin.y + cur_frame.size.height;
                    let y = top_y - target_h;
                    let x = cur_frame.origin.x - (target_w - cur_frame.size.width) / 2.0;
                    (x, y)
                };

                // Clamp to screen visibleFrame so window does not expand offscreen
                let screen: *mut AnyObject = msg_send![ns_window, screen];
                if !screen.is_null() {
                    let visible: NSRect = msg_send![screen, visibleFrame];
                    let min_x = visible.origin.x;
                    let max_x = (visible.origin.x + visible.size.width - target_w).max(min_x);
                    new_x = new_x.clamp(min_x, max_x);

                    let min_y = visible.origin.y;
                    let max_y = (visible.origin.y + visible.size.height - target_h).max(min_y);
                    new_y = new_y.clamp(min_y, max_y);
                }

                let new_frame = NSRect {
                    origin: NSPoint { x: new_x, y: new_y },
                    size: NSSize { width: target_w, height: target_h },
                };
                let _: () = msg_send![ns_window, setFrame: new_frame display: true animate: true];
            }
            return Ok(true);
        }
    }
    Ok(false)
}

fn animate_resize_fallback(window: &tauri::WebviewWindow, target_w: f64, target_h: f64) {
    let win = window.clone();
    let gen = RESIZE_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        let scale = win.scale_factor().unwrap_or(1.0);
        let start_size = win.inner_size().unwrap_or(tauri::PhysicalSize::new(
            (target_w * scale) as u32,
            (target_h * scale) as u32,
        ));
        let start_w = start_size.width as f64 / scale;
        let start_h = start_size.height as f64 / scale;
        let steps = 12;
        let step_dur = std::time::Duration::from_millis(16);

        for step in 1..=steps {
            if RESIZE_GENERATION.load(std::sync::atomic::Ordering::SeqCst) != gen {
                return;
            }
            tokio::time::sleep(step_dur).await;
            if RESIZE_GENERATION.load(std::sync::atomic::Ordering::SeqCst) != gen {
                return;
            }
            let t = step as f64 / steps as f64;
            let factor = 1.0 - (1.0 - t).powi(3);
            let cur_w = start_w + (target_w - start_w) * factor;
            let cur_h = start_h + (target_h - start_h) * factor;
            let _ = win.set_size(Size::Logical(tauri::LogicalSize::new(cur_w, cur_h)));
        }
        let _ = win.set_size(Size::Logical(tauri::LogicalSize::new(target_w, target_h)));
    });
}

pub fn apply_view_size(
    app: &AppHandle,
    view: &str,
    state: &WindowViewState,
    animate: bool,
) -> Result<(), String> {
    let parsed = ViewKind::parse(view)?;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    // If window is currently maximized or fullscreen, preserve the pending timer size
    // and do not force-resize geometry, nor return to timer view until unmaximized.
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        let mut guard = state.inner.lock().unwrap();
        if guard.current_view == ViewKind::Timer && parsed != ViewKind::Timer {
            if let Ok(size) = window.inner_size() {
                guard.saved_timer_size = Some(size);
            }
            if let Ok(pos) = window.outer_position() {
                guard.saved_timer_position = Some(pos);
            }
        }
        guard.current_view = parsed;
        return Ok(());
    }

    let plan = state.transition_to(
        parsed,
        window.inner_size().ok(),
        window.outer_position().ok(),
    );
    match plan {
        SizePlan::NoChange => Ok(()),
        SizePlan::ResizeLogical(w, h) => {
            if animate {
                state.set_transitioning(true);
                #[cfg(target_os = "macos")]
                {
                    if let Ok(true) = animate_frame_macos(&window, w, h, None) {
                        return Ok(());
                    }
                }
                animate_resize_fallback(&window, w, h);
                Ok(())
            } else {
                RESIZE_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                state.set_transitioning(false);
                window
                    .set_size(Size::Logical(tauri::LogicalSize::new(w, h)))
                    .map_err(|e| format!("failed to resize window: {e}"))
            }
        }
        SizePlan::RestorePhysical(phys, pos) => {
            if animate {
                state.set_transitioning(true);
                #[cfg(target_os = "macos")]
                {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let target_w = phys.width as f64 / scale;
                    let target_h = phys.height as f64 / scale;
                    if let Ok(true) = animate_frame_macos(&window, target_w, target_h, None) {
                        return Ok(());
                    }
                }
                if let Some(p) = pos {
                    let _ = window.set_position(tauri::Position::Physical(p));
                }
                let scale = window.scale_factor().unwrap_or(1.0);
                animate_resize_fallback(&window, phys.width as f64 / scale, phys.height as f64 / scale);
                Ok(())
            } else {
                RESIZE_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                state.set_transitioning(false);
                if let Some(p) = pos {
                    let _ = window.set_position(tauri::Position::Physical(p));
                }
                window
                    .set_size(Size::Physical(phys))
                    .map_err(|e| format!("failed to restore window size: {e}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_view_kind_parsing() {
        assert_eq!(ViewKind::parse("timer"), Ok(ViewKind::Timer));
        assert_eq!(ViewKind::parse("settings"), Ok(ViewKind::Settings));
        assert_eq!(ViewKind::parse("stats"), Ok(ViewKind::Stats));
        assert!(ViewKind::parse("unknown").is_err());
    }

    #[test]
    fn test_optimal_logical_dimensions() {
        assert_eq!(optimal_view_logical_size(ViewKind::Timer), None);
        assert_eq!(optimal_view_logical_size(ViewKind::Settings), Some((840.0, 520.0)));
        assert_eq!(optimal_view_logical_size(ViewKind::Stats), Some((840.0, 520.0)));
    }

    #[test]
    fn test_window_view_state_preserves_timer_size_across_secondary_views() {
        let state = WindowViewState::new();
        assert!(state.is_timer_view());

        let timer_size = PhysicalSize::new(380, 500);

        // Timer -> Settings: snapshots timer size and requests 840x520
        let plan = state.transition_to(ViewKind::Settings, Some(timer_size), None);
        assert_eq!(plan, SizePlan::ResizeLogical(840.0, 520.0));
        assert!(!state.is_timer_view());

        // Settings -> Stats: preserves original timer size snapshot, requests 840x520
        let current_settings_size = PhysicalSize::new(840, 520);
        let plan2 = state.transition_to(ViewKind::Stats, Some(current_settings_size), None);
        assert_eq!(plan2, SizePlan::ResizeLogical(840.0, 520.0));
        assert!(!state.is_timer_view());

        // Stats -> Timer: restores the original timer physical size (380x500)
        let plan3 = state.transition_to(ViewKind::Timer, Some(PhysicalSize::new(840, 520)), None);
        assert_eq!(plan3, SizePlan::RestorePhysical(timer_size, None));
        assert!(state.is_timer_view());
    }

    #[test]
    fn test_window_view_state_preserves_timer_position_and_size() {
        let state = WindowViewState::new();
        let timer_size = PhysicalSize::new(360, 478);
        let timer_pos = tauri::PhysicalPosition::new(500, 300);

        let plan = state.transition_to(ViewKind::Settings, Some(timer_size), Some(timer_pos));
        assert_eq!(plan, SizePlan::ResizeLogical(840.0, 520.0));
        assert!(!state.is_timer_view());

        let plan2 = state.transition_to(ViewKind::Stats, Some(PhysicalSize::new(840, 520)), Some(tauri::PhysicalPosition::new(300, 200)));
        assert_eq!(plan2, SizePlan::ResizeLogical(840.0, 520.0));

        let plan3 = state.transition_to(ViewKind::Timer, Some(PhysicalSize::new(840, 520)), Some(tauri::PhysicalPosition::new(300, 200)));
        assert_eq!(plan3, SizePlan::RestorePhysical(timer_size, Some(timer_pos)));
        assert!(state.is_timer_view());
    }
}
