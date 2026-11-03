use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024; // 1 MB
pub const HOST_NAME: &str = "com.splode.pomotroid";
pub const DEFAULT_FIREFOX_EXT_ID: &str = "focus@pomotroid.local";
pub const DEFAULT_CHROME_EXT_ID: &str = "pomotroid-focus-companion";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NativeInboundMessage {
    Connect,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NativeOutboundMessage {
    Config {
        token: String,
        port: u16,
    },
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

pub fn register_native_messaging_manifests(executable_path: &Path) -> Result<(), String> {
    if !executable_path.exists() {
        return Err(format!("Native host executable does not exist at {}", executable_path.display()));
    }

    let chrome_manifest = generate_chrome_manifest(executable_path, &[DEFAULT_CHROME_EXT_ID, "*"]);
    let mozilla_manifest = generate_mozilla_manifest(executable_path, &[DEFAULT_FIREFOX_EXT_ID]);

    if let Some(chrome_dir) = get_chrome_manifest_dir() {
        std::fs::create_dir_all(&chrome_dir).map_err(|e| format!("Failed to create Chrome manifest dir: {e}"))?;
        let chrome_file = chrome_dir.join(format!("{HOST_NAME}.json"));
        let content = serde_json::to_string_pretty(&chrome_manifest).map_err(|e| e.to_string())?;
        std::fs::write(&chrome_file, content).map_err(|e| format!("Failed to write Chrome manifest: {e}"))?;
    }

    if let Some(mozilla_dir) = get_mozilla_manifest_dir() {
        std::fs::create_dir_all(&mozilla_dir).map_err(|e| format!("Failed to create Mozilla manifest dir: {e}"))?;
        let mozilla_file = mozilla_dir.join(format!("{HOST_NAME}.json"));
        let content = serde_json::to_string_pretty(&mozilla_manifest).map_err(|e| e.to_string())?;
        std::fs::write(&mozilla_file, content).map_err(|e| format!("Failed to write Mozilla manifest: {e}"))?;
    }

    Ok(())
}

pub fn run_native_host_stdio() -> Result<(), Box<dyn std::error::Error>> {
    let mut stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    // Read config from Pomotroid app data directory
    let config_path = get_config_path().ok_or("Cannot locate Pomotroid config path")?;
    let config_content = std::fs::read_to_string(&config_path)?;
    let config_json: serde_json::Value = serde_json::from_str(&config_content)?;

    let token = config_json["token"].as_str().ok_or("Missing token in config")?.to_string();
    let port = config_json["port"].as_u64().unwrap_or(1421) as u16;

    while let Ok(inbound) = read_native_message::<NativeInboundMessage>(&mut stdin) {
        match inbound {
            NativeInboundMessage::Connect => {
                let outbound = NativeOutboundMessage::Config {
                    token: token.clone(),
                    port,
                };
                write_native_message(&mut stdout, &outbound)?;
            }
        }
    }

    Ok(())
}

fn get_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/com.splode.pomotroid/focus_browser_config.json"))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share/com.splode.pomotroid/focus_browser_config.json"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|h| PathBuf::from(h).join("com.splode.pomotroid/focus_browser_config.json"))
    }
}
