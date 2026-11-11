use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

use crate::db::DbState;
use super::enforcer::{NativeEnforcer, SystemEnforcer};
#[cfg(test)]
use super::enforcer::MockEnforcer;
use super::enforcer::protocol::{EnforcementErrorCode, EnforcementState, EnforcementStatus};
use super::escape::EscapeHandler;
use super::model::{FocusProfile, FocusRunJournal};
use super::repository::FocusRepository;
use super::security::hash_passphrase;
use super::state::{FocusPhase, FocusSnapshot, FocusStateMachine};
use super::validation::{normalize_domain, validate_domain_count, validate_profile_durations};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimerAction {
    Toggle,
    Reset,
    Skip,
    RestartRound,
}

pub struct FocusController {
    state_machine: Mutex<FocusStateMachine>,
    escape_handler: Arc<EscapeHandler>,
    repository: FocusRepository,
    enforcer: Arc<dyn NativeEnforcer>,
    db: DbState,
    app_handle: Mutex<Option<AppHandle>>,
    transition: Mutex<()>,
    dnd_active: AtomicBool,
    reset_pending: AtomicBool,
    reset_generation: AtomicU64,
    engine: Mutex<Option<crate::timer::engine::EngineHandle>>,
}

impl FocusController {
    pub fn new(db: DbState, enforcer: Option<Arc<dyn NativeEnforcer>>) -> Self {
        let repo = FocusRepository::new();
        let enforcer = enforcer.unwrap_or_else(|| Arc::new(SystemEnforcer::new()));
        let mut sm = FocusStateMachine::new();

        // Load preferences on startup, ensuring valid profile selection
        if let Ok(conn) = db.lock() {
            let mut active: Option<FocusProfile> = None;
            if let Ok(prefs) = repo.get_preferences(&conn) {
                sm.set_unblock_during_breaks(prefs.unblock_during_breaks);
                if let Ok(Some(profile)) = repo.get_profile(&conn, &prefs.selected_profile_id) {
                    active = Some(profile);
                }
            }

            let profile = match active {
                Some(p) => p,
                None => {
                    let profiles = repo.get_profiles(&conn).unwrap_or_default();
                    let fallback = if let Some(p) = profiles.into_iter().next() {
                        p
                    } else {
                        let default_prof = FocusProfile {
                            id: "default".to_string(),
                            name: "Pomodoro".to_string(),
                            work_secs: 1500,
                            short_break_secs: 300,
                            long_break_secs: 900,
                            work_rounds: 4,
                            blocked_apps: Vec::new(),
                            blocked_domains: Vec::new(),
                            revision: 1,
                        };
                        let _ = repo.save_profile(&conn, &default_prof);
                        default_prof
                    };
                    let mut prefs = repo.get_preferences(&conn).unwrap_or_default();
                    prefs.selected_profile_id = fallback.id.clone();
                    let _ = repo.save_preferences(&conn, &prefs);
                    fallback
                }
            };
            let _ = sm.select_profile(Some(profile));

            // Check if there was an interrupted dirty run in journal
            if let Ok(Some(journal)) = repo.get_run_journal(&conn) {
                log::warn!(
                    "[focus] Found leftover focus journal run_id={}. Cleaning up dangling enforcement.",
                    journal.run_id
                );
                if enforcer.release_blocking().is_ok() {
                    if let Err(e) = repo.clear_run_journal(&conn) {
                        log::error!("[focus] Failed to clear recovered journal: {e}");
                    }
                } else {
                    sm.set_enforcement(EnforcementStatus {
                        state: EnforcementState::RecoveryRequired,
                        error_code: Some(EnforcementErrorCode::ReleaseFailed),
                        ..Default::default()
                    });
                }
            }
        }

        Self {
            state_machine: Mutex::new(sm),
            escape_handler: Arc::new(EscapeHandler::new()),
            repository: repo,
            enforcer,
            db,
            app_handle: Mutex::new(None),
            transition: Mutex::new(()),
            dnd_active: AtomicBool::new(false),
            reset_pending: AtomicBool::new(false),
            reset_generation: AtomicU64::new(0),
            engine: Mutex::new(None),
        }
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        let mut guard = self.app_handle.lock().unwrap();
        *guard = Some(handle);
    }

    fn emit_changed(&self) {
        if let Some(app) = self.app_handle.lock().unwrap().as_ref() {
            let snap = self.get_snapshot();
            let _ = app.emit("focus:changed", snap);
        }
    }

    pub fn get_snapshot(&self) -> FocusSnapshot {
        let mut snapshot = self.state_machine.lock().unwrap().snapshot();
        snapshot.is_locked |= self.reset_pending();
        snapshot
    }

