use std::fs;
use pomotroid_lib::focus::browser::BrowserKind;
use pomotroid_lib::focus::enterprise_policy::{
    generate_firefox_policy, merge_firefox_policies, generate_chrome_external_config,
    write_policy_to_path,
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
fn test_generate_chrome_external_extension_json() {
    let config = generate_chrome_external_config(None);
    assert_eq!(config["external_update_url"], "https://clients2.google.com/service/update2/crx");

    let crx_path = std::path::Path::new("/tmp/focus.crx");
    let local_config = generate_chrome_external_config(Some(crx_path));
    assert_eq!(local_config["external_crx"], "/tmp/focus.crx");
    assert_eq!(local_config["external_version"], "1.0.0");
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
