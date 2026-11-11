use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};

use super::app_catalog::{self, InstalledApplication};
use super::browser::BrowserKind;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstalledBrowser {
    pub kind: BrowserKind,
    pub name: String,
    #[serde(default)]
    pub catalog_id: Option<String>,
    pub executable_path: PathBuf,
    pub policy_path: Option<PathBuf>,
    pub is_installed: bool,
    pub is_extension_installed: bool,
    #[serde(default)]
    pub is_default: bool,
}

pub fn browsers_from_catalog(apps: &[InstalledApplication]) -> Vec<InstalledBrowser> {
    let mut browsers = Vec::new();
    let mut seen_kinds = std::collections::HashSet::new();

    for app in apps {
        let kind = if app.identifier == "com.google.Chrome" || app.identifier.eq_ignore_ascii_case("chrome.exe") {
            Some((BrowserKind::Chrome, "Google Chrome"))
        } else if app.identifier == "org.mozilla.firefox" || app.identifier.eq_ignore_ascii_case("firefox.exe") {
            Some((BrowserKind::Firefox, "Mozilla Firefox"))
        } else if app.identifier == "app.zen-browser.zen" || app.identifier == "org.mozilla.zen" || app.identifier.eq_ignore_ascii_case("zen.exe") {
            Some((BrowserKind::Zen, "Zen Browser"))
        } else if app.identifier == "com.apple.Safari" || app.identifier.eq_ignore_ascii_case("safari.exe") {
            Some((BrowserKind::Safari, "Safari"))
        } else {
            None
        };

        if let Some((k, default_name)) = kind {
            if seen_kinds.insert(k) {
                let exec_path = PathBuf::from(&app.path);
                if exec_path.exists() {
                    let policy_path = compute_policy_path(k, &exec_path);
                    let is_extension_installed = extension_installed_from_policy(k, policy_path.as_deref());
                    browsers.push(InstalledBrowser {
                        kind: k,
                        name: if app.name.is_empty() { default_name.into() } else { app.name.clone() },
                        catalog_id: Some(app.id.clone()),
                        executable_path: exec_path,
                        policy_path,
                        is_installed: true,
                        is_extension_installed,
                        is_default: false,
                    });
                }
            }
        }
    }

    browsers.sort_by_key(|b| match b.kind {
        BrowserKind::Chrome => 0,
        BrowserKind::Firefox => 1,
        BrowserKind::Zen => 2,
        BrowserKind::Safari => 3,
    });

    browsers
}

fn extension_installed_from_policy(kind: BrowserKind, path: Option<&Path>) -> bool {
    if kind == BrowserKind::Chrome {
        return false;
    }
    path.is_some_and(|p| super::enterprise_policy::is_policy_installed_at_path(kind, p))
}

fn compute_policy_path(kind: BrowserKind, exec_path: &Path) -> Option<PathBuf> {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = exec_path;
    match kind {
        BrowserKind::Firefox => {
            #[cfg(target_os = "macos")]
            {
                if exec_path.extension().is_some_and(|ext| ext == "app") {
                    return Some(exec_path.join("Contents/Resources/distribution/policies.json"));
                }
            }
            #[cfg(target_os = "linux")]
            {
                Some(PathBuf::from("/etc/firefox/policies/policies.json"))
            }
            #[cfg(target_os = "windows")]
            {
                if let Some(parent) = exec_path.parent() {
                    return Some(parent.join("distribution").join("policies.json"));
                }
            }
            #[cfg(not(target_os = "linux"))]
            None
        }
        BrowserKind::Zen => {
            #[cfg(target_os = "macos")]
            {
                if exec_path.extension().is_some_and(|ext| ext == "app") {
                    return Some(exec_path.join("Contents/Resources/distribution/policies.json"));
                }
            }
            #[cfg(target_os = "linux")]
            {
                Some(PathBuf::from("/etc/zen/policies/policies.json"))
            }
            #[cfg(target_os = "windows")]
            {
                if let Some(parent) = exec_path.parent() {
                    return Some(parent.join("distribution").join("policies.json"));
                }
            }
            #[cfg(not(target_os = "linux"))]
            None
        }
        BrowserKind::Chrome => {
            #[cfg(target_os = "macos")]
            {
                if let Some(home) = std::env::var_os("HOME") {
                    return Some(PathBuf::from(home).join("Library/Application Support/Google/Chrome/External Extensions"));
                }
            }
            None
        }
        BrowserKind::Safari => None,
    }
}

