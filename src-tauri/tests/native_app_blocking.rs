#![cfg(target_os = "macos")]

use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use pomotroid_lib::focus::enforcer::apps::ApplicationMonitor;
use pomotroid_lib::focus::model::AppTarget;

struct Fixture(Child);
impl Drop for Fixture {
    fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
}
fn wait_for_exit(child: &mut Child) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if child.try_wait().unwrap().is_some() { return true; }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

#[test]
#[ignore = "launches a disposable macOS GUI application; requires swiftc and a GUI session"]
fn blocked_app_relaunch_is_stopped_until_release() {
    let dir = std::env::temp_dir().join(format!("pomotroid-fixture-{}", uuid::Uuid::new_v4()));
    let bundle = dir.join("FocusFixture.app/Contents");
    std::fs::create_dir_all(bundle.join("MacOS")).unwrap();
    let id = format!("com.splode.pomotroid.fixture{}", uuid::Uuid::new_v4().simple());
    std::fs::write(bundle.join("Info.plist"), format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>{id}</string><key>CFBundleExecutable</key><string>FocusFixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>")).unwrap();
    let source = dir.join("fixture.swift");
    std::fs::write(&source, "import AppKit\nlet app = NSApplication.shared\napp.setActivationPolicy(.prohibited)\napp.run()\n").unwrap();
    let executable = bundle.join("MacOS/FocusFixture");
    assert!(Command::new("swiftc").arg(&source).arg("-o").arg(&executable).status().unwrap().success());
    let launch = || Fixture(Command::new(&executable).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap());
    let mut initial = launch();
    std::thread::sleep(Duration::from_millis(500));
    assert!(initial.0.try_wait().unwrap().is_none());
    let monitor = ApplicationMonitor::start(vec![AppTarget { id: "fixture".into(), name: "Fixture".into(), identifier: id, platform: "macos".into() }]).unwrap();
    assert!(wait_for_exit(&mut initial.0));
    for _ in 0..3 {
        let mut child = launch();
        assert!(wait_for_exit(&mut child.0), "reopened fixture remained alive");
    }
    assert!(monitor.health().is_ok());
    monitor.stop().unwrap();
    let mut released = launch();
    std::thread::sleep(Duration::from_millis(750));
    assert!(released.0.try_wait().unwrap().is_none());
    drop(released);
    std::fs::remove_dir_all(dir).unwrap();
}
