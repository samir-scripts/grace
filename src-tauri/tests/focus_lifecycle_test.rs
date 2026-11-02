use std::sync::{Arc, Mutex};
use pomotroid_lib::db::migrations;
use pomotroid_lib::focus::controller::{FocusController, TimerAction};
use pomotroid_lib::focus::enforcer::MockEnforcer;
use pomotroid_lib::focus::model::{AppTarget, FocusProfile, FocusRunJournal};
use pomotroid_lib::focus::repository::FocusRepository;
use pomotroid_lib::focus::state::FocusPhase;

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
    controller.on_timer_started("work");
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
    controller.on_round_completed("work", "short-break", false);
    let snap_break = controller.get_snapshot();
    assert!(snap_break.is_locked); // Still locked
    assert!(!snap_break.blocking_active); // Unblocked during break
    assert!(!mock_enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));

    // 5. Complete Short Break -> Transition to Work Round 2
    controller.on_round_completed("short-break", "work", false);
    let snap_work_2 = controller.get_snapshot();
    assert!(snap_work_2.is_locked);
    assert!(snap_work_2.blocking_active); // Re-blocked
    assert_eq!(snap_work_2.current_work_round, 2);
    assert!(mock_enforcer.is_active.load(std::sync::atomic::Ordering::Relaxed));

    // 6. Complete Work Round 2 -> Transition to Long Break
    controller.on_round_completed("work", "long-break", true);
    let snap_long_break = controller.get_snapshot();
    assert!(snap_long_break.is_locked);
    assert!(!snap_long_break.blocking_active);

    // 7. Complete Long Break -> Cycle Complete!
    controller.on_round_completed("long-break", "work", true);
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
    controller.on_timer_started("work");
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
    controller.on_timer_started("work");
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
