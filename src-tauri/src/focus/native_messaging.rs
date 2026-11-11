use std::io::{Read, Write};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024; // 1 MB
pub const HOST_NAME: &str = "com.splode.pomotroid";
pub const DEFAULT_FIREFOX_EXT_ID: &str = "focus@pomotroid.local";
pub const DEFAULT_CHROME_EXT_ID: &str = "ddiojihepmbimcfoefnebpolgaljlcfn";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NativeInboundMessage {
    Connect,
    AppearanceGet,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NativeOutboundMessage {
    Config {
        token: String,
        port: u16,
        protocol_version: u8,
    },
    Appearance { version: u8, colors: HashMap<String, String>, animations_enabled: bool },
}

pub fn read_native_message<T: for<'de> Deserialize<'de>>(reader: &mut impl Read) -> Result<T, String> {
    let mut len_bytes = [0u8; 4];
    reader.read_exact(&mut len_bytes).map_err(|e| format!("Failed to read message length: {e}"))?;
    let len = u32::from_ne_bytes(len_bytes) as usize;

    if len > MAX_MESSAGE_BYTES {
        return Err(format!("Message size {len} exceeds maximum allowed size {MAX_MESSAGE_BYTES}"));
    }

    let mut buffer = vec![0u8; len];
    reader.read_exact(&mut buffer).map_err(|e| format!("Failed to read message payload: {e}"))?;

    serde_json::from_slice(&buffer).map_err(|e| format!("Invalid JSON message: {e}"))
}

pub fn write_native_message<T: Serialize>(writer: &mut impl Write, msg: &T) -> Result<(), String> {
    let json_bytes = serde_json::to_vec(msg).map_err(|e| format!("Failed to serialize message: {e}"))?;
    let len = json_bytes.len();

    if len > MAX_MESSAGE_BYTES {
        return Err(format!("Message size {len} exceeds maximum allowed size {MAX_MESSAGE_BYTES}"));
    }

    let len_bytes = (len as u32).to_ne_bytes();
    writer.write_all(&len_bytes).map_err(|e| format!("Failed to write message length: {e}"))?;
    writer.write_all(&json_bytes).map_err(|e| format!("Failed to write message payload: {e}"))?;
    writer.flush().map_err(|e| format!("Failed to flush message writer: {e}"))?;

    Ok(())
}

pub fn generate_chrome_manifest(executable_path: &Path, allowed_extension_ids: &[&str]) -> serde_json::Value {
    let origins: Vec<String> = allowed_extension_ids
        .iter()
        .map(|id| format!("chrome-extension://{id}/"))
        .collect();

    json!({
        "name": HOST_NAME,
        "description": "Pomotroid Focus Native Messaging Host",
        "path": executable_path.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": origins
    })
}

pub fn generate_mozilla_manifest(executable_path: &Path, allowed_extension_ids: &[&str]) -> serde_json::Value {
    let extensions: Vec<String> = allowed_extension_ids.iter().map(|id| id.to_string()).collect();

    json!({
        "name": HOST_NAME,
        "description": "Pomotroid Focus Native Messaging Host",
        "path": executable_path.to_string_lossy(),
        "type": "stdio",
        "allowed_extensions": extensions
    })
}

pub fn get_chrome_manifest_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/Google/Chrome/NativeMessagingHosts"))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config/google-chrome/NativeMessagingHosts"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA").map(|h| PathBuf::from(h).join("Google/Chrome/User Data/NativeMessagingHosts"))
    }
}

pub fn get_mozilla_manifest_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/Mozilla/NativeMessagingHosts"))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".mozilla/native-messaging-hosts"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|h| PathBuf::from(h).join("Mozilla/NativeMessagingHosts"))
    }
}

fn chrome_id_from_key(key: &str) -> Result<String, String> {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let invalid = || "Chrome extension public key is invalid.".to_string();
    let decoded = base64::engine::general_purpose::STANDARD.decode(key).map_err(|_| invalid())?;
    if decoded.is_empty() || base64::engine::general_purpose::STANDARD.encode(&decoded) != key {
        return Err(invalid());
    }
    let digest = Sha256::digest(&decoded);
    Ok(digest[..16].iter().flat_map(|b| [((b >> 4) + b'a') as char, ((b & 15) + b'a') as char]).collect())
}

