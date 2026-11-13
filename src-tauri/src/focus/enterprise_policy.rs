use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use serde_json::json;

use super::browser::BrowserKind;
use super::browser_detector::detect_installed_browsers;

pub const FIREFOX_EXTENSION_ID: &str = "focus@pomotroid.local";
pub const CHROME_EXTENSION_ID: &str = super::native_messaging::DEFAULT_CHROME_EXT_ID;
pub const CHROME_DEFAULT_UPDATE_URL: &str = "https://clients2.google.com/service/update2/crx";

pub fn file_url_for_path(path: &Path) -> String {
    let abs_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join(path)
    };
    let canonical = fs::canonicalize(&abs_path).unwrap_or(abs_path);
    url::Url::from_file_path(&canonical)
        .map(|u| u.to_string())
        .unwrap_or_else(|_| format!("file://{}", canonical.to_string_lossy()))
}

pub fn stage_gecko_xpi_to_dir(source_xpi: &Path, app_data_dir: &Path) -> Result<PathBuf, String> {
    if !source_xpi.is_file() {
        return Err(format!("Source extension XPI not found at {}", source_xpi.display()));
    }
    let dest_dir = app_data_dir.join("browser-extensions/firefox");
    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create extension staging directory {}: {e}", dest_dir.display()))?;
    let dest_file = dest_dir.join(format!("{FIREFOX_EXTENSION_ID}.xpi"));
    let temp_file = dest_dir.join(format!(".tmp.xpi.{}", uuid::Uuid::new_v4()));

    let bytes = fs::read(source_xpi)
        .map_err(|e| format!("Failed to read source XPI {}: {e}", source_xpi.display()))?;
    {
        let mut f = File::create(&temp_file)
            .map_err(|e| format!("Failed to create temporary staged XPI {}: {e}", temp_file.display()))?;
        f.write_all(&bytes)
            .map_err(|e| format!("Failed to write temporary staged XPI: {e}"))?;
        f.flush()
            .map_err(|e| format!("Failed to flush temporary staged XPI: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("Failed to sync temporary staged XPI: {e}"))?;
    }
    fs::rename(&temp_file, &dest_file)
        .map_err(|e| {
            let _ = fs::remove_file(&temp_file);
            format!("Failed to finalize staged XPI at {}: {e}", dest_file.display())
        })?;
    Ok(fs::canonicalize(&dest_file).unwrap_or(dest_file))
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

pub fn merge_macos_gecko_plist(existing: &serde_json::Value, xpi_path: &Path) -> serde_json::Value {
    let mut root = existing.clone();
    if !root.is_object() {
        root = json!({});
    }
    let obj = root.as_object_mut().unwrap();
    obj.insert("EnterprisePoliciesEnabled".to_string(), json!(true));

    let ext_settings = obj.entry("ExtensionSettings").or_insert_with(|| json!({}));
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

pub fn unmerge_macos_gecko_plist(existing: &serde_json::Value) -> serde_json::Value {
    let mut root = existing.clone();
    if !root.is_object() {
        return json!({});
    }
    let obj = root.as_object_mut().unwrap();
    if let Some(ext_settings) = obj.get_mut("ExtensionSettings").and_then(|v| v.as_object_mut()) {
        ext_settings.remove(FIREFOX_EXTENSION_ID);
        if ext_settings.is_empty() {
            obj.remove("ExtensionSettings");
        }
    }
    // If no other enterprise policies or extension settings remain, drop the activation flag
    let has_other_policies = obj.keys().any(|k| {
        k != "EnterprisePoliciesEnabled"
            && k != "NSWindow Frame MainWindow"
            && !k.starts_with("NS")
            && !k.starts_with("Apple")
    });
    if !has_other_policies {
        obj.remove("EnterprisePoliciesEnabled");
    }
    root
}

#[cfg(target_os = "macos")]
fn find_enclosing_app_bundle(path: &Path) -> Option<PathBuf> {
    let mut curr = path;
    while let Some(parent) = curr.parent() {
        if curr.extension().and_then(|s| s.to_str()) == Some("app") {
            return Some(curr.to_path_buf());
        }
        curr = parent;
    }
    None
}

#[cfg(target_os = "macos")]
pub fn resolve_macos_gecko_bundle_id(browser: BrowserKind, policy_path: &Path) -> String {
    if let Some(app_bundle) = find_enclosing_app_bundle(policy_path) {
        let plist = app_bundle.join("Contents/Info.plist");
        if plist.is_file() {
            if let Ok(out) = std::process::Command::new("/usr/bin/plutil")
                .args(["-extract", "CFBundleIdentifier", "raw", "-o", "-"])
                .arg(&plist)
                .output()
            {
                if out.status.success() {
                    let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !id.is_empty() {
                        return id;
                    }
                }
            }
        }
    }
    match browser {
        BrowserKind::Zen => "app.zen-browser.zen".to_string(),
        _ => "org.mozilla.firefox".to_string(),
    }
}

#[cfg(target_os = "macos")]
pub fn read_macos_plist_domain(bundle_id: &str) -> serde_json::Value {
    let out = std::process::Command::new("/usr/bin/defaults")
        .args(["export", bundle_id, "-"])
        .output();
    let Ok(out) = out else { return json!({}); };
    if !out.status.success() || out.stdout.is_empty() {
        return json!({});
    }
    let mut child = match std::process::Command::new("/usr/bin/plutil")
        .args(["-convert", "json", "-o", "-", "-"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return json!({}),
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(&out.stdout);
    }
    let json_out = child.wait_with_output();
    let Ok(json_out) = json_out else { return json!({}); };
    if !json_out.status.success() {
        return json!({});
    }
    serde_json::from_slice(&json_out.stdout).unwrap_or_else(|_| json!({}))
}

#[cfg(target_os = "macos")]
pub fn write_macos_plist_domain(bundle_id: &str, content: &serde_json::Value) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(content)
        .map_err(|e| format!("Failed to serialize macOS preferences JSON: {e}"))?;
    let temp_json = std::env::temp_dir().join(format!("pomotroid-plist-{}.json", uuid::Uuid::new_v4()));
    let temp_plist = std::env::temp_dir().join(format!("pomotroid-plist-{}.plist", uuid::Uuid::new_v4()));
    fs::write(&temp_json, serialized.as_bytes())
        .map_err(|e| format!("Failed to write temporary preferences JSON: {e}"))?;

    let convert_res = std::process::Command::new("/usr/bin/plutil")
        .args(["-convert", "xml1", "-o"])
        .arg(&temp_plist)
        .arg(&temp_json)
        .status();
    let _ = fs::remove_file(&temp_json);
    match convert_res {
        Ok(s) if s.success() => {},
        Ok(s) => {
            let _ = fs::remove_file(&temp_plist);
            return Err(format!("plutil failed with status {s} while converting preferences for {bundle_id}"));
        }
        Err(e) => {
            let _ = fs::remove_file(&temp_plist);
            return Err(format!("Failed to execute plutil: {e}"));
        }
    }

    // defaults import merges keys rather than deleting missing keys.
    // When content has no ExtensionSettings, explicitly delete ExtensionSettings
    // and EnterprisePoliciesEnabled so removed policies do not persist in cfprefsd.
    let ext_empty = content.get("ExtensionSettings")
        .and_then(|e| e.as_object())
        .map(|o| o.is_empty())
        .unwrap_or(true);
    if ext_empty {
        let _ = std::process::Command::new("/usr/bin/defaults")
            .args(["delete", bundle_id, "ExtensionSettings"])
            .status();
        if content.get("EnterprisePoliciesEnabled").is_none() {
            let _ = std::process::Command::new("/usr/bin/defaults")
                .args(["delete", bundle_id, "EnterprisePoliciesEnabled"])
                .status();
        }
    }

    let import_res = std::process::Command::new("/usr/bin/defaults")
        .args(["import", bundle_id])
        .arg(&temp_plist)
        .status();
    let _ = fs::remove_file(&temp_plist);
    match import_res {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("defaults import failed with status {s} for domain {bundle_id}")),
        Err(e) => Err(format!("Failed to execute defaults import for {bundle_id}: {e}")),
    }
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

    // Unmanaged Chrome uses native messaging registration, not a force-install policy.
    if browser == BrowserKind::Chrome && target.policy_path.is_none() {
        return Ok(());
    }

    let policy_path = target.policy_path
        .ok_or_else(|| format!("Could not determine policy path for {:?}", browser))?;

    match browser {
        BrowserKind::Firefox | BrowserKind::Zen => {
            #[cfg(target_os = "macos")]
            if policy_path.extension().and_then(|s| s.to_str()) != Some("json") || find_enclosing_app_bundle(&policy_path).is_some() {
                let bundle_id = resolve_macos_gecko_bundle_id(browser, &policy_path);
                let existing = read_macos_plist_domain(&bundle_id);
                let merged = merge_macos_gecko_plist(&existing, extension_path);
                return write_macos_plist_domain(&bundle_id, &merged);
            }

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

    // There is no managed Chrome policy to remove on these platforms.
    if browser == BrowserKind::Chrome && target.policy_path.is_none() {
        return Ok(());
    }

    let policy_path = target.policy_path
        .ok_or_else(|| format!("Could not determine policy path for {:?}", browser))?;

    match browser {
        BrowserKind::Firefox | BrowserKind::Zen => {
            let mut found_any = false;
            #[cfg(target_os = "macos")]
            {
                let bundle_id = resolve_macos_gecko_bundle_id(browser, &policy_path);
                let existing = read_macos_plist_domain(&bundle_id);
                if existing.get("ExtensionSettings")
                    .and_then(|e| e.get(FIREFOX_EXTENSION_ID))
                    .is_some()
                {
                    found_any = true;
                    let unmerged = unmerge_macos_gecko_plist(&existing);
                    write_macos_plist_domain(&bundle_id, &unmerged)?;
                }
            }

            if policy_path.exists() {
                let existing_text = fs::read_to_string(&policy_path)
                    .map_err(|e| format!("Cannot read existing policy file {}: {e}", policy_path.display()))?;
                let existing_json = serde_json::from_str(&existing_text)
                    .map_err(|e| format!("Malformed existing policy JSON in {}: {e}", policy_path.display()))?;

                found_any = true;
                if let Some(remaining) = unmerge_firefox_policies(&existing_json) {
                    write_policy_to_path(&policy_path, &remaining)?;
                } else {
                    fs::remove_file(&policy_path)
                        .map_err(|e| format!("Failed to delete policy file {}: {e}", policy_path.display()))?;
                }
            }
            if !found_any {
                return Ok(());
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
            #[cfg(target_os = "macos")]
            {
                let bundle_id = resolve_macos_gecko_bundle_id(browser, policy_path);
                let plist_json = read_macos_plist_domain(&bundle_id);
                if plist_json.get("EnterprisePoliciesEnabled").and_then(|v| v.as_bool()) == Some(true)
                    && plist_json.get("ExtensionSettings")
                        .and_then(|e| e.get(FIREFOX_EXTENSION_ID))
                        .and_then(|s| s.get("installation_mode"))
                        .and_then(|m| m.as_str()) == Some("force_installed")
                {
                    return true;
                }
            }
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
