use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use serde_json::json;

use super::browser::BrowserKind;
use super::browser_detector::detect_installed_browsers;

pub const FIREFOX_EXTENSION_ID: &str = "focus@pomotroid.local";
pub const CHROME_EXTENSION_ID: &str = "pomotroid-focus-companion";
pub const CHROME_DEFAULT_UPDATE_URL: &str = "https://clients2.google.com/service/update2/crx";

pub fn file_url_for_path(path: &Path) -> String {
    let abs_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join(path)
    };
    url::Url::from_file_path(&abs_path)
        .map(|u| u.to_string())
        .unwrap_or_else(|_| format!("file://{}", abs_path.to_string_lossy()))
}

pub fn generate_firefox_policy(xpi_path: &Path) -> serde_json::Value {
    json!({
        "policies": {
            "ExtensionSettings": {
                FIREFOX_EXTENSION_ID: {
                    "installation_mode": "force_installed",
                    "install_url": file_url_for_path(xpi_path)
                }
            }
        }
    })
}

pub fn merge_firefox_policies(existing: &serde_json::Value, xpi_path: &Path) -> serde_json::Value {
    let mut root = existing.clone();
    if !root.is_object() {
        root = json!({});
    }

    let policies = root.as_object_mut().unwrap()
        .entry("policies")
        .or_insert_with(|| json!({}));

    if !policies.is_object() {
        *policies = json!({});
    }

    let ext_settings = policies.as_object_mut().unwrap()
        .entry("ExtensionSettings")
        .or_insert_with(|| json!({}));

    if !ext_settings.is_object() {
        *ext_settings = json!({});
    }

    ext_settings.as_object_mut().unwrap().insert(
        FIREFOX_EXTENSION_ID.to_string(),
        json!({
            "installation_mode": "force_installed",
            "install_url": file_url_for_path(xpi_path)
        }),
    );

    root
}

pub fn unmerge_firefox_policies(existing: &serde_json::Value) -> Option<serde_json::Value> {
    let mut root = existing.clone();
    if !root.is_object() {
        return None;
    }

    if let Some(policies) = root.get_mut("policies").and_then(|p| p.as_object_mut()) {
        if let Some(ext_settings) = policies.get_mut("ExtensionSettings").and_then(|e| e.as_object_mut()) {
            ext_settings.remove(FIREFOX_EXTENSION_ID);
            if ext_settings.is_empty() {
                policies.remove("ExtensionSettings");
            }
        }
        if policies.is_empty() {
            let has_other_root_keys = root.as_object().map(|o| o.keys().any(|k| k != "policies")).unwrap_or(false);
            if !has_other_root_keys {
                return None;
            }
        }
    }

    Some(root)
}

pub fn generate_chrome_external_config(crx_path: Option<&Path>) -> serde_json::Value {
    if let Some(path) = crx_path {
        json!({
            "external_crx": path.to_string_lossy(),
            "external_version": "1.0.0"
        })
    } else {
        json!({
            "external_update_url": CHROME_DEFAULT_UPDATE_URL
        })
    }
}

pub fn write_policy_to_path(target_file: &Path, content: &serde_json::Value) -> Result<(), String> {
    let parent = target_file.parent()
        .ok_or_else(|| format!("Target file {} has no parent directory", target_file.display()))?;

    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;

    let temp_file = parent.join(format!(".tmp.policies.{}", uuid::Uuid::new_v4()));
    let serialized = serde_json::to_string_pretty(content)
        .map_err(|e| format!("Failed to serialize policy: {e}"))?;

    {
        let mut file = File::create(&temp_file)
            .map_err(|e| format!("Failed to create temporary file {}: {e}", temp_file.display()))?;
        file.write_all(serialized.as_bytes())
            .map_err(|e| format!("Failed to write temporary file: {e}"))?;
        file.flush()
            .map_err(|e| format!("Failed to flush temporary file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync temporary file: {e}"))?;
    }

    fs::rename(&temp_file, target_file)
        .map_err(|e| {
            let _ = fs::remove_file(&temp_file);
            format!("Failed to rename temporary file to {}: {e}", target_file.display())
        })?;

    Ok(())
}

