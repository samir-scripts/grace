use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::db::DbState;
use super::enforcer::{MockEnforcer, NativeEnforcer, SystemEnforcer};
use super::escape::EscapeHandler;
use super::model::{FocusPreferences, FocusProfile, FocusRunJournal};
use super::repository::FocusRepository;
use super::security::hash_passphrase;
use super::state::{FocusPhase, FocusSnapshot, FocusStateMachine};
use super::validation::{normalize_domain, validate_profile_durations};

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
}

impl FocusController {
    pub fn new(db: DbState, enforcer: Option<Arc<dyn NativeEnforcer>>) -> Self {
        let repo = FocusRepository::new();
        let enforcer = enforcer.unwrap_or_else(|| Arc::new(SystemEnforcer::new()));
        let mut sm = FocusStateMachine::new();

        // Load preferences on startup
        if let Ok(conn) = db.lock() {
            if let Ok(prefs) = repo.get_preferences(&conn) {
                sm.set_unblock_during_breaks(prefs.unblock_during_breaks);
                if let Some(prof_id) = &prefs.selected_profile_id {
                    if let Ok(Some(profile)) = repo.get_profile(&conn, prof_id) {
                        let _ = sm.select_profile(Some(profile));
                    }
                }
            }

            // Check if there was an interrupted dirty run in journal
            if let Ok(Some(journal)) = repo.get_run_journal(&conn) {
                log::warn!(
                    "[focus] Found leftover focus journal run_id={}. Cleaning up dangling enforcement.",
                    journal.run_id
                );
                let _ = enforcer.release_blocking();
                let _ = repo.clear_run_journal(&conn);
            }
        }

        Self {
            state_machine: Mutex::new(sm),
            escape_handler: Arc::new(EscapeHandler::new()),
            repository: repo,
            enforcer,
            db,
            app_handle: Mutex::new(None),
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
        self.state_machine.lock().unwrap().snapshot()
    }

    pub fn is_active(&self) -> bool {
        self.state_machine.lock().unwrap().is_active()
    }

    pub fn is_locked(&self) -> bool {
        self.state_machine.lock().unwrap().is_locked()
    }

    pub fn check_timer_command(&self, action: TimerAction) -> Result<(), String> {
        let is_active = self.is_active();
        match action {
            TimerAction::Reset => {
                if is_active {
                    return Err("Timer reset is disabled while a focus session is active. Use emergency exit if needed.".to_string());
                }
            }
            TimerAction::Skip => {
                if is_active {
                    return Err("Timer skip is disabled while a focus session is active.".to_string());
                }
            }
            TimerAction::Toggle | TimerAction::RestartRound => {}
        }
        Ok(())
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
        if self.is_locked() {
            let snap = self.get_snapshot();
            if let Some(active) = snap.active_profile {
                if active.id == id {
                    return Err("Cannot delete the currently active focus session.".to_string());
                }
            }
        }

        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let deleted = self.repository.delete_profile(&conn, id).map_err(|e| e.to_string())?;
        if deleted {
            let mut sm = self.state_machine.lock().unwrap();
            let snap = sm.snapshot();
            if let Some(active) = &snap.active_profile {
                if active.id == id {
                    let _ = sm.select_profile(None);
                }
            }
        }

        self.emit_changed();
        Ok(deleted)
    }

    pub fn select_profile(&self, id: Option<String>) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;

        let profile = if let Some(prof_id) = &id {
            self.repository.get_profile(&conn, prof_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Profile not found".to_string())?
        } else {
            // Deselect
            let mut sm = self.state_machine.lock().unwrap();
            sm.select_profile(None).map_err(|e| e.to_string())?;
            let mut prefs = self.repository.get_preferences(&conn).unwrap_or_default();
            prefs.selected_profile_id = None;
            let _ = self.repository.save_preferences(&conn, &prefs);
            drop(sm);
            self.emit_changed();
            return Ok(());
        };

        let mut sm = self.state_machine.lock().unwrap();
        sm.select_profile(Some(profile)).map_err(|e| e.to_string())?;

        let mut prefs = self.repository.get_preferences(&conn).unwrap_or_default();
        prefs.selected_profile_id = id;
        let _ = self.repository.save_preferences(&conn, &prefs);

        drop(sm);
        self.emit_changed();
        Ok(())
    }

    pub fn set_unblock_during_breaks(&self, unblock: bool) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let mut prefs = self.repository.get_preferences(&conn).unwrap_or_default();
        prefs.unblock_during_breaks = unblock;
        self.repository.save_preferences(&conn, &prefs).map_err(|e| e.to_string())?;

        let mut sm = self.state_machine.lock().unwrap();
        sm.set_unblock_during_breaks(unblock);
        drop(sm);

        self.emit_changed();
        Ok(())
    }

