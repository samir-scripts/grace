use std::fs;
use pomotroid_lib::focus::browser::BrowserKind;
use pomotroid_lib::focus::enterprise_policy::{
    generate_firefox_policy, merge_firefox_policies, unmerge_firefox_policies,
    generate_chrome_external_config, write_policy_to_path, is_policy_installed_at_path,
};
use serde_json::json;

#[test]
fn test_generate_firefox_zen_policies_json() {
    let xpi_path = std::path::Path::new("/tmp/pomotroid_focus.xpi");
    let policy = generate_firefox_policy(xpi_path);

    let ext_settings = &policy["policies"]["ExtensionSettings"]["focus@pomotroid.local"];
    assert_eq!(ext_settings["installation_mode"], "force_installed");
    assert_eq!(ext_settings["install_url"], "file:///tmp/pomotroid_focus.xpi");
}

#[test]
fn test_policy_merges_without_overwriting_foreign_entries() {
    let existing = json!({
        "policies": {
            "DisableAppUpdate": true,
            "ExtensionSettings": {
                "uBlock0@raymondhill.net": {
                    "installation_mode": "normal_installed"
                }
            }
        }
    });

    let xpi_path = std::path::Path::new("/tmp/pomotroid_focus.xpi");
    let merged = merge_firefox_policies(&existing, xpi_path);

    // Assert existing settings are preserved
    assert_eq!(merged["policies"]["DisableAppUpdate"], true);
    assert_eq!(merged["policies"]["ExtensionSettings"]["uBlock0@raymondhill.net"]["installation_mode"], "normal_installed");

    // Assert focus extension is added
    let focus = &merged["policies"]["ExtensionSettings"]["focus@pomotroid.local"];
    assert_eq!(focus["installation_mode"], "force_installed");
    assert_eq!(focus["install_url"], "file:///tmp/pomotroid_focus.xpi");
}

#[test]
fn test_policy_unmerges_and_preserves_foreign_entries() {
    let policy_with_foreign = json!({
        "policies": {
            "DisableAppUpdate": true,
            "ExtensionSettings": {
                "uBlock0@raymondhill.net": {
                    "installation_mode": "normal_installed"
                },
                "focus@pomotroid.local": {
                    "installation_mode": "force_installed",
                    "install_url": "file:///tmp/pomotroid_focus.xpi"
                }
            }
        }
    });

    let unmerged = unmerge_firefox_policies(&policy_with_foreign);
    assert!(unmerged.is_some());
    let remaining = unmerged.unwrap();

    assert_eq!(remaining["policies"]["DisableAppUpdate"], true);
    assert_eq!(remaining["policies"]["ExtensionSettings"]["uBlock0@raymondhill.net"]["installation_mode"], "normal_installed");
    assert!(remaining["policies"]["ExtensionSettings"].get("focus@pomotroid.local").is_none());
}

#[test]
fn test_policy_unmerges_to_none_when_only_focus_installed() {
    let only_focus = json!({
        "policies": {
            "ExtensionSettings": {
                "focus@pomotroid.local": {
                    "installation_mode": "force_installed",
                    "install_url": "file:///tmp/pomotroid_focus.xpi"
                }
            }
        }
    });

    let unmerged = unmerge_firefox_policies(&only_focus);
    assert!(unmerged.is_none());
}