pub fn detect_installed_browsers() -> Vec<InstalledBrowser> {
    let catalog = app_catalog::list().unwrap_or_default();
    let mut detected = browsers_from_catalog(&catalog.applications);

    // Fallback detection for known default locations if catalog missed them
    let mut check_fallback = |kind: BrowserKind, name: &str, candidates: &[&str]| {
        if !detected.iter().any(|b| b.kind == kind) {
            for candidate in candidates {
                let path = PathBuf::from(candidate);
                if path.exists() {
                    let policy_path = compute_policy_path(kind, &path);
                    let is_extension_installed = extension_installed_from_policy(kind, policy_path.as_deref());
                    detected.push(InstalledBrowser {
                        kind,
                        name: name.to_string(),
                        catalog_id: None,
                        executable_path: path,
                        policy_path,
                        is_installed: true,
                        is_extension_installed,
                        is_default: false,
                    });
                    break;
                }
            }
        }
    };

    #[cfg(target_os = "macos")]
    {
        check_fallback(BrowserKind::Chrome, "Google Chrome", &[
            "/Applications/Google Chrome.app",
        ]);
        check_fallback(BrowserKind::Firefox, "Mozilla Firefox", &[
            "/Applications/Firefox.app",
        ]);
        check_fallback(BrowserKind::Zen, "Zen Browser", &[
            "/Applications/Zen Browser.app",
            "/Applications/Zen.app",
        ]);
        check_fallback(BrowserKind::Safari, "Safari", &[
            "/System/Applications/Safari.app",
            "/Applications/Safari.app",
        ]);
    }

    #[cfg(target_os = "linux")]
    {
        check_fallback(BrowserKind::Chrome, "Google Chrome", &[
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
        ]);
        check_fallback(BrowserKind::Firefox, "Mozilla Firefox", &[
            "/usr/bin/firefox",
        ]);
        check_fallback(BrowserKind::Zen, "Zen Browser", &[
            "/usr/bin/zen-browser",
            "/usr/bin/zen",
        ]);
    }

    detected.sort_by_key(|b| match b.kind {
        BrowserKind::Chrome => 0,
        BrowserKind::Firefox => 1,
        BrowserKind::Zen => 2,
        BrowserKind::Safari => 3,
    });

    let default_kind = get_default_browser();
    for b in &mut detected {
        b.is_default = Some(b.kind) == default_kind;
    }

    detected
}

pub fn validate_url_for_launch(url: &str) -> Result<(), String> {
    if url.starts_with('-') || url.starts_with('/') {
        return Err("URL cannot start with flag or slash".into());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http and https URLs are allowed".into());
    }
    Ok(())
}

pub fn get_default_browser() -> Option<BrowserKind> {
    #[cfg(target_os = "macos")]
    unsafe {
        use std::ffi::c_void;
        #[link(name = "CoreServices", kind = "framework")]
        extern "C" {
            fn LSCopyDefaultHandlerForURLScheme(scheme: *const c_void) -> *const c_void;
        }
        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" {
            fn CFStringCreateWithCString(alloc: *const c_void, c_str: *const u8, encoding: u32) -> *const c_void;
            fn CFStringGetCString(the_string: *const c_void, buffer: *mut u8, buffer_size: isize, encoding: u32) -> bool;
            fn CFRelease(cf: *const c_void);
        }
        let scheme = CFStringCreateWithCString(std::ptr::null(), c"https".as_ptr().cast(), 0x08000100 /* kCFStringEncodingUTF8 */);
        if scheme.is_null() {
            return None;
        }
        let handler = LSCopyDefaultHandlerForURLScheme(scheme);
        CFRelease(scheme);
        if handler.is_null() {
            return None;
        }
        let mut buf = [0u8; 256];
        let ok = CFStringGetCString(handler, buf.as_mut_ptr(), buf.len() as isize, 0x08000100);
        CFRelease(handler);
        if !ok {
            return None;
        }
        let handler_str = std::ffi::CStr::from_bytes_until_nul(&buf).ok()?.to_str().ok()?;
        match handler_str {
            id if id.eq_ignore_ascii_case("com.google.chrome") => Some(BrowserKind::Chrome),
            id if id.eq_ignore_ascii_case("org.mozilla.firefox") => Some(BrowserKind::Firefox),
            id if id.eq_ignore_ascii_case("app.zen-browser.zen") || id.eq_ignore_ascii_case("org.mozilla.zen") => Some(BrowserKind::Zen),
            id if id.eq_ignore_ascii_case("com.apple.safari") => Some(BrowserKind::Safari),
            _ => None,
        }
    }
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("xdg-settings").args(["get", "default-web-browser"]).output().ok()?;
        let s = String::from_utf8_lossy(&output.stdout).to_lowercase();
        if s.contains("chrome") { Some(BrowserKind::Chrome) }
        else if s.contains("firefox") { Some(BrowserKind::Firefox) }
        else if s.contains("zen") { Some(BrowserKind::Zen) }
        else { None }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

pub fn launch_browser(browser: BrowserKind, url: Option<&str>) -> Result<(), String> {
    if let Some(u) = url {
        validate_url_for_launch(u)?;
    }

    let installed = detect_installed_browsers();
    let target = installed.into_iter().find(|b| b.kind == browser)
        .ok_or_else(|| format!("Browser {:?} is not installed or detected", browser))?;

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg("-a").arg(&target.executable_path);
        if let Some(u) = url {
            cmd.arg(u);
        }
        cmd.spawn().map_err(|e| format!("Failed to launch browser: {e}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut cmd = Command::new(&target.executable_path);
        if let Some(u) = url {
            cmd.arg(u);
        }
        cmd.spawn().map_err(|e| format!("Failed to launch browser: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod chrome_status_tests {
    use super::*;

    #[test]
    fn chrome_policy_file_does_not_prove_extension_is_installed() {
        let dir = std::env::temp_dir().join(format!("grace-chrome-policy-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let policy = dir.join(format!("{}.json", super::super::enterprise_policy::CHROME_EXTENSION_ID));
        std::fs::write(policy, "{}").unwrap();
        assert!(super::super::enterprise_policy::is_policy_installed_at_path(BrowserKind::Chrome, &dir));
        assert!(!extension_installed_from_policy(BrowserKind::Chrome, Some(&dir)));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
