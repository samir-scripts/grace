pub mod engine;
pub mod sequence;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::audio::{AudioCue, AudioManager};
use crate::db::{queries, DbState};
use crate::settings::Settings;
use crate::tray::{self, TrayState};
use crate::websocket::{self, WsState};

use crate::focus::controller::{FocusController, TimerAction};
use engine::{EngineHandle, TimerCommand, TimerEvent};
use sequence::{RoundType, SequenceState};

fn sequence_for_focus(snapshot: crate::focus::state::FocusSnapshot, long_breaks_enabled: bool) -> SequenceState {
    let p = snapshot.active_profile.unwrap_or_default();
    let mut sequence = SequenceState::new(p.work_rounds, p.work_secs, p.short_break_secs, p.long_break_secs);
    if snapshot.is_locked {
        use crate::focus::state::FocusPhase;
        sequence.current_round = match snapshot.current_phase {
            Some(FocusPhase::ShortBreak) => RoundType::ShortBreak,
            Some(FocusPhase::LongBreak) => RoundType::LongBreak,
            _ => RoundType::Work,
        };
        sequence.work_round_number = if sequence.current_round == RoundType::ShortBreak
            && !long_breaks_enabled && snapshot.current_work_round >= sequence.work_rounds_total {
            0 // SequenceState uses zero for the final substitute short break.
        } else { snapshot.current_work_round.max(1) };
        sequence.session_work_count = snapshot.current_work_round.max(1);
    }
    sequence
}

/// Advance the timer sequence and return the completed round, next round,
/// next duration, and the cycle completion signal for focus enforcement.
pub fn advance_focus_sequence(seq: &mut SequenceState, short_enabled: bool, long_enabled: bool) -> (RoundType, RoundType, u32, bool) {
    let completed = seq.current_round;
    let cycle_finished = match completed {
        RoundType::LongBreak => true,
        RoundType::ShortBreak => seq.work_round_number == 0,
        RoundType::Work => seq.work_round_number >= seq.work_rounds_total && !short_enabled && !long_enabled,
    };
    let (next, duration) = seq.advance(short_enabled, long_enabled);
    (completed, next, duration, cycle_finished)
}

#[cfg(test)]
mod reset_tests {
    use super::*;
    use crate::focus::{enforcer::MockEnforcer, model::FocusProfile};

    #[test]
    fn interrupted_substitute_break_still_finishes_the_cycle() {
        let mut state = crate::focus::state::FocusStateMachine::new();
        state.restore_interrupted(FocusProfile {
            work_rounds: 2, blocked_domains: vec!["example.com".into()], ..Default::default()
        }, crate::focus::state::FocusPhase::ShortBreak, 2);
        let mut sequence = sequence_for_focus(state.snapshot(), false);
        let (_, next, _, finished) = advance_focus_sequence(&mut sequence, true, false);
        assert!(finished, "substitute final short break must release on completion after recovery");
        assert_eq!(next, RoundType::Work);
        assert_eq!(sequence.work_round_number, 1);
    }

    #[test]
    fn interrupted_phase_restarts_at_its_full_duration_and_same_round() {
        let mut state = crate::focus::state::FocusStateMachine::new();
        state.restore_interrupted(FocusProfile {
            work_rounds: 4, work_secs: 600, short_break_secs: 60, long_break_secs: 120,
            blocked_domains: vec!["example.com".into()], ..Default::default()
        }, crate::focus::state::FocusPhase::LongBreak, 4);
        let sequence = sequence_for_focus(state.snapshot(), true);
        assert_eq!(sequence.current_round, RoundType::LongBreak);
        assert_eq!(sequence.work_round_number, 4);
        assert_eq!(sequence.current_duration_secs(), 120);
    }