fn parse_release_chrome_id(config: &str) -> Result<String, String> {
    let invalid = || "Chrome Web Store identity is not configured or is invalid.".to_string();
    let value: serde_json::Value = serde_json::from_str(config).map_err(|_| invalid())?;
    let id = value["extension_id"].as_str().ok_or_else(invalid)?;
    let key = value["public_key"].as_str().ok_or_else(invalid)?;
    if id.len() != 32 || !id.bytes().all(|b| (b'a'..=b'p').contains(&b))
        || id == DEFAULT_CHROME_EXT_ID || chrome_id_from_key(key).map_err(|_| invalid())? != id {
        return Err(invalid());
    }
    Ok(id.to_string())
}

pub fn validate_unpacked_chrome_identity(dir: &Path, expected_id: &str) -> Result<(), String> {
    let invalid = || "Chrome extension package does not match the native host identity. Rebuild the extension package.".to_string();
    let manifest = std::fs::read(dir.join("manifest.json")).map_err(|_| invalid())?;
    let value: serde_json::Value = serde_json::from_slice(&manifest).map_err(|_| invalid())?;
    let key = value["key"].as_str().ok_or_else(invalid)?;
    if chrome_id_from_key(key).map_err(|_| invalid())? != expected_id { return Err(invalid()); }
    Ok(())
}

pub fn unpacked_chrome_id() -> Result<String, String> {
    #[cfg(debug_assertions)]
    { Ok(DEFAULT_CHROME_EXT_ID.to_string()) }
    #[cfg(not(debug_assertions))]
    { release_chrome_id() }
}

pub fn release_chrome_id() -> Result<String, String> {
    parse_release_chrome_id(include_str!("../../../extensions/chrome/release.json"))
}

#[cfg(target_os = "windows")]
fn register_windows_host(browser_key: &str, manifest: &Path) -> Result<(), String> {
    let status = std::process::Command::new("reg")
        .args(["add", &format!(r"HKCU\Software\{browser_key}\NativeMessagingHosts\{HOST_NAME}"), "/ve", "/t", "REG_SZ", "/d", &manifest.to_string_lossy(), "/f"])
        .output().map_err(|_| "Failed to start native messaging registry registration.".to_string())?;
    if !status.status.success() {
        return Err("Failed to register native messaging host in Windows registry.".into());
    }
    Ok(())
}

fn write_chrome_manifest(executable_path: &Path, extension_id: &str) -> Result<(), String> {
    let chrome_dir = get_chrome_manifest_dir().ok_or("Cannot locate Chrome native messaging directory.")?;
    std::fs::create_dir_all(&chrome_dir).map_err(|e| format!("Failed to create Chrome manifest dir: {e}"))?;
    let chrome_file = chrome_dir.join(format!("{HOST_NAME}.json"));
    let content = serde_json::to_string_pretty(&generate_chrome_manifest(executable_path, &[extension_id])).map_err(|e| e.to_string())?;
    std::fs::write(&chrome_file, content).map_err(|e| format!("Failed to write Chrome manifest: {e}"))?;
    #[cfg(target_os = "windows")]
    register_windows_host(r"Google\Chrome", &chrome_file)?;
    Ok(())
}

fn validate_host(executable_path: &Path) -> Result<(), String> {
    if !executable_path.exists() {
        return Err(format!("Native host executable does not exist at {}", executable_path.display()));
    }
    Ok(())
}

pub fn register_release_chrome_manifest(executable_path: &Path) -> Result<String, String> {
    let id = release_chrome_id()?;
    validate_host(executable_path)?;
    write_chrome_manifest(executable_path, &id)?;
    Ok(format!("https://chromewebstore.google.com/detail/{id}"))
}

