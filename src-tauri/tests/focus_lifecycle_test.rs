use std::sync::{Arc, Mutex};
use pomotroid_lib::db::migrations;
use pomotroid_lib::focus::controller::{FocusController, TimerAction};
use pomotroid_lib::focus::enforcer::MockEnforcer;
use pomotroid_lib::focus::model::{AppTarget, FocusProfile, FocusRunJournal};
use pomotroid_lib::focus::repository::FocusRepository;
use pomotroid_lib::focus::state::FocusPhase;
use pomotroid_lib::timer::{advance_focus_sequence, sequence::SequenceState};

#[test]
fn real_timer_sequence_finishes_focus_at_the_end_of_each_configured_cycle() {
    for (short_enabled, long_enabled) in [(true, true), (false, true), (true, false), (false, false)] {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        let db = Arc::new(Mutex::new(conn));
        let enforcer = Arc::new(MockEnforcer::new());
        let controller = FocusController::new(db.clone(), Some(enforcer.clone()));
        let profile = FocusProfile {
            id: "sequence-cycle".into(), name: "Sequence cycle".into(),
            work_secs: 120, short_break_secs: 60, long_break_secs: 60, work_rounds: 2,
            blocked_apps: vec![], blocked_domains: vec!["example.com".into()], revision: 1,
        };
        controller.save_profile(profile).unwrap();
        controller.select_profile("sequence-cycle").unwrap();
        controller.set_unblock_during_breaks(true).unwrap();
        controller.on_timer_started("work").unwrap();
        let mut sequence = SequenceState::new(2, 120, 60, 60);
        let steps = match (short_enabled, long_enabled) {
            (true, _) => 4,
            (false, true) => 3,
            (false, false) => 2,
        };
        for step in 0..steps {
            let (_, next, _, cycle_finished) = advance_focus_sequence(&mut sequence, short_enabled, long_enabled);
            controller.on_round_completed(next.as_str(), cycle_finished).unwrap();
            if step + 1 < steps {
                assert!(controller.is_locked(), "released early at step {step}, short={short_enabled}, long={long_enabled}");
                if next.as_str() == "work" {
                    assert!(enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));
                    assert!(FocusRepository::new().get_run_journal(&db.lock().unwrap()).unwrap().is_some());
                }
            } else {
                assert!(!controller.is_locked(), "remained locked after cycle, short={short_enabled}, long={long_enabled}");
                assert!(!enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));
                assert!(FocusRepository::new().get_run_journal(&db.lock().unwrap()).unwrap().is_none());
            }
        }
    }
}