    #[test]
    fn round_restart_preserves_focus_and_emergency_reset_starts_first_work_round() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        let enforcer = Arc::new(MockEnforcer::new());
        let focus = Arc::new(FocusController::new(Arc::new(Mutex::new(conn)), Some(enforcer.clone())));
        let profile = FocusProfile {
            id: "reset-scope".into(), name: "Reset scope".into(), work_secs: 120,
            short_break_secs: 60, long_break_secs: 90, work_rounds: 2,
            blocked_apps: vec![], blocked_domains: vec!["example.com".into()], revision: 1,
        };
        focus.save_profile(profile).unwrap();
        focus.select_profile("reset-scope").unwrap();
        focus.on_timer_started("work").unwrap();
        let mut seq = SequenceState::new(2, 120, 60, 90);
        seq.advance(true, true);
        seq.advance(true, true);
        seq.advance(true, true);
        assert_eq!(seq.current_round, RoundType::LongBreak);
        assert_eq!(seq.work_round_number, 2);
        assert_eq!(seq.session_work_count, 2);
        let (engine, events) = engine::spawn(60, Duration::from_secs(10));
        let mut shared = TimerShared { elapsed_secs: 20, is_running: true };
        engine.send(TimerCommand::Reset);
        let event = events.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(matches!(event, TimerEvent::Reset));
        assert_eq!(apply_reset_event(&mut seq, &mut shared, &engine, &focus, &event), 90);
        assert_eq!(seq.current_round, RoundType::LongBreak);
        assert_eq!(seq.work_round_number, 2);
        assert!(focus.is_locked(), "round restart must keep focus locked");

        engine.send(TimerCommand::Start);
        assert!(matches!(events.recv_timeout(Duration::from_secs(1)).unwrap(), TimerEvent::Started { total_secs: 90 }));
        engine.send(TimerCommand::Skip);
        focus.start_supervisor(engine.clone());
        let stale_generation = focus.reset_generation();
        focus.execute_emergency_release().unwrap();
        assert!(focus.get_snapshot().is_locked);
        assert!(focus.start_timer("work", focus.reset_generation(), || {}).is_err());
        let event = events.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(matches!(event, TimerEvent::Complete { .. }));
        assert!(!completion_allowed(&focus), "stale completion must be discarded");
        let event = events.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(matches!(event, TimerEvent::ResetCycle));
        let duration = apply_reset_event(&mut seq, &mut shared, &engine, &focus, &event);
        assert_eq!(duration, 120);
        assert_eq!(seq.current_round, RoundType::Work);
        assert_eq!(seq.work_round_number, 1);
        assert_eq!(seq.session_work_count, 1);
        assert!(!focus.is_locked());
        assert!(focus.start_timer("long-break", stale_generation, || {}).is_err(), "a start captured before reset must not run afterwards");
        let fresh_generation = focus.capture_start_generation().unwrap();
        assert_ne!(fresh_generation, stale_generation);
        focus.start_timer("work", fresh_generation, || engine.send(TimerCommand::Start)).unwrap();
        assert!(enforcer.is_active.load(std::sync::atomic::Ordering::SeqCst));
        assert!(matches!(events.recv_timeout(Duration::from_secs(1)).unwrap(), TimerEvent::Started { total_secs: 120 }));
        assert!(events.recv_timeout(Duration::from_millis(30)).is_err(), "reset must not emit Complete");
        engine.send(TimerCommand::Shutdown);
    }
}

fn completion_allowed(focus: &FocusController) -> bool {
    !focus.reset_pending()
}

fn apply_reset_event(seq: &mut SequenceState, shared: &mut TimerShared, engine: &EngineHandle, focus: &FocusController, event: &TimerEvent) -> u32 {
    if matches!(event, TimerEvent::ResetCycle) {
        seq.reset();
    }
    shared.elapsed_secs = 0;
    shared.is_running = false;
    let duration = seq.current_duration_secs();
    engine.send(TimerCommand::Prime { duration_secs: duration });
    if matches!(event, TimerEvent::ResetCycle) {
        focus.finish_emergency_reset();
    }
    duration
}