pub fn register_mozilla_manifest(executable_path: &Path) -> Result<(), String> {
    validate_host(executable_path)?;
    let mozilla_dir = get_mozilla_manifest_dir().ok_or("Cannot locate Mozilla native messaging directory.")?;
    std::fs::create_dir_all(&mozilla_dir).map_err(|e| format!("Failed to create Mozilla manifest dir: {e}"))?;
    let mozilla_file = mozilla_dir.join(format!("{HOST_NAME}.json"));
    let content = serde_json::to_string_pretty(&generate_mozilla_manifest(executable_path, &[DEFAULT_FIREFOX_EXT_ID])).map_err(|e| e.to_string())?;
    std::fs::write(&mozilla_file, content).map_err(|e| format!("Failed to write Mozilla manifest: {e}"))?;
    #[cfg(target_os = "windows")]
    register_windows_host("Mozilla", &mozilla_file)?;
    Ok(())
}

pub fn register_native_messaging_manifests(executable_path: &Path) -> Result<(), String> {
    register_mozilla_manifest(executable_path)?;
    let id = unpacked_chrome_id()?;
    write_chrome_manifest(executable_path, &id)
}

pub fn unregister_native_messaging_manifests(browser: super::browser::BrowserKind) -> Result<(), String> {
    match browser {
        super::browser::BrowserKind::Chrome => {
            if let Some(chrome_dir) = get_chrome_manifest_dir() {
                let chrome_file = chrome_dir.join(format!("{HOST_NAME}.json"));
                if chrome_file.exists() {
                    std::fs::remove_file(&chrome_file)
                        .map_err(|e| format!("Failed to remove Chrome native manifest: {e}"))?;
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = std::process::Command::new("reg")
                        .args([
                            "delete",
                            &format!(r"HKCU\Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}"),
                            "/f",
                        ])
                        .output();
                }
            }
        }
        super::browser::BrowserKind::Firefox | super::browser::BrowserKind::Zen => {
            let other = if browser == super::browser::BrowserKind::Firefox {
                super::browser::BrowserKind::Zen
            } else {
                super::browser::BrowserKind::Firefox
            };
            if !super::enterprise_policy::is_policy_installed(other) {
                if let Some(mozilla_dir) = get_mozilla_manifest_dir() {
                    let mozilla_file = mozilla_dir.join(format!("{HOST_NAME}.json"));
                    if mozilla_file.exists() {
                        std::fs::remove_file(&mozilla_file)
                            .map_err(|e| format!("Failed to remove Mozilla native manifest: {e}"))?;
                    }
                    #[cfg(target_os = "windows")]
                    {
                        let _ = std::process::Command::new("reg")
                            .args([
                                "delete",
                                &format!(r"HKCU\Software\Mozilla\NativeMessagingHosts\{HOST_NAME}"),
                                "/f",
                            ])
                            .output();
                    }
                }
            }
        }
        super::browser::BrowserKind::Safari => {}
    }

    Ok(())
}

const APPEARANCE_FILE: &str = "focus_browser_appearance.json";
const APPEARANCE_KEYS: &[&str] = &[
    "--color-background", "--color-background-light", "--color-background-lightest",
    "--color-foreground", "--color-foreground-darker", "--color-foreground-darkest",
    "--color-accent", "--color-focus-round", "--color-short-round", "--color-long-round",
    "--color-hover", "--color-selected", "--color-border", "--color-separator",
    "--color-button", "--color-button-text", "--color-status-error", "--color-status-success",
    "--color-status-warning",
];