#[test]
fn test_full_focus_session_lifecycle() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::run(&conn).unwrap();
    let db = Arc::new(Mutex::new(conn));

    let mock_enforcer = Arc::new(MockEnforcer::new());
    let controller = Arc::new(FocusController::new(db.clone(), Some(mock_enforcer.clone())));

    // 1. Create Profile with 2 work rounds
    let profile = FocusProfile {
        id: "profile-deep-work".to_string(),
        name: "Deep Work".to_string(),
        work_secs: 1500,
        short_break_secs: 300,
        long_break_secs: 900,
        work_rounds: 2,
        blocked_apps: vec![AppTarget {
            id: "app-1".to_string(),
            name: "Discord".to_string(),
            identifier: "com.hnc.Discord".to_string(),
            platform: "macos".to_string(),
        }],
        blocked_domains: vec!["reddit.com".to_string(), "youtube.com".to_string()],
        revision: 1,
    };

    let saved = controller.save_profile(profile).unwrap();
    assert_eq!(saved.name, "Deep Work");

    // 2. Select profile
    controller.select_profile("profile-deep-work").unwrap();
    controller.set_unblock_during_breaks(true).unwrap();

    let snap = controller.get_snapshot();
    assert_eq!(snap.active_profile.as_ref().unwrap().name, "Deep Work");
    assert!(!snap.is_locked);
    assert!(!snap.blocking_active);

    // 3. Start Work Round 1
    controller.on_timer_started("work").unwrap();
    let snap_work_1 = controller.get_snapshot();
    assert!(snap_work_1.is_locked);
    assert!(snap_work_1.blocking_active);
    assert_eq!(snap_work_1.current_phase, Some(FocusPhase::Work));
    assert_eq!(snap_work_1.current_work_round, 1);
    assert!(mock_enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));
    assert_eq!(mock_enforcer.blocked_domains.lock().unwrap().len(), 2);

    // Verify session switching and reset are strictly blocked
    assert!(controller.select_profile("profile-deep-work").is_err());
    assert!(controller.check_timer_command(TimerAction::Reset).is_err());
    assert!(controller.check_timer_command(TimerAction::Skip).is_err());
    assert!(controller.check_timer_command(TimerAction::RestartRound).is_ok());

    // 4. Complete Work Round 1 -> Transition to Short Break
    controller.on_round_completed("short-break", false).unwrap();
    let snap_break = controller.get_snapshot();
    assert!(snap_break.is_locked); // Still locked
    assert!(!snap_break.blocking_active); // Unblocked during break
    assert!(!mock_enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));

    // 5. Complete Short Break -> Transition to Work Round 2
    controller.on_round_completed("work", false).unwrap();
    let snap_work_2 = controller.get_snapshot();
    assert!(snap_work_2.is_locked);
    assert!(snap_work_2.blocking_active); // Re-blocked
    assert_eq!(snap_work_2.current_work_round, 2);
    assert!(mock_enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));

    // 6. Complete Work Round 2 -> Transition to Long Break
    controller.on_round_completed("long-break", false).unwrap();
    let snap_long_break = controller.get_snapshot();
    assert!(snap_long_break.is_locked);
    assert!(!snap_long_break.blocking_active);

    // 7. Complete Long Break -> Cycle Complete!
    controller.on_round_completed("work", true).unwrap();
    let snap_final = controller.get_snapshot();
    assert!(!snap_final.is_locked);
    assert!(!snap_final.blocking_active);
    assert_eq!(snap_final.current_phase, None);
    assert!(!mock_enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));

    // Now reset and switching are allowed again
    assert!(controller.check_timer_command(TimerAction::Reset).is_ok());
    assert!(controller.select_profile("profile-deep-work").is_ok());
}

#[test]
fn test_emergency_exit_during_active_work() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::run(&conn).unwrap();
    let db = Arc::new(Mutex::new(conn));

    let mock_enforcer = Arc::new(MockEnforcer::new());
    let controller = Arc::new(FocusController::new(db.clone(), Some(mock_enforcer.clone())));

    let profile = FocusProfile {
        id: "prof-escape".to_string(),
        name: "Escape Test".to_string(),
        work_secs: 1500,
        short_break_secs: 300,
        long_break_secs: 900,
        work_rounds: 4,
        blocked_apps: vec![],
        blocked_domains: vec!["distraction.com".to_string()],
        revision: 1,
    };
    controller.save_profile(profile).unwrap();
    controller.select_profile("prof-escape").unwrap();

    // Start work
    controller.on_timer_started("work").unwrap();
    assert!(controller.is_active());
    assert!(mock_enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));

    // Execute emergency release
    controller.execute_emergency_release().unwrap();
    assert!(!controller.is_active());
    assert!(!controller.is_locked());
    assert!(!mock_enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));

    // Verify journal was cleared
    let repo = FocusRepository::new();
    let conn = db.lock().unwrap();
    assert!(repo.get_run_journal(&conn).unwrap().is_none());
}