// ---------------------------------------------------------------------------
// Snapshot — serialized to JSON for the frontend
// ---------------------------------------------------------------------------

/// Full timer state snapshot. Sent as the payload of Tauri events and
/// returned by the `timer_get_state` IPC command.
#[derive(Debug, Clone, Serialize)]
pub struct TimerSnapshot {
    /// "work" | "short-break" | "long-break"
    pub round_type: String,
    /// Round type that was active before this one. Empty string on the first round of a session.
    pub previous_round_type: String,
    pub elapsed_secs: u32,
    pub total_secs: u32,
    pub is_running: bool,
    /// True if the timer has been started and then paused (elapsed > 0, not running).
    pub is_paused: bool,
    pub work_round_number: u32,
    pub work_rounds_total: u32,
    /// Monotonically-increasing focus round count since last reset. Used as a
    /// session counter when long breaks are disabled.
    pub session_work_count: u32,
}

// ---------------------------------------------------------------------------
// Shared mutable state between the controller and the event-listener thread
// ---------------------------------------------------------------------------

struct TimerShared {
    elapsed_secs: u32,
    is_running: bool,
}

// ---------------------------------------------------------------------------
// TimerController — public API registered as Tauri state
// ---------------------------------------------------------------------------

pub struct TimerController {
    app: AppHandle,
    engine: EngineHandle,
    sequence: Arc<Mutex<SequenceState>>,
    settings: Arc<Mutex<Settings>>,
    shared: Arc<Mutex<TimerShared>>,
    /// Kept alive so TrayState is not dropped if lib.rs forgets its copy.
    #[allow(dead_code)]
    tray: Arc<TrayState>,
    focus: Arc<FocusController>,
}

impl TimerController {
    /// Construct and start the background threads.
    /// Call once from `lib.rs` during Tauri `setup`.
    pub fn new(
        app: AppHandle,
        settings: Settings,
        tray: Arc<TrayState>,
        db: DbState,
        focus: Arc<FocusController>,
    ) -> Self {
        let seq = sequence_for_focus(focus.get_snapshot(), settings.long_breaks_enabled);
        let duration = seq.current_duration_secs();
        let (engine, event_rx) = engine::spawn(duration, Duration::from_secs(1));
        focus.start_supervisor(engine.clone());

        let sequence = Arc::new(Mutex::new(seq));
        let settings_arc = Arc::new(Mutex::new(settings));
        let shared = Arc::new(Mutex::new(TimerShared {
            elapsed_secs: 0,
            is_running: false,
        }));

        // Clone handles for the event-listener thread.
        let seq_thread = Arc::clone(&sequence);
        let settings_thread = Arc::clone(&settings_arc);
        let shared_thread = Arc::clone(&shared);
        let engine_thread = engine.clone();
        let tray_thread = Arc::clone(&tray);
        let focus_thread = Arc::clone(&focus);
        let app_thread = app.clone();
        std::thread::Builder::new()
            .name("timer-events".to_string())
            .spawn(move || {
                listen_events(
                    app_thread,
                    event_rx,
                    ListenContext {
                        sequence: seq_thread,
                        settings: settings_thread,
                        shared: shared_thread,
                        engine: engine_thread,
                        tray: tray_thread,
                        db,
                        focus: focus_thread,
                    },
                );
            })
            .expect("failed to spawn timer event listener");

        Self {
            app,
            engine,
            sequence,
            settings: settings_arc,
            shared,
            tray,
            focus,
        }
    }

    // --- Commands ---