    pub fn is_active(&self) -> bool {
        self.state_machine.lock().unwrap().is_active()
    }

    pub fn is_locked(&self) -> bool {
        self.reset_pending() || self.state_machine.lock().unwrap().is_locked()
    }

    pub(crate) fn reset_pending(&self) -> bool {
        self.reset_pending.load(Ordering::SeqCst)
    }

    pub(crate) fn reset_generation(&self) -> u64 {
        self.reset_generation.load(Ordering::SeqCst)
    }

    pub(crate) fn capture_start_generation(&self) -> Result<u64, String> {
        let _transition = self.transition.lock().unwrap();
        if self.reset_pending() {
            return Err("Timer reset is still completing.".into());
        }
        Ok(self.reset_generation())
    }

    pub(crate) fn finish_emergency_reset(&self) {
        let _transition = self.transition.lock().unwrap();
        self.reset_pending.store(false, Ordering::SeqCst);
        self.emit_changed();
    }

    pub fn should_hide_on_window_close(&self, min_to_tray_on_close: bool) -> bool {
        min_to_tray_on_close || self.is_active()
    }

    pub fn should_prevent_app_exit(&self) -> bool {
        self.is_locked()
    }

    pub fn execute_guarded_browser_mutation<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce() -> Result<R, String>,
    {
        let _transition = self.transition.lock().unwrap();
        if self.is_active() || self.is_locked() || self.get_snapshot().status != super::state::FocusStatus::Idle {
            return Err("Cannot modify browser extensions during an active focus session.".into());
        }
        f()
    }

    pub fn shutdown_blocking(&self) {
        let _lock = self.transition.lock().unwrap();
        if let Ok(conn) = self.db.lock() {
            let _ = self.repository.clear_run_journal(&conn);
        }
    }
    pub fn check_timer_command(&self, action: TimerAction) -> Result<(), String> {
        if self.reset_pending() {
            return Err("Timer reset is still completing.".into());
        }
        if !self.is_locked() {
            return Ok(());
        }
        match action {
            TimerAction::Reset => {
                Err("Timer reset is disabled while a focus session is active. Use emergency exit if needed.".to_string())
            }
            TimerAction::Skip => {
                Err("Timer skip is disabled while a focus session is active.".to_string())
            }
            TimerAction::Toggle | TimerAction::RestartRound => Ok(()),
        }
    }

    // --- Profile Management ---