#[test]
#[ignore = "requires disposable guest: release invokes native Do Not Disturb controls"]
fn valid_emergency_passphrase_releases_active_session_without_deadlock() {
    assert_eq!(std::env::var("POMOTROID_DISPOSABLE_GUEST").as_deref(), Ok("1"), "run only in a disposable guest");
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::run(&conn).unwrap();
    let db = Arc::new(Mutex::new(conn));
    let enforcer = Arc::new(MockEnforcer::new());
    let controller = Arc::new(FocusController::new(db.clone(), Some(enforcer.clone())));
    let profile = FocusProfile {
        id: "passphrase-release".to_string(),
        name: "Passphrase release".to_string(),
        work_secs: 1500,
        short_break_secs: 300,
        long_break_secs: 900,
        work_rounds: 2,
        blocked_apps: vec![],
        blocked_domains: vec!["example.com".to_string()],
        revision: 1,
    };
    controller.save_profile(profile).unwrap();
    controller.select_profile("passphrase-release").unwrap();
    let passphrase = "isolated-test-emergency-passphrase-123456789";
    controller.set_emergency_passphrase(passphrase).unwrap();
    controller.on_timer_started("work").unwrap();
    assert!(controller.is_locked());

    let (tx, rx) = std::sync::mpsc::channel();
    let worker = Arc::clone(&controller);
    std::thread::spawn(move || {
        let _ = tx.send(worker.submit_emergency_passphrase(passphrase));
    });
    let result = rx.recv_timeout(std::time::Duration::from_secs(20))
        .expect("emergency passphrase release did not complete");
    assert!(result.unwrap());
    assert!(!controller.is_locked());
    assert!(!controller.is_active());
    assert!(!enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));
    assert!(FocusRepository::new().get_run_journal(&db.lock().unwrap()).unwrap().is_none());
}

#[test]
#[ignore = "requires disposable guest: release invokes native Do Not Disturb controls"]
fn passphrase_clear_waits_until_inflight_emergency_release_finishes() {
    assert_eq!(std::env::var("POMOTROID_DISPOSABLE_GUEST").as_deref(), Ok("1"), "run only in a disposable guest");
    use pomotroid_lib::focus::enforcer::{EnforcerError, NativeEnforcer};
    use std::sync::mpsc;
    use std::time::Duration;

    struct PausedRelease {
        entered: mpsc::Sender<()>,
        proceed: Mutex<mpsc::Receiver<()>>,
    }
    impl NativeEnforcer for PausedRelease {
        fn apply_blocking(&self, _: &[AppTarget], _: &[String]) -> Result<(), EnforcerError> { Ok(()) }
        fn release_blocking(&self) -> Result<(), EnforcerError> {
            let _ = self.entered.send(());
            self.proceed.lock().unwrap().recv_timeout(Duration::from_secs(15))
                .map_err(|_| EnforcerError::LeaseLost)?;
            Ok(())
        }
        fn renew_lease(&self) -> Result<(), EnforcerError> { Ok(()) }
    }

    let conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::run(&conn).unwrap();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (proceed_tx, proceed_rx) = mpsc::channel();
    let enforcer = Arc::new(PausedRelease { entered: entered_tx, proceed: Mutex::new(proceed_rx) });
    let controller = Arc::new(FocusController::new(Arc::new(Mutex::new(conn)), Some(enforcer)));
    let profile = FocusProfile {
        id: "passphrase-race".into(), name: "Passphrase race".into(),
        work_secs: 1500, short_break_secs: 300, long_break_secs: 900, work_rounds: 2,
        blocked_apps: vec![], blocked_domains: vec!["example.com".into()], revision: 1,
    };
    controller.save_profile(profile).unwrap();
    controller.select_profile("passphrase-race").unwrap();
    let passphrase = "isolated-test-emergency-passphrase-123456789";
    controller.set_emergency_passphrase(passphrase).unwrap();
    controller.on_timer_started("work").unwrap();

    let (submit_tx, submit_rx) = mpsc::channel();
    let submit_controller = Arc::clone(&controller);
    std::thread::spawn(move || { let _ = submit_tx.send(submit_controller.submit_emergency_passphrase(passphrase)); });
    entered_rx.recv_timeout(Duration::from_secs(10)).expect("emergency release did not start");
    let (clear_started_tx, clear_started_rx) = mpsc::channel();
    let (clear_done_tx, clear_done_rx) = mpsc::channel();
    let clear_controller = Arc::clone(&controller);
    std::thread::spawn(move || {
        clear_started_tx.send(()).unwrap();
        let result = clear_controller.clear_emergency_passphrase();
        clear_done_tx.send(result).unwrap();
    });
    clear_started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let completed_before_release = clear_done_rx.recv_timeout(Duration::from_secs(1));
    proceed_tx.send(()).unwrap();
    let submitted = submit_rx.recv_timeout(Duration::from_secs(20)).expect("emergency release did not complete");

    assert!(matches!(completed_before_release, Err(mpsc::RecvTimeoutError::Timeout)),
        "passphrase clear completed before the in-flight release");
    assert!(submitted.unwrap());
    assert!(clear_done_rx.recv_timeout(Duration::from_secs(5)).unwrap().is_ok());
    assert!(!controller.is_locked());
}

