use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalSize, Size};

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
}

#[derive(Debug)]
pub struct WindowViewState {
    inner: Mutex<InnerState>,
}

impl WindowViewState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(InnerState {
                current_view: ViewKind::Timer,
                saved_timer_size: None,
            }),
        }
    }

    pub fn is_timer_view(&self) -> bool {
        self.inner.lock().unwrap().current_view == ViewKind::Timer
    }

    pub fn transition_to(&self, target_view: ViewKind, current_physical_size: Option<PhysicalSize<u32>>) -> SizePlan {
        let mut guard = self.inner.lock().unwrap();
        if guard.current_view == target_view {
            return SizePlan::NoChange;
        }
        match (guard.current_view, target_view) {
            (ViewKind::Timer, secondary) => {
                // Leaving timer view: snapshot current size if present
                if let Some(size) = current_physical_size {
                    guard.saved_timer_size = Some(size);
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
                if let Some(saved) = guard.saved_timer_size.take() {
                    SizePlan::RestorePhysical(saved)
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
    RestorePhysical(PhysicalSize<u32>),
}

pub fn apply_view_size(
    app: &AppHandle,
    view: &str,
    state: &WindowViewState,
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
        }
        guard.current_view = parsed;
        return Ok(());
    }

    let plan = state.transition_to(parsed, window.inner_size().ok());
    match plan {
        SizePlan::NoChange => Ok(()),
        SizePlan::ResizeLogical(w, h) => {
            window
                .set_size(Size::Logical(tauri::LogicalSize::new(w, h)))
                .map_err(|e| format!("failed to resize window: {e}"))
        }
        SizePlan::RestorePhysical(phys) => {
            window
                .set_size(Size::Physical(phys))
                .map_err(|e| format!("failed to restore window size: {e}"))
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
        let plan = state.transition_to(ViewKind::Settings, Some(timer_size));
        assert_eq!(plan, SizePlan::ResizeLogical(840.0, 520.0));
        assert!(!state.is_timer_view());

        // Settings -> Stats: preserves original timer size snapshot, requests 840x520
        let current_settings_size = PhysicalSize::new(840, 520);
        let plan2 = state.transition_to(ViewKind::Stats, Some(current_settings_size));
        assert_eq!(plan2, SizePlan::ResizeLogical(840.0, 520.0));
        assert!(!state.is_timer_view());

        // Stats -> Timer: restores the original timer physical size (380x500)
        let plan3 = state.transition_to(ViewKind::Timer, Some(PhysicalSize::new(840, 520)));
        assert_eq!(plan3, SizePlan::RestorePhysical(timer_size));
        assert!(state.is_timer_view());
    }
}