fn valid_color(key: &str, value: &str) -> bool {
    APPEARANCE_KEYS.contains(&key)
        && matches!(value.len(), 4 | 7)
        && value.starts_with('#')
        && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

#[derive(Serialize, Deserialize)]
struct AppearanceSnapshot {
    colors: HashMap<String, String>,
    animations_enabled: bool,
}

pub fn publish_appearance(dir: &Path, colors: HashMap<String, String>, animations_enabled: bool) -> Result<(), String> {
    if !colors.iter().all(|(key, value)| valid_color(key, value)) {
        return Err("Invalid appearance color".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let temp = dir.join(format!(".appearance-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let data = serde_json::to_vec(&AppearanceSnapshot { colors, animations_enabled }).map_err(|e| e.to_string())?;
        std::fs::write(&temp, data).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, dir.join(APPEARANCE_FILE)).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temp); }
    result
}

fn handle_native_message(inbound: NativeInboundMessage, config_path: &Path) -> Result<NativeOutboundMessage, String> {
    match inbound {
        NativeInboundMessage::AppearanceGet => {
            let snapshot = config_path.with_file_name(APPEARANCE_FILE);
            let snapshot = std::fs::read(snapshot).ok()
                .and_then(|data| serde_json::from_slice::<AppearanceSnapshot>(&data).ok());
            let (colors, animations_enabled) = snapshot.map(|snapshot| {
                (snapshot.colors.into_iter().filter(|(key, value)| valid_color(key, value)).collect(), snapshot.animations_enabled)
            }).unwrap_or_default();
            Ok(NativeOutboundMessage::Appearance { version: 1, colors, animations_enabled })
        }
        NativeInboundMessage::Connect => {
            eprintln!("[pomotroid-native-host] connect_received");
            let content = std::fs::read_to_string(config_path).map_err(|e| e.to_string())?;
            eprintln!("[pomotroid-native-host] config_read");
            let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
            let token = config["token"].as_str().ok_or("Missing token in config")?.to_string();
            let port = config["port"].as_u64().unwrap_or(1421) as u16;
            eprintln!("[pomotroid-native-host] config_validated port={port} token_present={}", !token.is_empty());
            Ok(NativeOutboundMessage::Config { token, port, protocol_version: 3 })
        }
    }
}

pub fn run_native_host_stdio() -> Result<(), Box<dyn std::error::Error>> {
    eprintln!("[pomotroid-native-host] started");
    let mut stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let config_path = get_config_path().ok_or("Cannot locate Pomotroid config path")?;
    while let Ok(inbound) = read_native_message::<NativeInboundMessage>(&mut stdin) {
        let outbound = handle_native_message(inbound, &config_path)?;
        let is_config = matches!(outbound, NativeOutboundMessage::Config { .. });
        write_native_message(&mut stdout, &outbound)?;
        if is_config { eprintln!("[pomotroid-native-host] config_sent"); }
    }
    Ok(())
}

#[cfg(any(target_os = "linux", test))]
fn linux_config_path(xdg_data_home: Option<std::ffi::OsString>, home: Option<std::ffi::OsString>) -> Option<PathBuf> {
    xdg_data_home.map(PathBuf::from).filter(|path| path.is_absolute())
        .or_else(|| home.map(|path| PathBuf::from(path).join(".local/share")))
        .map(|dir| dir.join("com.splode.pomotroid/focus_browser_config.json"))
}

fn get_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/com.splode.pomotroid/focus_browser_config.json"))
    }
    #[cfg(target_os = "linux")]
    {
        linux_config_path(std::env::var_os("XDG_DATA_HOME"), std::env::var_os("HOME"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|h| PathBuf::from(h).join("com.splode.pomotroid/focus_browser_config.json"))
    }
}

#[cfg(test)]
mod appearance_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn release_identity_requires_matching_key_and_valid_id() {
        let manifest: serde_json::Value = serde_json::from_str(include_str!("../../../extensions/chrome/manifest.json")).unwrap();
        let key = manifest["key"].as_str().unwrap();
        let valid = serde_json::json!({"extension_id": DEFAULT_CHROME_EXT_ID, "public_key": key});
        assert_eq!(chrome_id_from_key(key).unwrap(), DEFAULT_CHROME_EXT_ID);
        assert!(parse_release_chrome_id(&valid.to_string()).is_err());
        use base64::Engine;
        let mut release_bytes = base64::engine::general_purpose::STANDARD.decode(key).unwrap();
        release_bytes[40] ^= 1;
        let release_key = base64::engine::general_purpose::STANDARD.encode(release_bytes);
        let release_id = chrome_id_from_key(&release_key).unwrap();
        let release = serde_json::json!({"extension_id": release_id, "public_key": release_key});
        assert_eq!(parse_release_chrome_id(&release.to_string()).unwrap(), release_id);
        for invalid in [
            serde_json::json!({"extension_id": null, "public_key": null}),
            serde_json::json!({"extension_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "public_key": key}),
            serde_json::json!({"extension_id": DEFAULT_CHROME_EXT_ID, "public_key": "not base64"}),
            serde_json::json!({"extension_id": "INVALID", "public_key": key}),
        ] {
            assert!(parse_release_chrome_id(&invalid.to_string()).is_err());
        }
    }

    #[test]
    fn release_identity_rejects_development_key() {
        let manifest: serde_json::Value = serde_json::from_str(include_str!("../../../extensions/chrome/manifest.json")).unwrap();
        let config = serde_json::json!({"extension_id": DEFAULT_CHROME_EXT_ID, "public_key": manifest["key"]});
        assert!(parse_release_chrome_id(&config.to_string()).is_err());
    }

    #[test]
    fn unpacked_identity_must_match_registered_origin() {
        let dir = std::env::temp_dir().join(format!("grace-identity-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("manifest.json"), include_str!("../../../extensions/chrome/manifest.json")).unwrap();
        assert!(validate_unpacked_chrome_identity(&dir, DEFAULT_CHROME_EXT_ID).is_ok());
        assert!(validate_unpacked_chrome_identity(&dir, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").is_err());
        std::fs::write(dir.join("manifest.json"), "{}").unwrap();
        assert!(validate_unpacked_chrome_identity(&dir, DEFAULT_CHROME_EXT_ID).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn linux_config_path_uses_absolute_xdg_data_home_or_home_fallback() {
        use std::ffi::OsString;
        let home = Some(OsString::from("/home/test"));
        assert_eq!(linux_config_path(Some(OsString::from("/custom/data")), home.clone()), Some(PathBuf::from("/custom/data/com.splode.pomotroid/focus_browser_config.json")));
        assert_eq!(linux_config_path(Some(OsString::from("relative")), home.clone()), Some(PathBuf::from("/home/test/.local/share/com.splode.pomotroid/focus_browser_config.json")));
        assert_eq!(linux_config_path(None, home), Some(PathBuf::from("/home/test/.local/share/com.splode.pomotroid/focus_browser_config.json")));
        assert_eq!(linux_config_path(None, None), None);
    }

    #[test]
    fn connect_response_serializes_protocol_version_three() {
        let dir = std::env::temp_dir().join(format!("grace-connect-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("focus_browser_config.json");
        std::fs::write(&path, r#"{"token":"test-token","port":1421}"#).unwrap();
        let response = handle_native_message(NativeInboundMessage::Connect, &path).unwrap();
        let serialized = serde_json::to_value(response).unwrap();
        assert_eq!(serialized["protocol_version"], 3);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn appearance_request_works_without_credentials() {
        let dir = std::env::temp_dir().join(format!("appearance-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let colors = HashMap::from([("--color-background".to_string(), "#112233".to_string())]);
        publish_appearance(&dir, colors.clone(), false).unwrap();
        let result = handle_native_message(NativeInboundMessage::AppearanceGet, &dir.join("focus_browser_config.json")).unwrap();
        assert_eq!(result, NativeOutboundMessage::Appearance { version: 1, colors, animations_enabled: false });
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn malformed_snapshot_returns_safe_empty_appearance() {
        let dir = std::env::temp_dir().join(format!("appearance-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("focus_browser_appearance.json"), "not json").unwrap();
        let result = handle_native_message(NativeInboundMessage::AppearanceGet, &dir.join("focus_browser_config.json")).unwrap();
        assert_eq!(result, NativeOutboundMessage::Appearance { version: 1, colors: HashMap::new(), animations_enabled: false });
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn snapshot_lookup_filters_unapproved_keys_and_values() {
        let dir = std::env::temp_dir().join(format!("appearance-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(APPEARANCE_FILE), r##"{"colors":{"token":"#123456","--color-accent":"url(evil)","--color-background":"#123456"},"animations_enabled":true}"##).unwrap();
        let result = handle_native_message(NativeInboundMessage::AppearanceGet, &dir.join("focus_browser_config.json")).unwrap();
        assert_eq!(result, NativeOutboundMessage::Appearance { version: 1, colors: HashMap::from([("--color-background".into(), "#123456".into())]), animations_enabled: true });
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn publication_rejects_unapproved_keys_and_invalid_values() {
        let dir = std::env::temp_dir();
        assert!(publish_appearance(&dir, HashMap::from([("token".into(), "#112233".into())]), true).is_err());
        assert!(publish_appearance(&dir, HashMap::from([("--color-background".into(), "url(evil)".into())]), true).is_err());
        assert!(publish_appearance(&dir, HashMap::from([("--color-background".into(), "#11223344".into())]), true).is_err());
    }
}