#[test]
fn test_is_policy_installed_at_path_detection() {
    let temp_dir = std::env::temp_dir().join(format!("pomotroid-test-detect-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();
    let policy_file = temp_dir.join("policies.json");

    // 1. When absent
    assert!(!is_policy_installed_at_path(BrowserKind::Firefox, &policy_file));

    // 2. When foreign only
    fs::write(&policy_file, json!({ "policies": { "DisableAppUpdate": true } }).to_string()).unwrap();
    assert!(!is_policy_installed_at_path(BrowserKind::Firefox, &policy_file));

    // 3. When focus installed
    let focus_policy = json!({
        "policies": {
            "ExtensionSettings": {
                "focus@pomotroid.local": {
                    "installation_mode": "force_installed"
                }
            }
        }
    });
    fs::write(&policy_file, focus_policy.to_string()).unwrap();
    assert!(is_policy_installed_at_path(BrowserKind::Firefox, &policy_file));

    fs::remove_dir_all(temp_dir).unwrap();
}
#[test]
fn test_generate_chrome_external_extension_json() {
    let config = generate_chrome_external_config(None);
    assert_eq!(config["external_update_url"], "https://clients2.google.com/service/update2/crx");

    let crx_path = std::path::Path::new("/tmp/focus.crx");
    let local_config = generate_chrome_external_config(Some(crx_path));
    assert_eq!(local_config["external_crx"], "/tmp/focus.crx");
    assert_eq!(local_config["external_version"], "1.1.0");
}

#[test]
fn test_atomic_write_to_directory() {
    let temp_dir = std::env::temp_dir().join(format!("pomotroid-test-policy-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).unwrap();

    let target_file = temp_dir.join("distribution").join("policies.json");
    let payload = json!({ "test": "data" });

    write_policy_to_path(&target_file, &payload).unwrap();

    assert!(target_file.exists());
    let read_back: serde_json::Value = serde_json::from_str(&fs::read_to_string(&target_file).unwrap()).unwrap();
    assert_eq!(read_back["test"], "data");

    fs::remove_dir_all(temp_dir).unwrap();
}

#[test]
fn test_macos_gecko_plist_merges_without_overwriting_foreign_entries() {
    use pomotroid_lib::focus::enterprise_policy::{
        merge_macos_gecko_plist, unmerge_macos_gecko_plist,
    };

    let existing = json!({
        "EnterprisePoliciesEnabled": false,
        "DisableAppUpdate": true,
        "ExtensionSettings": {
            "uBlock0@raymondhill.net": {
                "installation_mode": "normal_installed"
            }
        },
        "NSWindow Frame MainWindow": "0 0 1000 700 0 0 1440 900"
    });

    let xpi_path = std::path::Path::new("/tmp/pomotroid_focus.xpi");
    let merged = merge_macos_gecko_plist(&existing, xpi_path);

    assert_eq!(merged["EnterprisePoliciesEnabled"], true);
    assert_eq!(merged["DisableAppUpdate"], true);
    assert_eq!(merged["NSWindow Frame MainWindow"], "0 0 1000 700 0 0 1440 900");
    assert_eq!(
        merged["ExtensionSettings"]["uBlock0@raymondhill.net"]["installation_mode"],
        "normal_installed"
    );
    assert_eq!(
        merged["ExtensionSettings"]["focus@pomotroid.local"]["installation_mode"],
        "force_installed"
    );
    assert_eq!(
        merged["ExtensionSettings"]["focus@pomotroid.local"]["install_url"],
        "file:///tmp/pomotroid_focus.xpi"
    );

    let unmerged = unmerge_macos_gecko_plist(&merged);
    assert_eq!(unmerged["EnterprisePoliciesEnabled"], true);
    assert_eq!(unmerged["DisableAppUpdate"], true);
    assert_eq!(unmerged["NSWindow Frame MainWindow"], "0 0 1000 700 0 0 1440 900");
    assert_eq!(
        unmerged["ExtensionSettings"]["uBlock0@raymondhill.net"]["installation_mode"],
        "normal_installed"
    );
    assert_eq!(unmerged["ExtensionSettings"].get("focus@pomotroid.local"), None);
}

#[test]
fn test_macos_gecko_plist_unmerges_empty_when_only_focus_installed() {
    use pomotroid_lib::focus::enterprise_policy::{
        merge_macos_gecko_plist, unmerge_macos_gecko_plist,
    };

    let xpi_path = std::path::Path::new("/tmp/pomotroid_focus.xpi");
    let merged = merge_macos_gecko_plist(&json!({}), xpi_path);
    assert_eq!(merged["EnterprisePoliciesEnabled"], true);
    assert_eq!(
        merged["ExtensionSettings"]["focus@pomotroid.local"]["installation_mode"],
        "force_installed"
    );

    let unmerged = unmerge_macos_gecko_plist(&merged);
    assert_eq!(unmerged, json!({}));
}

#[test]
fn test_stage_gecko_xpi_to_dir_preserves_bytes_verbatim_and_canonicalizes_url() {
    use pomotroid_lib::focus::enterprise_policy::{file_url_for_path, stage_gecko_xpi_to_dir};

    let temp_root = std::env::temp_dir().join(format!("pomotroid-test-xpi-{}", uuid::Uuid::new_v4()));
    let source_dir = temp_root.join("nested/dev/dist");
    let target_app_data = temp_root.join("app_data");
    fs::create_dir_all(&source_dir).unwrap();
    fs::create_dir_all(&target_app_data).unwrap();

    let fake_xpi = source_dir.join("focus@pomotroid.local.xpi");
    let test_bytes = b"PK\x03\x04fixture-signed-xpi-bytes-stream";
    fs::write(&fake_xpi, test_bytes).unwrap();

    let staged_path = stage_gecko_xpi_to_dir(&fake_xpi, &target_app_data).unwrap();
    assert!(staged_path.exists());
    assert_eq!(
        staged_path,
        fs::canonicalize(target_app_data.join("browser-extensions/firefox/focus@pomotroid.local.xpi")).unwrap()
    );
    assert_eq!(fs::read(&staged_path).unwrap(), test_bytes);

    let staged_url = file_url_for_path(&staged_path);
    assert!(staged_url.starts_with("file://"));
    assert!(!staged_url.contains(".."));
    assert!(staged_url.ends_with("focus@pomotroid.local.xpi"));

    fs::remove_dir_all(temp_root).unwrap();
}
