#![cfg(target_os = "macos")]

use std::sync::{Arc, Mutex};
use pomotroid_lib::db::migrations;
use pomotroid_lib::focus::controller::FocusController;
use pomotroid_lib::focus::enforcer::{EnforcerError, MockEnforcer, NativeEnforcer};
use pomotroid_lib::focus::model::{AppTarget, FocusProfile};

#[test]
fn focus_dnd_restores_only_a_successful_session_activation() {
    if let Ok(case) = std::env::var("POMOTROID_DND_FIXTURE_CASE") {
        let marker = std::path::PathBuf::from(std::env::var_os("POMOTROID_DND_MARKER").expect("fixture marker required"));
        let root = marker.parent().expect("fixture directory required");
        assert!(root.starts_with(std::env::temp_dir()));
        assert!(root.file_name().unwrap().to_string_lossy().starts_with("pomotroid-dnd-test-"));
        assert_eq!(std::env::var_os("PATH").as_deref(), Some(root.as_os_str()));
        assert!(root.join("shortcuts").is_file(), "fixture command required");
        struct LeaseLost;
        impl NativeEnforcer for LeaseLost {
            fn apply_blocking(&self, _: &[AppTarget], _: &[String]) -> Result<(), EnforcerError> { Ok(()) }
            fn release_blocking(&self) -> Result<(), EnforcerError> { Ok(()) }
            fn renew_lease(&self) -> Result<(), EnforcerError> { Err(EnforcerError::LeaseLost) }
        }
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        migrations::run(&conn).unwrap();
        let db = Arc::new(Mutex::new(conn));
        let enforcer: Arc<dyn NativeEnforcer> = if case.starts_with("lease") { Arc::new(LeaseLost) } else { Arc::new(MockEnforcer::new()) };
        let controller = Arc::new(FocusController::new(db.clone(), Some(enforcer)));
        let profile = FocusProfile {
            id: "dnd-fixture".into(), name: "DND fixture".into(),
            work_secs: 1500, short_break_secs: 300, long_break_secs: 900, work_rounds: 2,
            blocked_apps: vec![], blocked_domains: vec!["example.com".into()], revision: 1,
        };
        controller.save_profile(profile).unwrap();
        controller.select_profile("dnd-fixture").unwrap();
        if case != "disabled" {
            pomotroid_lib::settings::save_setting(&db.lock().unwrap(), "dnd_enabled", "true").unwrap();
        }
        controller.on_timer_started("work").unwrap();
        pomotroid_lib::settings::save_setting(&db.lock().unwrap(), "dnd_enabled", "false").unwrap();
        if case == "leasepause" {
            use pomotroid_lib::timer::engine::{self, TimerCommand, TimerEvent};
            use std::time::{Duration, Instant};
            let (engine, events) = engine::spawn(60, Duration::from_secs(1));
            engine.send(TimerCommand::Start);
            assert!(matches!(events.recv_timeout(Duration::from_secs(2)), Ok(TimerEvent::Started { .. })));
            controller.start_supervisor(engine.clone());
            let worker = controller.clone();
            std::thread::spawn(move || { let _ = worker.check_enforcement_health(); });
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let event = events.recv_timeout(deadline.saturating_duration_since(Instant::now())).expect("timer was not paused before DND restoration");
                if matches!(event, TimerEvent::Paused { .. }) { break; }
            }
            engine.send(TimerCommand::Shutdown);
            std::thread::sleep(Duration::from_secs(5));
        } else if case == "lease" {
            assert!(controller.check_enforcement_health().is_err());
        } else {
            controller.execute_emergency_release().unwrap();
        }
        return;
    }

    use std::os::unix::fs::PermissionsExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let root = std::env::temp_dir().join(format!("pomotroid-dnd-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let command = root.join("shortcuts");
    std::fs::write(&command, "#!/bin/sh\nprintf '%s\\n' \"$2\" >> \"$POMOTROID_DND_MARKER\"\nif [ \"$POMOTROID_DND_FIXTURE_CASE\" = failed ] && [ \"$2\" = 'Pomotroid DND On' ]; then exit 1; fi\nif [ \"$POMOTROID_DND_FIXTURE_CASE\" = leasepause ] && [ \"$2\" = 'Pomotroid DND Off' ]; then /bin/sleep 4; fi\n").unwrap();
    std::fs::set_permissions(&command, std::fs::Permissions::from_mode(0o700)).unwrap();
    for (case, expected) in [
        ("disabled", ""),
        ("enabled", "Pomotroid DND On\nPomotroid DND Off\n"),
        ("failed", "Pomotroid DND On\n"),
        ("lease", "Pomotroid DND On\nPomotroid DND Off\n"),
        ("leasepause", "Pomotroid DND On\nPomotroid DND Off\n"),
    ] {
        let marker = root.join(format!("{case}.log"));
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "focus_dnd_restores_only_a_successful_session_activation", "--nocapture"])
            .env("PATH", &root).env("POMOTROID_DND_FIXTURE_CASE", case).env("POMOTROID_DND_MARKER", &marker)
            .stdout(Stdio::null()).stderr(Stdio::inherit()).spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() { break status; }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("DND fixture {case} timed out");
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        assert!(status.success(), "DND fixture {case} failed: {status}");
        assert_eq!(std::fs::read_to_string(&marker).unwrap_or_default(), expected, "DND fixture {case}");
    }
    std::fs::remove_dir_all(root).unwrap();
}