    /// Toggle: start a fresh timer if idle, resume if paused, pause if running.
    pub fn toggle(&self) -> Result<(), String> {
        let generation = self.focus.capture_start_generation()?;
        let (is_running, elapsed_secs) = {
            let s = self.shared.lock().unwrap();
            (s.is_running, s.elapsed_secs)
        };
        if is_running {
            log::info!("[timer] pause");
            self.engine.send(TimerCommand::Pause);
        } else {
            let round_type = self.sequence.lock().unwrap().current_round.as_str().to_string();
            let command = if elapsed_secs > 0 {
                log::info!("[timer] resume");
                TimerCommand::Resume
            } else {
                log::info!("[timer] start");
                TimerCommand::Start
            };
            self.focus.start_timer(&round_type, generation, || self.engine.send(command))?;
        }
        Ok(())
    }

    pub fn reset(&self) {
        if let Err(e) = self.focus.check_timer_command(TimerAction::Reset) {
            log::warn!("[timer] {e}");
            return;
        }
        log::info!("[timer] reset");
        self.sequence.lock().unwrap().reset();
        self.focus.on_timer_reset();
        self.engine.send(TimerCommand::Reset);
    }

    /// Restart only the current round's timer without touching the sequence.
    /// Round type, round number, and position in the work/break cycle are all
    /// preserved — only the elapsed time is zeroed.
    pub fn restart_round(&self) {
        log::info!("[timer] restart round");
        self.engine.send(TimerCommand::Reset);
    }

    pub fn skip(&self) {
        if let Err(e) = self.focus.check_timer_command(TimerAction::Skip) {
            log::warn!("[timer] {e}");
            return;
        }
        log::info!("[timer] skip");
        self.engine.send(TimerCommand::Skip);
    }

    pub fn suspend(&self) {
        self.engine.send(TimerCommand::Suspend);
    }

    pub fn wake_resume(&self) {
        self.engine.send(TimerCommand::WakeResume);
    }
    pub fn sync_profile(&self, profile: &crate::focus::model::FocusProfile) {
        let mut seq = self.sequence.lock().unwrap();
        seq.work_rounds_total = profile.work_rounds;
        seq.work_secs = profile.work_secs;
        seq.short_break_secs = profile.short_break_secs;
        seq.long_break_secs = profile.long_break_secs;
        let duration = seq.current_duration_secs();
        drop(seq);

        let s = self.shared.lock().unwrap();
        let is_idle = !s.is_running && s.elapsed_secs == 0;
        drop(s);

        if is_idle {
            self.engine.send(TimerCommand::Reconfigure { duration_secs: duration });
            let _ = self.app.emit("timer:reset", self.get_snapshot());
        }
    }


    /// Update the duration for the current round when settings change.
    /// Only takes effect after the next Start/Resume (current countdown is not interrupted).
    pub fn reconfigure(&self) {
        let duration = self.sequence.lock().unwrap().current_duration_secs();
        self.engine.send(TimerCommand::Reconfigure { duration_secs: duration });
    }

    // --- Query ---

    pub fn get_snapshot(&self) -> TimerSnapshot {
        let seq = self.sequence.lock().unwrap();

        let shared = self.shared.lock().unwrap();

        TimerSnapshot {
            round_type: seq.current_round.as_str().to_string(),
            previous_round_type: seq.previous_round.map(|r| r.as_str().to_string()).unwrap_or_default(),
            elapsed_secs: shared.elapsed_secs,
            total_secs: seq.current_duration_secs(),
            is_running: shared.is_running,
            is_paused: !shared.is_running && shared.elapsed_secs > 0,
            work_round_number: seq.work_round_number,
            work_rounds_total: seq.work_rounds_total,
            session_work_count: seq.session_work_count,
        }
    }

    /// Apply new settings values. Updates the in-memory copy and, if the
    /// timer is idle (not running and no elapsed progress), reconfigures the
    /// engine so the next Start uses the new duration.
    ///
    /// When the timer is running or paused, the current countdown is left
    /// untouched; the new duration takes effect at the start of the next
    /// round or after a manual reset.  Sending Reconfigure to a running
    /// engine transitions it to Idle, which would freeze the timer.
    pub fn apply_settings(&self, new: Settings) {
        *self.settings.lock().unwrap() = new;
    }
}