    pub fn get_profiles(&self) -> Result<Vec<FocusProfile>, String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        self.repository.get_profiles(&conn).map_err(|e| e.to_string())
    }

    pub fn save_profile(&self, mut profile: FocusProfile) -> Result<FocusProfile, String> {
        if self.is_locked() {
            let snap = self.get_snapshot();
            if let Some(active) = snap.active_profile {
                if active.id == profile.id {
                    return Err("Cannot edit the currently active focus session.".to_string());
                }
            }
        }

        // Validate durations
        validate_profile_durations(
            profile.work_secs,
            profile.short_break_secs,
            profile.long_break_secs,
            profile.work_rounds,
        )
        .map_err(|e| e.to_string())?;

        // Normalize domains
        let mut normalized_domains = Vec::new();
        for d in &profile.blocked_domains {
            let norm = normalize_domain(d).map_err(|e| e.to_string())?;
            if !normalized_domains.contains(&norm) {
                normalized_domains.push(norm);
            }
        }
        profile.blocked_domains = normalized_domains;
        validate_domain_count(profile.blocked_domains.len()).map_err(|e| e.to_string())?;

        if profile.id.is_empty() {
            profile.id = uuid::Uuid::new_v4().to_string();
        }
        profile.revision += 1;

        let conn = self.db.lock().map_err(|e| e.to_string())?;
        self.repository.save_profile(&conn, &profile).map_err(|e| e.to_string())?;

        // If this profile was selected, update in-memory state
        {
            let mut sm = self.state_machine.lock().unwrap();
            let snap = sm.snapshot();
            if let Some(active) = &snap.active_profile {
                if active.id == profile.id {
                    let _ = sm.select_profile(Some(profile.clone()));
                }
            }
        }

        self.emit_changed();
        Ok(profile)
    }

    pub fn delete_profile(&self, id: &str) -> Result<bool, String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let profiles = self.repository.get_profiles(&conn).map_err(|e| e.to_string())?;
        if profiles.len() <= 1 {
            return Err("Cannot delete the only remaining session.".to_string());
        }

        if self.is_locked() {
            let snap = self.get_snapshot();
            if let Some(active) = snap.active_profile {
                if active.id == id {
                    return Err("Cannot delete the currently active focus session while locked.".to_string());
                }
            }
        }

        let next_profile = profiles.into_iter().find(|p| p.id != id);
        let deleted = self.repository.delete_profile(&conn, id).map_err(|e| e.to_string())?;
        if deleted {
            let is_selected = {
                let sm = self.state_machine.lock().unwrap();
                sm.snapshot().active_profile.as_ref().map(|p| p.id == id).unwrap_or(false)
            };
            if is_selected {
                if let Some(next) = next_profile {
                    let mut sm = self.state_machine.lock().unwrap();
                    let _ = sm.select_profile(Some(next.clone()));
                    drop(sm);
                    let mut prefs = self.repository.get_preferences(&conn).unwrap_or_default();
                    prefs.selected_profile_id = next.id;
                    let _ = self.repository.save_preferences(&conn, &prefs);
                }
            }
        }

        self.emit_changed();
        Ok(deleted)
    }

    pub fn select_profile(&self, id: &str) -> Result<FocusProfile, String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let profile = self.repository.get_profile(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Profile not found".to_string())?;

        let mut sm = self.state_machine.lock().unwrap();
        sm.select_profile(Some(profile.clone())).map_err(|e| e.to_string())?;

        let mut prefs = self.repository.get_preferences(&conn).unwrap_or_default();
        prefs.selected_profile_id = id.to_string();
        let _ = self.repository.save_preferences(&conn, &prefs);

        drop(sm);
        self.emit_changed();
        Ok(profile)
    }

    pub fn on_timer_reset(&self) {
        let mut sm = self.state_machine.lock().unwrap();
        let _ = sm.handle_reset();
        drop(sm);
        if let Ok(conn) = self.db.lock() {
            let _ = self.repository.clear_run_journal(&conn);
        }
        self.emit_changed();
    }


    pub fn set_unblock_during_breaks(&self, unblock: bool) -> Result<(), String> {
        let _transition = self.transition.lock().unwrap();
        {
            let conn = self.db.lock().map_err(|e| e.to_string())?;
            let mut prefs = self.repository.get_preferences(&conn).unwrap_or_default();
            prefs.unblock_during_breaks = unblock;
            self.repository.save_preferences(&conn, &prefs).map_err(|e| e.to_string())?;
        }

        let mut candidate = self.state_machine.lock().unwrap().clone();
        candidate.set_unblock_during_breaks(unblock);
        self.commit_enforcement_transition(candidate)
    }

    pub fn set_emergency_passphrase(&self, passphrase: &str) -> Result<(), String> {
        let hash = hash_passphrase(passphrase).map_err(|e| e.to_string())?;
        let _transition = self.transition.lock().unwrap();
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let mut prefs = self.repository.get_preferences(&conn).unwrap_or_default();
        prefs.emergency_passphrase_hash = Some(hash);
        self.repository.save_preferences(&conn, &prefs).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_emergency_passphrase(&self) -> Result<(), String> {
        let _transition = self.transition.lock().unwrap();
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let mut prefs = self.repository.get_preferences(&conn).unwrap_or_default();
        prefs.emergency_passphrase_hash = None;
        self.repository.save_preferences(&conn, &prefs).map_err(|e| e.to_string())?;
        Ok(())
    }

    // --- Emergency Exit ---

    pub fn start_emergency_hold(&self) -> String {
        self.escape_handler.start_hold()
    }

    pub fn pulse_emergency_hold(&self, attempt_id: &str) -> Result<bool, String> {
        let completed = self.escape_handler.pulse_hold(attempt_id).map_err(|e| e.to_string())?;
        if completed {
            self.execute_emergency_release()?;
        }
        Ok(completed)
    }

    pub fn cancel_emergency_hold(&self, attempt_id: &str) {
        self.escape_handler.cancel_hold(attempt_id);
    }

    pub fn submit_emergency_passphrase(&self, passphrase: &str) -> Result<bool, String> {
        let _transition = self.transition.lock().unwrap();
        let hash = {
            let conn = self.db.lock().map_err(|e| e.to_string())?;
            let prefs = self.repository.get_preferences(&conn).map_err(|e| e.to_string())?;
            prefs.emergency_passphrase_hash.ok_or_else(|| "No emergency passphrase configured".to_string())?
        };

        let attempt_id = self.escape_handler.submit_passphrase_first(passphrase, &hash).map_err(|e| e.to_string())?;
        let confirmed = self.escape_handler.submit_passphrase_confirm(&attempt_id, passphrase).map_err(|e| e.to_string())?;
        if confirmed {
            self.execute_emergency_release_locked()?;
        }
        Ok(confirmed)
    }

    pub fn execute_emergency_release(&self) -> Result<(), String> {
        let _transition = self.transition.lock().unwrap();
        self.execute_emergency_release_locked()
    }

    fn execute_emergency_release_locked(&self) -> Result<(), String> {
        let engine = self.engine.lock().unwrap().clone();
        if engine.is_some() {
            self.reset_pending.store(true, Ordering::SeqCst);
            self.reset_generation.fetch_add(1, Ordering::SeqCst);
        }
        let mut candidate = self.state_machine.lock().unwrap().clone();
        let result = candidate.handle_emergency_released().map_err(|e| e.to_string())
            .and_then(|()| self.commit_enforcement_transition(candidate));
        if result.is_ok() {
            if let Some(engine) = engine {
                engine.send(crate::timer::engine::TimerCommand::ResetCycle);
            }
        } else {
            self.reset_pending.store(false, Ordering::SeqCst);
            self.emit_changed();
        }
        result
    }

    // --- Hooks called by Timer Engine / Event Loop ---

    pub fn on_timer_started(&self, round_type: &str) -> Result<(), String> {
        let _transition = self.transition.lock().unwrap();
        self.on_timer_started_locked(round_type)
    }

    pub(crate) fn start_timer(&self, round_type: &str, generation: u64, start: impl FnOnce()) -> Result<(), String> {
        let _transition = self.transition.lock().unwrap();
        if generation != self.reset_generation() {
            return Err("Timer reset changed the current round. Try again.".into());
        }
        self.on_timer_started_locked(round_type)?;
        start();
        Ok(())
    }

    fn on_timer_started_locked(&self, round_type: &str) -> Result<(), String> {
        if self.reset_pending() {
            return Err("Timer reset is still completing.".into());
        }
        let mut candidate = self.state_machine.lock().unwrap().clone();
        if candidate.snapshot().status == super::state::FocusStatus::RecoveryRequired {
            return Err("Blocking cleanup is required before starting the timer.".into());
        }
        if candidate.snapshot().active_profile.is_none() {
            return Err("No session is selected.".into());
        }
        if round_type == "work" {
            candidate.handle_work_started().map_err(|e| e.to_string())?;
        }
        self.commit_enforcement_transition(candidate)
    }

    // Call only while holding the transition gate. Native work never holds state or DB locks.
    fn commit_enforcement_transition(&self, mut candidate: FocusStateMachine) -> Result<(), String> {
        let original = self.state_machine.lock().unwrap().clone();
        let previous = original.snapshot();
        let next = candidate.snapshot();
        let was_blocking = previous.enforcement.state == EnforcementState::Active;
        let should_block = next.blocking_active;
        self.state_machine.lock().unwrap().preparing();

        let result = (|| -> Result<(), String> {
            if should_block {
                let profile = next.active_profile.as_ref().ok_or("No session is selected.")?;
                if !was_blocking {
                    let journal = FocusRunJournal {
                        run_id: uuid::Uuid::new_v4().to_string(),
                        profile_snapshot_json: serde_json::to_string(profile).map_err(|e| e.to_string())?,
                        phase: next.current_phase.map(|p| p.as_str()).unwrap_or("work").into(),
                        current_round: next.current_work_round,
                        started_at: chrono_now_secs(),
                        lease_expires_at: chrono_now_secs() + 15,
                    };
                    {
                        let conn = self.db.lock().map_err(|e| e.to_string())?;
                        self.repository.save_run_journal(&conn, &journal).map_err(|e| e.to_string())?;
                    }
                    self.enforcer.apply_blocking(&profile.blocked_apps, &profile.blocked_domains)
                        .map_err(|e| e.to_string())?;
                    if let Ok(conn) = self.db.lock() {
                        if let Ok(settings) = crate::settings::load(&conn) {
                            if settings.dnd_enabled {
                                let enabled = crate::platform::dnd::set_dnd(true).unwrap_or(false);
                                self.dnd_active.store(enabled, Ordering::Relaxed);
                            }
                        }
                    }
                }
                candidate.set_enforcement(EnforcementStatus {
                    state: EnforcementState::Active,
                    applications_active: !profile.blocked_apps.is_empty(),
                    websites_active: !profile.blocked_domains.is_empty(),
                    error_code: None,
                });
            } else {
                if was_blocking || previous.enforcement.state == EnforcementState::RecoveryRequired {
                    self.enforcer.release_blocking().map_err(|e| e.to_string())?;
                }
                self.restore_dnd();
                let conn = self.db.lock().map_err(|e| e.to_string())?;
                self.repository.clear_run_journal(&conn).map_err(|e| e.to_string())?;
                candidate.set_enforcement(EnforcementStatus::default());
            }
            Ok(())
        })();

        if let Err(error) = result {
            let cleanup_ok = should_block && self.enforcer.release_blocking().is_ok();
            log::warn!("[focus] transition_failed action={} cleanup_ok={cleanup_ok}", if should_block { "apply" } else { "release" });
            let mut failed = if original.snapshot().status == super::state::FocusStatus::Idle {
                original
            } else {
                candidate
            };
            let recovered = cleanup_ok && self.db.lock().ok().map(|conn| {
                self.repository.clear_run_journal(&conn).is_ok()
            }).unwrap_or(false);
            failed.set_enforcement(EnforcementStatus {
                state: if recovered { EnforcementState::Failed } else { EnforcementState::RecoveryRequired },
                error_code: Some(if should_block { EnforcementErrorCode::ApplyFailed } else { EnforcementErrorCode::ReleaseFailed }),
                ..Default::default()
            });
            *self.state_machine.lock().unwrap() = failed;
            self.emit_changed();
            return Err(error);
        }
        *self.state_machine.lock().unwrap() = candidate;
        self.emit_changed();
        Ok(())
    }

    fn restore_dnd(&self) {
        if self.dnd_active.load(Ordering::Relaxed) && crate::platform::dnd::set_dnd(false).unwrap_or(false) {
            self.dnd_active.store(false, Ordering::Relaxed);
        }
    }

    pub fn check_enforcement_health(&self) -> Result<(), String> {
        let _transition = self.transition.lock().unwrap();
        let snapshot = self.get_snapshot();
        if snapshot.enforcement.state != EnforcementState::Active {
            return Ok(());
        }
        if let Err(error) = self.enforcer.renew_lease() {
            if let Some(engine) = self.engine.lock().unwrap().as_ref() {
                engine.send(crate::timer::engine::TimerCommand::Pause);
            }
            let released = self.enforcer.release_blocking().is_ok();
            self.state_machine.lock().unwrap().set_enforcement(EnforcementStatus {
                state: if released { EnforcementState::Failed } else { EnforcementState::RecoveryRequired },
                error_code: Some(EnforcementErrorCode::LeaseLost),
                ..Default::default()
            });
            self.emit_changed();
            if released {
                self.restore_dnd();
            }
            return Err(error.to_string());
        }
        Ok(())
    }

    pub fn start_supervisor(self: &Arc<Self>, engine: crate::timer::engine::EngineHandle) {
        *self.engine.lock().unwrap() = Some(engine.clone());
        let controller = Arc::downgrade(self);
        std::thread::Builder::new().name("focus-supervisor".into()).spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(super::enforcer::protocol::HEARTBEAT_SECS));
            let Some(controller) = controller.upgrade() else { break };
            if let Err(error) = controller.check_enforcement_health() {
                log::error!("[focus] enforcement lost: {error}");
            }
        }).expect("failed to start focus supervisor");
    }

    pub fn on_round_completed(&self, next_round: &str, cycle_finished: bool) -> Result<(), String> {
        let _transition = self.transition.lock().unwrap();
        if self.reset_pending() {
            return Err("Timer reset is still completing.".into());
        }
        let mut candidate = self.state_machine.lock().unwrap().clone();
        if !candidate.is_active() {
            return Ok(());
        }
        if cycle_finished {
            // Full cycle complete!
            candidate.handle_cycle_finished().map_err(|e| e.to_string())?;
        } else {
            let next_phase = match next_round {
                "work" => FocusPhase::Work,
                "short-break" => FocusPhase::ShortBreak,
                "long-break" => FocusPhase::LongBreak,
                _ => return Err("Invalid timer round type.".into()),
            };
            candidate.handle_round_completed(next_phase).map_err(|e| e.to_string())?;
        }
        self.commit_enforcement_transition(candidate)
    }
}