#[test]
fn test_dirty_journal_cleanup_on_startup() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::run(&conn).unwrap();

    // Pre-seed a dirty interrupted run journal
    let repo = FocusRepository::new();
    let journal = FocusRunJournal {
        run_id: "crashed-run-1".to_string(),
        profile_snapshot_json: "{}".to_string(),
        phase: "work".to_string(),
        current_round: 1,
        started_at: 1000,
        lease_expires_at: 1015,
    };
    repo.save_run_journal(&conn, &journal).unwrap();
    assert!(repo.get_run_journal(&conn).unwrap().is_some());

    let db = Arc::new(Mutex::new(conn));
    let mock_enforcer = Arc::new(MockEnforcer::new());

    // Instantiating controller should detect dangling journal and clean it up
    let _controller = FocusController::new(db.clone(), Some(mock_enforcer));

    let conn = db.lock().unwrap();
    assert!(repo.get_run_journal(&conn).unwrap().is_none());
}

#[test]
fn test_empty_rule_session_allows_ordinary_reset_and_skip() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::run(&conn).unwrap();
    let db = Arc::new(Mutex::new(conn));
    let mock_enforcer = Arc::new(MockEnforcer::new());
    let controller = Arc::new(FocusController::new(db, Some(mock_enforcer.clone())));

    let empty_profile = FocusProfile {
        id: "profile-empty".to_string(),
        name: "Standard Pomodoro".to_string(),
        work_secs: 1500,
        short_break_secs: 300,
        long_break_secs: 900,
        work_rounds: 4,
        blocked_apps: vec![],
        blocked_domains: vec![],
        revision: 1,
    };
    controller.save_profile(empty_profile).unwrap();
    controller.select_profile("profile-empty").unwrap();

    // Start work round
    controller.on_timer_started("work").unwrap();
    let snap = controller.get_snapshot();

    // Must NOT be locked
    assert!(!snap.is_locked);
    assert!(!snap.blocking_active);
    assert!(!mock_enforcer.is_active.load(std::sync::atomic::Ordering::SeqCst));

    // Reset and skip MUST be allowed
    assert!(controller.check_timer_command(TimerAction::Reset).is_ok());
    assert!(controller.check_timer_command(TimerAction::Skip).is_ok());

    // Resetting transitions state machine to Idle
    controller.on_timer_reset();
    assert_eq!(controller.get_snapshot().status, pomotroid_lib::focus::state::FocusStatus::Idle);
}

#[test]
fn test_cannot_delete_last_remaining_profile() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::run(&conn).unwrap();
    let db = Arc::new(Mutex::new(conn));
    let mock_enforcer = Arc::new(MockEnforcer::new());
    let controller = Arc::new(FocusController::new(db, Some(mock_enforcer)));

    let profiles = controller.get_profiles().unwrap();
    assert_eq!(profiles.len(), 1);

    // Attempting to delete the only profile must fail
    let res = controller.delete_profile(&profiles[0].id);
    assert!(res.is_err());
    assert_eq!(controller.get_profiles().unwrap().len(), 1);
}