// ---------------------------------------------------------------------------
// Background event listener thread
// ---------------------------------------------------------------------------

struct ListenContext {
    sequence: Arc<Mutex<SequenceState>>,
    settings: Arc<Mutex<Settings>>,
    shared: Arc<Mutex<TimerShared>>,
    engine: EngineHandle,
    tray: Arc<TrayState>,
    db: DbState,
    focus: Arc<FocusController>,
}

fn listen_events(
    app: AppHandle,
    event_rx: std::sync::mpsc::Receiver<TimerEvent>,
    ctx: ListenContext,
) {
    let ListenContext { sequence, settings, shared, engine, tray, db, focus } = ctx;
    // Track last tray progress to throttle redraws to ≥ 1% delta.
    let mut last_tray_progress: f32 = -1.0;
    // Active session row ID for recording (None = not started yet).
    let mut current_session_id: Option<i64> = None;

    while let Ok(event) = event_rx.recv() {
        match event {
            TimerEvent::Started { total_secs } => {
                log::info!("[timer] started total={total_secs}s");
                shared.lock().unwrap().is_running = true;
                let _ = app.emit("timer:started", serde_json::json!({ "total_secs": total_secs }));
                if let Some(ws) = app.try_state::<Arc<WsState>>() {
                    websocket::broadcast_started(&ws, total_secs);
                }
                tray::update_menu_items(&tray, true, false);
            }

            TimerEvent::Tick { elapsed_secs, total_secs } => {
                {
                    let mut s = shared.lock().unwrap();
                    s.elapsed_secs = elapsed_secs;
                    s.is_running = true;
                }
                let _ = app.emit(
                    "timer:tick",
                    serde_json::json!({ "elapsed_secs": elapsed_secs, "total_secs": total_secs }),
                );

                // --- Session recording: start on first tick of a new round ---
                if elapsed_secs == 1 && current_session_id.is_none() {
                    let rt = sequence.lock().unwrap().current_round.as_str().to_string();
                    let total = sequence.lock().unwrap().current_duration_secs();
                    if let Ok(conn) = db.lock() {
                        match queries::insert_session(&conn, &rt, total) {
                            Ok(id) => current_session_id = Some(id),
                            Err(e) => log::error!("[timer] failed to record session: {e}"),
                        }
                    }
                }

                // --- Tick sound ---
                let rt = sequence.lock().unwrap().current_round.as_str().to_string();
                if let Some(audio) = app.try_state::<Arc<AudioManager>>() {
                    if audio.tick_enabled_for(&rt) {
                        audio.play_cue(AudioCue::Tick);
                    }
                }

                // Update tray arc — throttle to 1% visual change.
                let progress = if total_secs > 0 {
                    elapsed_secs as f32 / total_secs as f32
                } else {
                    0.0
                };
                if (progress - last_tray_progress).abs() >= 0.01 {
                    tray::update_icon(&tray, &rt, false, progress);
                    last_tray_progress = progress;
                }
            }

            TimerEvent::Complete { skipped: was_skipped } => {
                let generation = focus.reset_generation();
                if !completion_allowed(&focus) {
                    continue;
                }
                let completed_round = sequence.lock().unwrap().current_round.as_str().to_string();
                log::info!(
                    "[timer] round complete type={completed_round} skipped={was_skipped}"
                );

                // --- Session recording: mark the completed round ---
                if let Some(session_id) = current_session_id.take() {
                    if let Ok(conn) = db.lock() {
                        let _ = queries::complete_session(&conn, session_id, !was_skipped);
                    }
                }

                // Advance sequence.
                let (next_round, next_duration, auto_start_work, auto_start_break, cycle_finished) = {
                    let mut seq = sequence.lock().unwrap();
                    let s = settings.lock().unwrap();
                    let (_, rt, dur, last) = advance_focus_sequence(&mut seq, s.short_breaks_enabled, s.long_breaks_enabled);
                    (rt, dur, s.auto_start_work, s.auto_start_break, last)
                };

                // Reset shared state for the new round.
                {
                    let mut s = shared.lock().unwrap();
                    s.elapsed_secs = 0;
                    s.is_running = false;
                }

                // Arm the next round's duration without risking a late
                // reconfigure that kicks a freshly-started timer back to Idle.
                engine.send(TimerCommand::Prime {
                    duration_secs: next_duration,
                });

                // Emit round-change with the new snapshot.
                let snapshot = build_snapshot(&sequence, &settings, &shared);
                let _ = app.emit("timer:round-change", snapshot);

                let enforcement_ready = match focus.on_round_completed(next_round.as_str(), cycle_finished) {
                    Ok(()) => true,
                    Err(error) => {
                        log::error!("[focus] round transition blocked: {error}");
                        false
                    }
                };
                // Desktop notifications are dispatched by the frontend via the
                // notification_show command after receiving the timer:round-change
                // event, so translated strings can be used.

                // Audio alert for the new round.
                if let Some(audio) = app.try_state::<Arc<AudioManager>>() {
                    let cue = match next_round {
                        RoundType::Work => AudioCue::WorkAlert,
                        RoundType::ShortBreak => AudioCue::ShortBreakAlert,
                        RoundType::LongBreak => AudioCue::LongBreakAlert,
                    };
                    audio.play_cue(cue);
                }

                // Lower-priority-during-breaks: when always_on_top is on and
                // break_always_on_top is enabled, disable always-on-top for
                // breaks and restore it when work resumes.
                let (always_on_top, break_always_on_top) = {
                    let s = settings.lock().unwrap();
                    (s.always_on_top, s.break_always_on_top)
                };
                if always_on_top {
                    if let Some(window) = app.get_webview_window("main") {
                        let is_break = next_round != RoundType::Work;
                        let _ = window.set_always_on_top(!(break_always_on_top && is_break));
                    }
                }

                // Update tray to reflect new round type and reset progress.
                // Use -1.0 (same as initialisation and Reset) so the very
                // first tick of the new round always passes the ≥1% threshold,
                // regardless of how long the round is.  Using 0.0 here caused
                // a ≥15-second blank period before the arc started animating.
                let rt = sequence.lock().unwrap().current_round.as_str().to_string();
                tray::update_icon(&tray, &rt, false, 0.0);
                last_tray_progress = -1.0;

                // Broadcast round-change to any connected WebSocket clients.
                if let Some(ws) = app.try_state::<Arc<WsState>>() {
                    let snap = build_snapshot(&sequence, &settings, &shared);
                    websocket::broadcast_round_change(&ws, snap);
                }

                // Auto-start if configured.
                let should_auto = match next_round {
                    RoundType::Work => auto_start_work,
                    _ => auto_start_break,
                };
                if should_auto && enforcement_ready {
                    let round_type = next_round.as_str();
                    if let Err(error) = focus.start_timer(round_type, generation, || engine.send(TimerCommand::Start)) {
                        log::error!("[focus] auto-start blocked: {error}");
                        tray::update_menu_items(&tray, false, false);
                    } else {
                        log::debug!("[timer] auto-starting {round_type}");
                    }
                } else {
                    // Timer is idle waiting for the user to start the new round.
                    // Reset the tray menu to "Start" so it doesn't keep showing
                    // "Pause" from the round that just completed.
                    tray::update_menu_items(&tray, false, false);
                }
            }

            TimerEvent::Paused { elapsed_secs } => {
                log::info!("[timer] paused elapsed={elapsed_secs}s");
                shared.lock().unwrap().is_running = false;
                let _ = app.emit("timer:paused", serde_json::json!({ "elapsed_secs": elapsed_secs }));
                if let Some(ws) = app.try_state::<Arc<WsState>>() {
                    websocket::broadcast_paused(&ws, elapsed_secs);
                }

                // Show pause bars in tray.
                let rt = sequence.lock().unwrap().current_round.as_str().to_string();
                let total = sequence.lock().unwrap().current_duration_secs();
                let progress = if total > 0 { elapsed_secs as f32 / total as f32 } else { 0.0 };
                tray::update_icon(&tray, &rt, true, progress);
                tray::update_menu_items(&tray, false, true);
            }

            TimerEvent::Resumed { elapsed_secs } => {
                log::info!("[timer] resumed elapsed={elapsed_secs}s");
                shared.lock().unwrap().is_running = true;
                let _ = app.emit("timer:resumed", serde_json::json!({ "elapsed_secs": elapsed_secs }));
                if let Some(ws) = app.try_state::<Arc<WsState>>() {
                    websocket::broadcast_resumed(&ws, elapsed_secs);
                }

                // Restore arc in tray.
                let rt = sequence.lock().unwrap().current_round.as_str().to_string();
                let total = sequence.lock().unwrap().current_duration_secs();
                let progress = if total > 0 { elapsed_secs as f32 / total as f32 } else { 0.0 };
                tray::update_icon(&tray, &rt, false, progress);
                last_tray_progress = progress;
                tray::update_menu_items(&tray, true, false);
            }

            event @ (TimerEvent::Reset | TimerEvent::ResetCycle) => {
                log::debug!("[timer] idle");
                if let Some(session_id) = current_session_id.take() {
                    if let Ok(conn) = db.lock() {
                        let _ = queries::complete_session(&conn, session_id, false);
                    }
                }
                apply_reset_event(&mut sequence.lock().unwrap(), &mut shared.lock().unwrap(), &engine, &focus, &event);
                let snapshot = build_snapshot(&sequence, &settings, &shared);
                let _ = app.emit("timer:reset", snapshot);
                if let Some(ws) = app.try_state::<Arc<WsState>>() {
                    websocket::broadcast_reset(&ws);
                }

                // Reset tray to idle (empty arc).
                let rt = sequence.lock().unwrap().current_round.as_str().to_string();
                tray::update_icon(&tray, &rt, false, 0.0);
                last_tray_progress = -1.0;
                tray::update_menu_items(&tray, false, false);
            }

            TimerEvent::Suspended { elapsed_secs } => {
                log::info!("[timer] suspended by system elapsed={elapsed_secs}s");
                shared.lock().unwrap().is_running = false;
                let _ = app.emit(
                    "timer:suspended",
                    serde_json::json!({ "elapsed_secs": elapsed_secs }),
                );

                // Show pause bars while suspended.
                let rt = sequence.lock().unwrap().current_round.as_str().to_string();
                let total = sequence.lock().unwrap().current_duration_secs();
                let progress = if total > 0 { elapsed_secs as f32 / total as f32 } else { 0.0 };
                tray::update_icon(&tray, &rt, true, progress);
            }
        }
    }
}

fn build_snapshot(
    sequence: &Arc<Mutex<SequenceState>>,
    _settings: &Arc<Mutex<Settings>>,
    shared: &Arc<Mutex<TimerShared>>,
) -> TimerSnapshot {
    let seq = sequence.lock().unwrap();

    let sh = shared.lock().unwrap();

    TimerSnapshot {
        round_type: seq.current_round.as_str().to_string(),
        previous_round_type: seq.previous_round.map(|r| r.as_str().to_string()).unwrap_or_default(),
        elapsed_secs: sh.elapsed_secs,
        total_secs: seq.current_duration_secs(),
        is_running: sh.is_running,
        is_paused: !sh.is_running && sh.elapsed_secs > 0,
        work_round_number: seq.work_round_number,
        work_rounds_total: seq.work_rounds_total,
        session_work_count: seq.session_work_count,
    }
}
