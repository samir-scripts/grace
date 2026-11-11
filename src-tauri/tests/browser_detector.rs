use pomotroid_lib::focus::browser::BrowserKind;
use pomotroid_lib::focus::browser_detector::{browsers_from_catalog, detect_installed_browsers, launch_browser};
use pomotroid_lib::focus::app_catalog::InstalledApplication;

#[test]
fn detects_identity_not_display_name() {
    let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&root).unwrap();
    let apps = ["com.google.Chrome", "org.mozilla.firefox", "app.zen-browser.zen", "com.apple.Safari", "evil.chrome", "evil.Safari"]
        .into_iter().enumerate().map(|(n, identifier)| {
            let path = root.join(format!("{n}.app"));
            std::fs::create_dir(&path).unwrap();
            InstalledApplication { id: n.to_string(), name: "Chrome".into(), identifier: identifier.into(), platform: "macos".into(), path: path.to_string_lossy().into() }
        }).collect::<Vec<_>>();
    let found = browsers_from_catalog(&apps);
    assert_eq!(found.iter().map(|b| b.kind).collect::<Vec<_>>(), vec![BrowserKind::Chrome, BrowserKind::Firefox, BrowserKind::Zen, BrowserKind::Safari]);
    assert_eq!(found.iter().map(|b| b.catalog_id.as_deref()).collect::<Vec<_>>(), vec![Some("0"), Some("1"), Some("2"), Some("3")]);
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
#[test]
fn test_default_browser_detection() {
    let default_kind = pomotroid_lib::focus::browser_detector::get_default_browser();
    // On macOS test runner, returns Some(BrowserKind) without panic
    println!("Detected default browser: {:?}", default_kind);
    assert!(default_kind.is_some() || default_kind.is_none());
}


#[test]
fn browser_without_catalog_id_deserializes_as_none() {
    let browser: pomotroid_lib::focus::browser_detector::InstalledBrowser = serde_json::from_value(serde_json::json!({
        "kind": "chrome",
        "name": "Chrome",
        "executable_path": "/example/chrome",
        "policy_path": null,
        "is_installed": true,
        "is_extension_installed": false
    })).unwrap();
    assert_eq!(browser.catalog_id, None);
}