pub fn install_browser_enterprise_policy(browser: BrowserKind, extension_path: &Path) -> Result<(), String> {
    let browsers = detect_installed_browsers();
    let target = browsers.into_iter().find(|b| b.kind == browser)
        .ok_or_else(|| format!("Browser {:?} is not installed", browser))?;

    let policy_path = target.policy_path
        .ok_or_else(|| format!("Could not determine policy path for {:?}", browser))?;

    match browser {
        BrowserKind::Firefox | BrowserKind::Zen => {
            let policy = if policy_path.exists() {
                let existing_text = fs::read_to_string(&policy_path)
                    .map_err(|e| format!("Cannot read existing policy file {}: {e}", policy_path.display()))?;
                let existing_json = serde_json::from_str(&existing_text)
                    .map_err(|e| format!("Malformed existing policy JSON in {}: {e}", policy_path.display()))?;
                merge_firefox_policies(&existing_json, extension_path)
            } else {
                generate_firefox_policy(extension_path)
            };
            write_policy_to_path(&policy_path, &policy)?;
        }
        BrowserKind::Chrome => {
            let chrome_file = policy_path.join(format!("{CHROME_EXTENSION_ID}.json"));
            let config = generate_chrome_external_config(Some(extension_path));
            write_policy_to_path(&chrome_file, &config)?;
        }
        BrowserKind::Safari => {
            return Err("Enterprise policy force-installation is not supported for Safari".into());
        }
    }

    Ok(())
}

pub fn remove_browser_enterprise_policy(browser: BrowserKind) -> Result<(), String> {
    let browsers = detect_installed_browsers();
    let target = browsers.into_iter().find(|b| b.kind == browser)
        .ok_or_else(|| format!("Browser {:?} is not installed", browser))?;

    let policy_path = target.policy_path
        .ok_or_else(|| format!("Could not determine policy path for {:?}", browser))?;

    match browser {
        BrowserKind::Firefox | BrowserKind::Zen => {
            if !policy_path.exists() {
                return Ok(());
            }
            let existing_text = fs::read_to_string(&policy_path)
                .map_err(|e| format!("Cannot read existing policy file {}: {e}", policy_path.display()))?;
            let existing_json = serde_json::from_str(&existing_text)
                .map_err(|e| format!("Malformed existing policy JSON in {}: {e}", policy_path.display()))?;

            if let Some(remaining) = unmerge_firefox_policies(&existing_json) {
                write_policy_to_path(&policy_path, &remaining)?;
            } else {
                let _ = fs::remove_file(&policy_path);
            }
        }
        BrowserKind::Chrome => {
            let chrome_file = policy_path.join(format!("{CHROME_EXTENSION_ID}.json"));
            if chrome_file.exists() {
                fs::remove_file(&chrome_file)
                    .map_err(|e| format!("Failed to remove Chrome policy file {}: {e}", chrome_file.display()))?;
            }
        }
        BrowserKind::Safari => {
            return Err("Extension removal is not supported for Safari".into());
        }
    }

    Ok(())
}

pub fn is_policy_installed_at_path(browser: BrowserKind, policy_path: &Path) -> bool {
    match browser {
        BrowserKind::Firefox | BrowserKind::Zen => {
            if let Ok(content) = fs::read_to_string(policy_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    return json["policies"]["ExtensionSettings"][FIREFOX_EXTENSION_ID].is_object();
                }
            }
            false
        }
        BrowserKind::Chrome => {
            let chrome_file = policy_path.join(format!("{CHROME_EXTENSION_ID}.json"));
            chrome_file.exists()
        }
        BrowserKind::Safari => false,
    }
}

pub fn is_policy_installed(browser: BrowserKind) -> bool {
    let browsers = detect_installed_browsers();
    let Some(target) = browsers.into_iter().find(|b| b.kind == browser) else {
        return false;
    };

    let Some(policy_path) = target.policy_path else {
        return false;
    };

    is_policy_installed_at_path(browser, &policy_path)
}
