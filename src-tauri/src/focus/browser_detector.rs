use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};

use super::app_catalog::{self, InstalledApplication};
use super::browser::BrowserKind;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstalledBrowser {
    pub kind: BrowserKind,
    pub name: String,
    pub executable_path: PathBuf,
    pub policy_path: Option<PathBuf>,
    pub is_installed: bool,
    pub is_extension_installed: bool,
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
        } else {
            None
        };

        if let Some((k, default_name)) = kind {
            if seen_kinds.insert(k) {
                let exec_path = PathBuf::from(&app.path);
                if exec_path.exists() {
                    let policy_path = compute_policy_path(k, &exec_path);
                    let is_extension_installed = policy_path
                        .as_ref()
                        .map(|p| super::enterprise_policy::is_policy_installed_at_path(k, p))
                        .unwrap_or(false);
                    browsers.push(InstalledBrowser {
                        kind: k,
                        name: if app.name.is_empty() { default_name.into() } else { app.name.clone() },
                        executable_path: exec_path,
                        policy_path,
                        is_installed: true,
                        is_extension_installed,
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

fn compute_policy_path(kind: BrowserKind, exec_path: &Path) -> Option<PathBuf> {
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
                return Some(PathBuf::from("/etc/firefox/policies/policies.json"));
            }
            #[cfg(target_os = "windows")]
            {
                if let Some(parent) = exec_path.parent() {
                    return Some(parent.join("distribution").join("policies.json"));
                }
            }
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
                return Some(PathBuf::from("/etc/zen/policies/policies.json"));
            }
            #[cfg(target_os = "windows")]
            {
                if let Some(parent) = exec_path.parent() {
                    return Some(parent.join("distribution").join("policies.json"));
                }
            }
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
                    let is_extension_installed = policy_path
                        .as_ref()
                        .map(|p| super::enterprise_policy::is_policy_installed_at_path(kind, p))
                        .unwrap_or(false);
                    detected.push(InstalledBrowser {
                        kind,
                        name: name.to_string(),
                        executable_path: path,
                        policy_path,
                        is_installed: true,
                        is_extension_installed,
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