fn chrono_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_controller() -> Arc<FocusController> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        let db = Arc::new(Mutex::new(conn));
        let mock_enforcer = Arc::new(MockEnforcer::new());
        Arc::new(FocusController::new(db, Some(mock_enforcer)))
    }

    struct FailingEnforcer {
        fail_apply: std::sync::atomic::AtomicBool,
        fail_release: std::sync::atomic::AtomicBool,
        fail_renew: std::sync::atomic::AtomicBool,
    }

    impl FailingEnforcer {
        fn new(fail_apply: bool) -> Self {
            Self {
                fail_apply: std::sync::atomic::AtomicBool::new(fail_apply),
                fail_release: std::sync::atomic::AtomicBool::new(false),
                fail_renew: std::sync::atomic::AtomicBool::new(false),
            }
        }
    }

    impl NativeEnforcer for FailingEnforcer {
        fn apply_blocking(&self, _: &[super::super::model::AppTarget], _: &[String])
            -> Result<(), super::super::enforcer::EnforcerError>
        {
            if self.fail_apply.load(std::sync::atomic::Ordering::SeqCst) {
                Err(super::super::enforcer::EnforcerError::NotAuthorized)
            } else { Ok(()) }
        }
        fn release_blocking(&self) -> Result<(), super::super::enforcer::EnforcerError> {
            if self.fail_release.load(std::sync::atomic::Ordering::SeqCst) {
                Err(super::super::enforcer::EnforcerError::HostsFileError("denied".into()))
            } else { Ok(()) }
        }
        fn renew_lease(&self) -> Result<(), super::super::enforcer::EnforcerError> {
            if self.fail_renew.load(std::sync::atomic::Ordering::SeqCst) {
                Err(super::super::enforcer::EnforcerError::LeaseLost)
            } else { Ok(()) }
        }
    }

    fn controller_with_rules(enforcer: Arc<dyn NativeEnforcer>) -> FocusController {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        let controller = FocusController::new(Arc::new(Mutex::new(conn)), Some(enforcer));
        let mut profile = controller.get_profiles().unwrap().remove(0);
        profile.blocked_domains = vec!["example.com".into()];
        controller.save_profile(profile).unwrap();
        controller
    }

    #[test]
    #[ignore = "requires a disposable guest: native DND behavior is part of enforcement cleanup"]
    fn lease_loss_cannot_overtake_timer_start_command() {
        use crate::timer::engine::{self, TimerCommand, TimerEvent};
        use std::sync::mpsc;
        use std::time::Duration;

        assert_eq!(std::env::var("POMOTROID_DISPOSABLE_GUEST").as_deref(), Ok("1"));
        let enforcer = Arc::new(FailingEnforcer::new(false));
        enforcer.fail_renew.store(true, std::sync::atomic::Ordering::SeqCst);
        let controller = Arc::new(controller_with_rules(enforcer));
        let (engine, events) = engine::spawn(60, Duration::from_secs(1));
        *controller.engine.lock().unwrap() = Some(engine.clone());
        let (entered_tx, entered_rx) = mpsc::channel();
        let (proceed_tx, proceed_rx) = mpsc::channel();
        let (start_done_tx, start_done_rx) = mpsc::channel();
        let start_controller = controller.clone();
        let start_engine = engine.clone();
        std::thread::spawn(move || {
            let result = start_controller.start_timer("work", start_controller.reset_generation(), || {
                entered_tx.send(()).unwrap();
                proceed_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                start_engine.send(TimerCommand::Start);
            });
            let _ = start_done_tx.send(result);
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (health_started_tx, health_started_rx) = mpsc::channel();
        let (health_done_tx, health_done_rx) = mpsc::channel();
        let health_controller = controller.clone();
        std::thread::spawn(move || {
            let gate_held = health_controller.transition.try_lock().is_err();
            health_started_tx.send(gate_held).unwrap();
            let _ = health_done_tx.send(health_controller.check_enforcement_health());
        });
        let gate_held = health_started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let premature = health_done_rx.recv_timeout(Duration::from_secs(1));
        proceed_tx.send(()).unwrap();
        assert!(start_done_rx.recv_timeout(Duration::from_secs(10)).unwrap().is_ok());
        assert!(gate_held, "timer start did not hold the transition gate");
        assert!(matches!(premature, Err(mpsc::RecvTimeoutError::Timeout)), "lease loss overtook timer start");
        assert!(health_done_rx.recv_timeout(Duration::from_secs(10)).unwrap().is_err());
        assert!(matches!(events.recv_timeout(Duration::from_secs(2)), Ok(TimerEvent::Started { .. })));
        assert!(matches!(events.recv_timeout(Duration::from_secs(2)), Ok(TimerEvent::Paused { .. })));
        engine.send(TimerCommand::Shutdown);
    }

    #[test]
    fn test_start_failure_does_not_enter_work() {
        let controller = controller_with_rules(Arc::new(FailingEnforcer::new(true)));
        assert!(controller.on_timer_started("work").is_err());
        assert!(!controller.is_active());
        assert!(!controller.is_locked());
        assert!(!controller.get_snapshot().blocking_active);
        assert!(controller.repository.get_run_journal(&controller.db.lock().unwrap()).unwrap().is_none());
    }

    #[test]
    fn test_release_failure_preserves_recovery_state() {
        let enforcer = Arc::new(FailingEnforcer::new(false));
        let controller = controller_with_rules(enforcer.clone());
        let (engine, events) = crate::timer::engine::spawn(60, std::time::Duration::from_secs(10));
        *controller.engine.lock().unwrap() = Some(engine.clone());
        controller.on_timer_started("work").unwrap();
        enforcer.fail_release.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(controller.execute_emergency_release().is_err());
        assert_eq!(controller.get_snapshot().status, super::super::state::FocusStatus::RecoveryRequired);
        assert!(!controller.reset_pending());
        assert!(events.recv_timeout(std::time::Duration::from_millis(30)).is_err());
        assert!(controller.repository.get_run_journal(&controller.db.lock().unwrap()).unwrap().is_some());
        engine.send(crate::timer::engine::TimerCommand::Shutdown);
    }

    #[test]
    fn recovery_retry_can_release_and_clear_the_journal() {
        let enforcer = Arc::new(FailingEnforcer::new(false));
        let controller = controller_with_rules(enforcer.clone());
        controller.on_timer_started("work").unwrap();
        enforcer.fail_release.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(controller.execute_emergency_release().is_err());
        enforcer.fail_release.store(false, std::sync::atomic::Ordering::SeqCst);
        controller.execute_emergency_release().unwrap();
        assert!(!controller.is_active());
        assert!(!controller.is_locked());
        assert!(controller.repository.get_run_journal(&controller.db.lock().unwrap()).unwrap().is_none());
    }

    #[test]
    fn test_break_acquire_retry_advances_round_once() {
        let enforcer = Arc::new(FailingEnforcer::new(false));
        let controller = controller_with_rules(enforcer.clone());
        controller.set_unblock_during_breaks(true).unwrap();
        controller.on_timer_started("work").unwrap();
        controller.on_round_completed("short-break", false).unwrap();
        enforcer.fail_apply.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(controller.on_round_completed("work", false).is_err());
        assert!(!controller.get_snapshot().blocking_active);
        enforcer.fail_apply.store(false, std::sync::atomic::Ordering::SeqCst);
        controller.on_timer_started("work").unwrap();
        assert_eq!(controller.get_snapshot().current_work_round, 2);
        controller.on_timer_started("work").unwrap();
        assert_eq!(controller.get_snapshot().current_work_round, 2);
    }

    #[test]
    fn test_break_preference_releases_current_policy() {
        let enforcer = Arc::new(MockEnforcer::new());
        let controller = controller_with_rules(enforcer.clone());
        controller.on_timer_started("work").unwrap();
        controller.on_round_completed("short-break", false).unwrap();
        assert!(enforcer.is_active.load(std::sync::atomic::Ordering::SeqCst));
        controller.set_unblock_during_breaks(true).unwrap();
        assert!(!enforcer.is_active.load(std::sync::atomic::Ordering::SeqCst));
        assert!(!controller.get_snapshot().blocking_active);
    }

    #[test]
    fn test_emergency_release_resets_running_engine() {
        let controller = Arc::new(controller_with_rules(Arc::new(MockEnforcer::new())));
        let (engine, events) = crate::timer::engine::spawn(60, std::time::Duration::from_secs(1));
        controller.start_supervisor(engine.clone());
        controller.on_timer_started("work").unwrap();
        engine.send(crate::timer::engine::TimerCommand::Start);
        assert!(matches!(events.recv_timeout(std::time::Duration::from_secs(1)).unwrap(), crate::timer::engine::TimerEvent::Started { .. }));
        controller.execute_emergency_release().unwrap();
        assert!(controller.is_locked(), "reset must finish before unlocking");
        assert!(controller.capture_start_generation().is_err(), "generation capture must wait for reset");
        assert!(controller.start_timer("work", controller.reset_generation(), || {}).is_err(), "start must wait for timer reset");
        let event = events.recv_timeout(std::time::Duration::from_secs(1));
        engine.send(crate::timer::engine::TimerCommand::Shutdown);
        assert!(matches!(event, Ok(crate::timer::engine::TimerEvent::ResetCycle)));
    }

    #[test]
    fn test_profile_rejects_more_than_256_distinct_domains() {
        let controller = setup_test_controller();
        let mut profile = controller.get_profiles().unwrap().remove(0);
        profile.blocked_domains = (0..257).map(|i| format!("site{i}.example")).collect();
        assert!(controller.save_profile(profile).is_err());
        assert!(controller.get_profiles().unwrap()[0].blocked_domains.is_empty());
    }

    #[test]
    fn test_profile_domain_limit_counts_normalized_unique_domains() {
        let controller = setup_test_controller();
        let mut profile = controller.get_profiles().unwrap().remove(0);
        profile.blocked_domains = (0..256).map(|i| format!("site{i}.example")).collect();
        profile.blocked_domains.push("https://WWW.SITE0.EXAMPLE/path".to_string());
        let saved = controller.save_profile(profile).unwrap();
        assert_eq!(saved.blocked_domains.len(), 256);
        assert_eq!(saved.blocked_domains[0], "site0.example");
    }

    #[test]
    fn test_timer_reset_blocked_during_active_focus() {
        let controller = setup_test_controller();
        let profile = FocusProfile {
            id: "prof-1".to_string(),
            name: "Coding".to_string(),
            work_secs: 1500,
            short_break_secs: 300,
            long_break_secs: 900,
            work_rounds: 2,
            blocked_apps: vec![],
            blocked_domains: vec!["reddit.com".to_string()],
            revision: 1,
        };

        controller.save_profile(profile.clone()).unwrap();
        controller.select_profile("prof-1").unwrap();

        // Start work
        controller.on_timer_started("work").unwrap();
        assert!(controller.is_active());
        assert!(controller.is_locked());

        // Timer reset and skip must be blocked
        assert!(controller.check_timer_command(TimerAction::Reset).is_err());
        assert!(controller.check_timer_command(TimerAction::Skip).is_err());

        // Restart round and toggle are allowed
        assert!(controller.check_timer_command(TimerAction::RestartRound).is_ok());
        assert!(controller.check_timer_command(TimerAction::Toggle).is_ok());

        // Selecting another profile while active is rejected
        assert!(controller.select_profile("prof-1").is_err());

        // Emergency release unlocks
        controller.execute_emergency_release().unwrap();
        assert!(!controller.is_active());
        assert!(!controller.is_locked());
        assert!(controller.check_timer_command(TimerAction::Reset).is_ok());
    }

    #[test]
    fn test_empty_rules_timer_not_blocked() {
        let controller = setup_test_controller();
        let profile = FocusProfile {
            id: "empty-1".to_string(),
            name: "Ordinary".to_string(),
            work_secs: 1500,
            short_break_secs: 300,
            long_break_secs: 900,
            work_rounds: 4,
            blocked_apps: vec![],
            blocked_domains: vec![],
            revision: 1,
        };
        controller.save_profile(profile).unwrap();
        controller.select_profile("empty-1").unwrap();

        controller.on_timer_started("work").unwrap();
        assert!(controller.is_active());
        assert!(!controller.is_locked());
        assert!(controller.check_timer_command(TimerAction::Reset).is_ok());
        assert!(controller.check_timer_command(TimerAction::Skip).is_ok());

        controller.on_timer_reset();
        assert!(!controller.is_active());
    }

    #[test]
    fn test_cannot_delete_only_profile() {
        let controller = setup_test_controller();
        let profiles = controller.get_profiles().unwrap();
        assert_eq!(profiles.len(), 1);
        let res = controller.delete_profile(&profiles[0].id);
        assert!(res.is_err());
    }

    #[test]
    fn test_window_close_and_exit_persistence_policies() {
        let controller = setup_test_controller();
        assert!(!controller.is_active());
        assert!(!controller.is_locked());

        // When inactive, window close honors min_to_tray_on_close
        assert!(!controller.should_hide_on_window_close(false));
        assert!(controller.should_hide_on_window_close(true));
        assert!(!controller.should_prevent_app_exit());

        // Setup a profile with actual blocking rules so work round is locked
        let profile = FocusProfile {
            id: "prof-lock".to_string(),
            name: "Locked Focus".to_string(),
            work_secs: 1500,
            short_break_secs: 300,
            long_break_secs: 900,
            work_rounds: 4,
            blocked_apps: vec![],
            blocked_domains: vec!["social.example".to_string()],
            revision: 1,
        };
        controller.save_profile(profile).unwrap();
        controller.select_profile("prof-lock").unwrap();

        // Start a locked focus work round
        controller.on_timer_started("work").unwrap();
        assert!(controller.is_active());
        assert!(controller.is_locked());

        // While active/locked, window close always hides even if min_to_tray_on_close is false
        assert!(controller.should_hide_on_window_close(false));
        assert!(controller.should_hide_on_window_close(true));
        // And app exit is prevented while locked
        assert!(controller.should_prevent_app_exit());

        // When unlocked via emergency release, exit is allowed
        controller.execute_emergency_release().unwrap();
        assert!(!controller.is_active());
        assert!(!controller.is_locked());
        assert!(!controller.should_hide_on_window_close(false));
        assert!(!controller.should_prevent_app_exit());
    }
}