    pub fn set_emergency_passphrase(&self, passphrase: &str) -> Result<(), String> {
        let hash = hash_passphrase(passphrase).map_err(|e| e.to_string())?;
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let mut prefs = self.repository.get_preferences(&conn).unwrap_or_default();
        prefs.emergency_passphrase_hash = Some(hash);
        self.repository.save_preferences(&conn, &prefs).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_emergency_passphrase(&self) -> Result<(), String> {
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
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let prefs = self.repository.get_preferences(&conn).map_err(|e| e.to_string())?;
        let hash = prefs.emergency_passphrase_hash.ok_or_else(|| "No emergency passphrase configured".to_string())?;

        let attempt_id = self.escape_handler.submit_passphrase_first(passphrase, &hash).map_err(|e| e.to_string())?;
        let confirmed = self.escape_handler.submit_passphrase_confirm(&attempt_id, passphrase).map_err(|e| e.to_string())?;
        if confirmed {
            self.execute_emergency_release()?;
        }
        Ok(confirmed)
    }

    pub fn execute_emergency_release(&self) -> Result<(), String> {
        let _ = self.enforcer.release_blocking();
        {
            let mut sm = self.state_machine.lock().unwrap();
            sm.handle_emergency_released().map_err(|e| e.to_string())?;
        }
        if let Ok(conn) = self.db.lock() {
            let _ = self.repository.clear_run_journal(&conn);
        }
        self.emit_changed();
        Ok(())
    }

    // --- Hooks called by Timer Engine / Event Loop ---

    pub fn on_timer_started(&self, round_type: &str) {
        let mut sm = self.state_machine.lock().unwrap();
        if sm.snapshot().active_profile.is_none() {
            return;
        }

        if round_type == "work" {
            let _ = sm.handle_work_started();
            if let Some(prof) = &sm.snapshot().active_profile {
                let _ = self.enforcer.apply_blocking(&prof.blocked_apps, &prof.blocked_domains);
                // Record run journal
                if let Ok(conn) = self.db.lock() {
                    let journal = FocusRunJournal {
                        run_id: uuid::Uuid::new_v4().to_string(),
                        profile_snapshot_json: serde_json::to_string(prof).unwrap_or_default(),
                        phase: "work".to_string(),
                        current_round: sm.snapshot().current_work_round,
                        started_at: chrono_now_secs(),
                        lease_expires_at: chrono_now_secs() + 15,
                    };
                    let _ = self.repository.save_run_journal(&conn, &journal);
                }
            }
        }
        drop(sm);
        self.emit_changed();
    }

    pub fn on_timer_tick(&self) {
        if self.is_active() {
            self.enforcer.renew_lease();
        }
    }

    pub fn on_round_completed(&self, completed_round: &str, next_round: &str, is_last_round: bool) {
        let mut sm = self.state_machine.lock().unwrap();
        if !sm.is_active() {
            return;
        }

        if is_last_round && completed_round == "long-break" {
            // Full cycle complete!
            let _ = self.enforcer.release_blocking();
            let _ = sm.handle_cycle_finished();
            if let Ok(conn) = self.db.lock() {
                let _ = self.repository.clear_run_journal(&conn);
            }
        } else {
            let next_phase = match next_round {
                "work" => FocusPhase::Work,
                "short-break" => FocusPhase::ShortBreak,
                "long-break" => FocusPhase::LongBreak,
                _ => FocusPhase::Work,
            };

            let _ = sm.handle_round_completed(next_phase);
            let snap = sm.snapshot();

            if snap.blocking_active {
                if let Some(prof) = &snap.active_profile {
                    let _ = self.enforcer.apply_blocking(&prof.blocked_apps, &prof.blocked_domains);
                }
            } else {
                let _ = self.enforcer.release_blocking();
            }
        }

        drop(sm);
        self.emit_changed();
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
        controller.select_profile(Some("prof-1".to_string())).unwrap();

        // Start work
        controller.on_timer_started("work");
        assert!(controller.is_active());
        assert!(controller.is_locked());

        // Timer reset and skip must be blocked
        assert!(controller.check_timer_command(TimerAction::Reset).is_err());
        assert!(controller.check_timer_command(TimerAction::Skip).is_err());

        // Restart round and toggle are allowed
        assert!(controller.check_timer_command(TimerAction::RestartRound).is_ok());
        assert!(controller.check_timer_command(TimerAction::Toggle).is_ok());

        // Selecting another profile while active is rejected
        assert!(controller.select_profile(None).is_err());

        // Emergency release unlocks
        controller.execute_emergency_release().unwrap();
        assert!(!controller.is_active());
        assert!(!controller.is_locked());
        assert!(controller.check_timer_command(TimerAction::Reset).is_ok());
    }
}
