use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Size};

pub const SETTINGS_VIEW_WIDTH: f64 = 840.0;
pub const SETTINGS_VIEW_HEIGHT: f64 = 520.0;
pub const STATS_VIEW_WIDTH: f64 = 720.0;
pub const STATS_VIEW_HEIGHT: f64 = 480.0;
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
    target_plan: Option<SizePlan>,
    timer_restore_pending: bool,
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
                target_plan: None,
                timer_restore_pending: false,
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
    fn complete_timer_restore(&self) {
        let mut guard = self.inner.lock().unwrap();
        if guard.current_view == ViewKind::Timer && guard.timer_restore_pending {
            guard.timer_restore_pending = false;
            guard.saved_timer_size = None;
            guard.saved_timer_position = None;
        }
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
        let plan = match (guard.current_view, target_view) {
            (ViewKind::Timer, secondary) => {
                // Leaving timer view: snapshot current size and position if present
                if !guard.timer_restore_pending {
                    guard.saved_timer_size = current_physical_size;
                    guard.saved_timer_position = current_physical_position;
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
                guard.timer_restore_pending = true;
                if let Some(saved_size) = guard.saved_timer_size {
                    let saved_pos = guard.saved_timer_position;
                    SizePlan::RestorePhysical(saved_size, saved_pos)
                } else {
                    SizePlan::ResizeLogical(DEFAULT_TIMER_WIDTH, DEFAULT_TIMER_HEIGHT)
                }
            }
            _ => SizePlan::NoChange,
        };
        guard.target_plan = Some(plan);
        plan
    }
}

impl Default for WindowViewState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SizePlan {
    NoChange,
    ResizeLogical(f64, f64),
    RestorePhysical(PhysicalSize<u32>, Option<PhysicalPosition<i32>>),
}

static RESIZE_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(target_os = "macos")]
fn restored_frame_origin(
    origin: (f64, f64), current_height: f64, target_height: f64,
    current_outer: PhysicalPosition<i32>, saved_outer: PhysicalPosition<i32>, scale: f64,
) -> (f64, f64) {
    (
        origin.0 + (f64::from(saved_outer.x) - f64::from(current_outer.x)) / scale,
        origin.1 + (f64::from(current_outer.y) - f64::from(saved_outer.y)) / scale
            + current_height - target_height,
    )
}

#[cfg(target_os = "macos")]
async fn wait_for_animation(receiver: tokio::sync::oneshot::Receiver<bool>, timeout: std::time::Duration) -> bool {
    matches!(tokio::time::timeout(timeout, receiver).await, Ok(Ok(true)))
}

#[cfg(target_os = "macos")]
async fn animate_frame_macos(app: &AppHandle, window: &tauri::WebviewWindow, target_w: f64, target_h: f64, gen: u64, restore_position: Option<PhysicalPosition<i32>>) -> bool {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSAnimationContext;
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let (sender, receiver) = tokio::sync::oneshot::channel();
    let outer_position = window.outer_position().ok();
    let scale = window.scale_factor().unwrap_or(1.0);
    let window = window.clone();
    if app.run_on_main_thread(move || {
        let Ok(handle) = window.window_handle() else { let _ = sender.send(false); return; };
        let RawWindowHandle::AppKit(handle) = handle.as_raw() else { let _ = sender.send(false); return; };
        if RESIZE_GENERATION.load(std::sync::atomic::Ordering::SeqCst) != gen { let _ = sender.send(true); return; }
        let ns_view = handle.ns_view.as_ptr() as *mut AnyObject;
        let ns_window: *mut AnyObject = unsafe { msg_send![ns_view, window] };
        if ns_window.is_null() { let _ = sender.send(false); return; }
        unsafe {
            let current: NSRect = msg_send![ns_window, frame];
            let (mut x, mut y) = match (restore_position, outer_position) {
                (Some(saved), Some(outer)) => restored_frame_origin(
                    (current.origin.x, current.origin.y), current.size.height, target_h,
                    outer, saved, scale,
                ),
                _ => (current.origin.x - (target_w - current.size.width) / 2.0,
                      current.origin.y + current.size.height - target_h),
            };
            let screen: *mut AnyObject = msg_send![ns_window, screen];
            if !screen.is_null() {
                let visible: NSRect = msg_send![screen, visibleFrame];
                x = x.clamp(visible.origin.x, (visible.origin.x + visible.size.width - target_w).max(visible.origin.x));
                y = y.clamp(visible.origin.y, (visible.origin.y + visible.size.height - target_h).max(visible.origin.y));
            }
            let frame = NSRect { origin: NSPoint { x, y }, size: NSSize { width: target_w, height: target_h } };
            let sender = std::sync::Mutex::new(Some(sender));
            let completion = RcBlock::new(move || { if let Some(sender) = sender.lock().unwrap().take() { let _ = sender.send(true); } });
            NSAnimationContext::beginGrouping();
            let context = NSAnimationContext::currentContext();
            context.setDuration(0.3);
            context.setCompletionHandler(Some(&completion));
            let animator: *mut AnyObject = msg_send![ns_window, animator];
            let _: () = msg_send![animator, setFrame: frame, display: true];
            NSAnimationContext::endGrouping();
        }
    }).is_err() { return false; }
    wait_for_animation(receiver, std::time::Duration::from_secs(2)).await
}

