use pomotroid_lib::focus::browser::BrowserKind;
use pomotroid_lib::focus::browser_detector::{browsers_from_catalog, detect_installed_browsers, launch_browser};
use pomotroid_lib::focus::app_catalog::InstalledApplication;

#[test]
fn detects_identity_not_display_name() {
    let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&root).unwrap();
    let apps = ["com.google.Chrome", "org.mozilla.firefox", "app.zen-browser.zen", "evil.chrome"]
        .into_iter().enumerate().map(|(n, identifier)| {
            let path = root.join(format!("{n}.app"));
            std::fs::create_dir(&path).unwrap();
            InstalledApplication { id: n.to_string(), name: "Chrome".into(), identifier: identifier.into(), platform: "macos".into(), path: path.to_string_lossy().into() }
        }).collect::<Vec<_>>();
    let found = browsers_from_catalog(&apps);
    assert_eq!(found.iter().map(|b| b.kind).collect::<Vec<_>>(), vec![BrowserKind::Chrome, BrowserKind::Firefox, BrowserKind::Zen]);
    std::fs::remove_dir_all(&root).unwrap();
    assert!(browsers_from_catalog(&apps).is_empty());
}

#[test]
fn zen_serializes_and_launch_rejects_non_web_urls() {
    assert_eq!(serde_json::to_string(&BrowserKind::Zen).unwrap(), "\"zen\"");
    assert!(launch_browser(BrowserKind::Chrome, Some("file:///etc/passwd")).is_err());
    assert!(launch_browser(BrowserKind::Chrome, Some("--remote-debugging-port=9222")).is_err());
}

#[test]
fn discovers_real_installed_browsers() {
    for browser in detect_installed_browsers() {
        assert!(browser.executable_path.exists());
        eprintln!("Discovered {}: {}", browser.name, browser.executable_path.display());
    }
}