async fn animate_resize_fallback(window: &tauri::WebviewWindow, target_w: f64, target_h: f64, gen: u64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let start_size = window.inner_size().unwrap_or(tauri::PhysicalSize::new(
        (target_w * scale) as u32, (target_h * scale) as u32,
    ));
    let start_w = start_size.width as f64 / scale;
    let start_h = start_size.height as f64 / scale;
    for step in 1..=18 {
        tokio::time::sleep(std::time::Duration::from_millis(16)).await;
        if RESIZE_GENERATION.load(std::sync::atomic::Ordering::SeqCst) != gen { return; }
        let t = step as f64 / 18.0;
        let factor = 1.0 - (1.0 - t).powi(3);
        let cur_w = start_w + (target_w - start_w) * factor;
        let cur_h = start_h + (target_h - start_h) * factor;
        let _ = window.set_size(Size::Logical(tauri::LogicalSize::new(cur_w, cur_h)));
    }
}

pub async fn apply_view_size(
    app: &AppHandle,
    view: &str,
    state: &WindowViewState,
    animate: bool,
) -> Result<(), String> {
    let parsed = ViewKind::parse(view)?;
    let gen = RESIZE_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    // If window is currently maximized or fullscreen, preserve the pending timer size
    // and do not force-resize geometry, nor return to timer view until unmaximized.
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        let mut guard = state.inner.lock().unwrap();
        if guard.current_view == ViewKind::Timer && parsed != ViewKind::Timer && !guard.timer_restore_pending {
            if let Ok(size) = window.inner_size() {
                guard.saved_timer_size = Some(size);
            }
            if let Ok(pos) = window.outer_position() {
                guard.saved_timer_position = Some(pos);
            }
        }
        guard.current_view = parsed;
        if parsed == ViewKind::Timer && guard.saved_timer_size.is_some() {
            guard.timer_restore_pending = true;
        }
        state.set_transitioning(false);
        return Ok(());
    }

    let plan = state.transition_to(
        parsed,
        window.inner_size().ok(),
        window.outer_position().ok(),
    );
    let plan = if plan == SizePlan::NoChange && state.is_transitioning() {
        state.inner.lock().unwrap().target_plan.unwrap_or(SizePlan::NoChange)
    } else {
        plan
    };
    match plan {
        SizePlan::NoChange => Ok(()),
        SizePlan::ResizeLogical(w, h) => {
            if animate {
                state.set_transitioning(true);
                #[cfg(target_os = "macos")]
                if animate_frame_macos(app, &window, w, h, gen, None).await {
                    if RESIZE_GENERATION.load(std::sync::atomic::Ordering::SeqCst) == gen { if parsed == ViewKind::Timer { state.complete_timer_restore(); } state.set_transitioning(false); }
                    crate::sync_macos_traffic_lights(&window);
                    return Ok(());
                }
                animate_resize_fallback(&window, w, h, gen).await;
                if RESIZE_GENERATION.load(std::sync::atomic::Ordering::SeqCst) == gen { if parsed == ViewKind::Timer { state.complete_timer_restore(); } state.set_transitioning(false); }
                Ok(())
            } else {
                state.set_transitioning(false);
                window
                    .set_size(Size::Logical(tauri::LogicalSize::new(w, h)))
                    .map_err(|e| format!("failed to resize window: {e}"))?;
                if parsed == ViewKind::Timer { state.complete_timer_restore(); }
                #[cfg(target_os = "macos")]
                crate::sync_macos_traffic_lights(&window);
                Ok(())
            }
        }
        SizePlan::RestorePhysical(phys, pos) => {
            if animate {
                state.set_transitioning(true);
                let scale = window.scale_factor().unwrap_or(1.0);
                #[cfg(target_os = "macos")]
                if animate_frame_macos(app, &window, phys.width as f64 / scale, phys.height as f64 / scale, gen, pos).await {
                    if RESIZE_GENERATION.load(std::sync::atomic::Ordering::SeqCst) == gen { state.complete_timer_restore(); state.set_transitioning(false); }
                    crate::sync_macos_traffic_lights(&window);
                    return Ok(());
                }
                if let Some(p) = pos {
                    let _ = window.set_position(tauri::Position::Physical(p));
                }
                animate_resize_fallback(&window, phys.width as f64 / scale, phys.height as f64 / scale, gen).await;
                if RESIZE_GENERATION.load(std::sync::atomic::Ordering::SeqCst) == gen { state.complete_timer_restore(); state.set_transitioning(false); }
                Ok(())
            } else {
                state.set_transitioning(false);
                if let Some(p) = pos {
                    let _ = window.set_position(tauri::Position::Physical(p));
                }
                window
                    .set_size(Size::Physical(phys))
                    .map_err(|e| format!("failed to restore window size: {e}"))?;
                state.complete_timer_restore();
                #[cfg(target_os = "macos")]
                crate::sync_macos_traffic_lights(&window);
                Ok(())
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
        assert_eq!(optimal_view_logical_size(ViewKind::Stats), Some((720.0, 480.0)));
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

        // Settings -> Stats: preserves original timer size snapshot, requests 720x480
        let current_settings_size = PhysicalSize::new(840, 520);
        let plan2 = state.transition_to(ViewKind::Stats, Some(current_settings_size), None);
        assert_eq!(plan2, SizePlan::ResizeLogical(720.0, 480.0));
        assert!(!state.is_timer_view());

        // Stats -> Timer: restores the original timer physical size (380x500)
        let plan3 = state.transition_to(ViewKind::Timer, Some(PhysicalSize::new(840, 520)), None);
        assert_eq!(plan3, SizePlan::RestorePhysical(timer_size, None));
        assert!(state.is_timer_view());
    }

    #[test]
    fn interrupted_timer_restore_keeps_original_geometry() {
        let state = WindowViewState::new();
        let original = PhysicalSize::new(380, 500);
        let position = PhysicalPosition::new(300, 200);
        state.transition_to(ViewKind::Settings, Some(original), Some(position));
        assert_eq!(state.transition_to(ViewKind::Timer, None, None), SizePlan::RestorePhysical(original, Some(position)));
        state.transition_to(ViewKind::Settings, Some(PhysicalSize::new(650, 510)), Some(PhysicalPosition::new(100, 100)));
        assert_eq!(state.transition_to(ViewKind::Timer, None, None), SizePlan::RestorePhysical(original, Some(position)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn restored_frame_tracks_saved_physical_top_left_at_retina_scale() {
        assert_eq!(restored_frame_origin((100.0, 200.0), 520.0, 478.0,
            PhysicalPosition::new(200, 300), PhysicalPosition::new(300, 400), 2.0), (150.0, 192.0));
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn missing_animation_completion_times_out() {
        let (_sender, receiver) = tokio::sync::oneshot::channel();
        assert!(!wait_for_animation(receiver, std::time::Duration::from_millis(1)).await);
    }

    #[test]
    fn completed_timer_restore_allows_a_new_snapshot() {
        let state = WindowViewState::new();
        state.transition_to(ViewKind::Settings, Some(PhysicalSize::new(380, 500)), None);
        state.transition_to(ViewKind::Timer, None, None);
        state.complete_timer_restore();
        let resized = PhysicalSize::new(420, 520);
        state.transition_to(ViewKind::Settings, Some(resized), None);
        assert_eq!(state.transition_to(ViewKind::Timer, None, None), SizePlan::RestorePhysical(resized, None));
    }

    #[test]
    fn same_view_retains_resize_target_for_motion_cancellation() {
        let state = WindowViewState::new();
        assert_eq!(state.transition_to(ViewKind::Settings, None, None), SizePlan::ResizeLogical(840.0, 520.0));
        assert_eq!(state.transition_to(ViewKind::Settings, None, None), SizePlan::NoChange);
        assert_eq!(state.inner.lock().unwrap().target_plan, Some(SizePlan::ResizeLogical(840.0, 520.0)));
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
        assert_eq!(plan2, SizePlan::ResizeLogical(720.0, 480.0));

        let plan3 = state.transition_to(ViewKind::Timer, Some(PhysicalSize::new(840, 520)), Some(tauri::PhysicalPosition::new(300, 200)));
        assert_eq!(plan3, SizePlan::RestorePhysical(timer_size, Some(timer_pos)));
        assert!(state.is_timer_view());
    }
}
