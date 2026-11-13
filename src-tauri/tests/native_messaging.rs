use std::io::Cursor;
use pomotroid_lib::focus::native_messaging::{
    read_native_message, write_native_message, generate_chrome_manifest, generate_mozilla_manifest,
    NativeInboundMessage, NativeOutboundMessage, MAX_MESSAGE_BYTES,
};
use std::path::Path;

#[test]
fn test_native_message_read_write_framing() {
    let mut buffer = Vec::new();
    let msg = NativeOutboundMessage::Config {
        token: "test-token-xyz".into(),
        port: 1421,
        protocol_version: 3,
    };
    write_native_message(&mut buffer, &msg).unwrap();

    let payload: serde_json::Value = serde_json::from_slice(&buffer[4..]).unwrap();
    assert_eq!(payload["protocol_version"], 3);

    // Verify 4-byte length prefix matches payload length
    assert!(buffer.len() > 4);
    let len = u32::from_ne_bytes(buffer[0..4].try_into().unwrap()) as usize;
    assert_eq!(len, buffer.len() - 4);

    // Read it back
    let mut cursor = Cursor::new(buffer);
    let decoded = read_native_message::<NativeOutboundMessage>(&mut cursor).unwrap();
    match decoded {
        NativeOutboundMessage::Config { token, port, protocol_version } => {
            assert_eq!(token, "test-token-xyz");
            assert_eq!(port, 1421);
            assert_eq!(protocol_version, 3);
        }
        other => panic!("Unexpected message: {other:?}"),
    }
}

#[test]
fn test_chrome_native_manifest_format() {
    let exec = Path::new("/usr/local/bin/pomotroid-native-host");
    let ext_id = "test_chrome_ext_id";
    let manifest = generate_chrome_manifest(exec, &[ext_id]);

    assert_eq!(manifest["name"], "com.splode.pomotroid");
    assert_eq!(manifest["type"], "stdio");
    assert_eq!(manifest["path"], "/usr/local/bin/pomotroid-native-host");
    let origins = manifest["allowed_origins"].as_array().unwrap();
    assert_eq!(origins.len(), 1);
    assert_eq!(origins[0], "chrome-extension://test_chrome_ext_id/");
}

#[test]
fn test_firefox_zen_native_manifest_format() {
    let exec = Path::new("/usr/local/bin/pomotroid-native-host");
    let ext_id = "focus@pomotroid.local";
    let manifest = generate_mozilla_manifest(exec, &[ext_id]);

    assert_eq!(manifest["name"], "com.splode.pomotroid");
    assert_eq!(manifest["type"], "stdio");
    assert_eq!(manifest["path"], "/usr/local/bin/pomotroid-native-host");
    let extensions = manifest["allowed_extensions"].as_array().unwrap();
    assert_eq!(extensions.len(), 1);
    assert_eq!(extensions[0], "focus@pomotroid.local");
}

#[test]
fn test_message_size_limit_rejection() {
    let mut buffer = Vec::new();
    let huge_len = (MAX_MESSAGE_BYTES + 10) as u32;
    buffer.extend_from_slice(&huge_len.to_ne_bytes());
    buffer.extend(vec![b'a'; 100]); // truncated payload with oversized header

    let mut cursor = Cursor::new(buffer);
    let res = read_native_message::<NativeInboundMessage>(&mut cursor);
    assert!(res.is_err());
    assert!(res.unwrap_err().to_string().contains("exceeds maximum allowed size"));
}

#[test]
fn chrome_native_host_authorizes_valid_extension_identity() {
    let id = pomotroid_lib::focus::native_messaging::DEFAULT_CHROME_EXT_ID;
    assert_eq!(id, "cgibenlmgmblmalggjalnoaikjkdnoid");
    assert_eq!(id.len(), 32);
    assert!(id.bytes().all(|b| (b'a'..=b'p').contains(&b)));
    let manifest = generate_chrome_manifest(Path::new("/tmp/pomotroid-native-host"), &[id]);
    assert_eq!(manifest["allowed_origins"], serde_json::json!(["chrome-extension://cgibenlmgmblmalggjalnoaikjkdnoid/"]));
    assert_eq!(id, pomotroid_lib::focus::enterprise_policy::CHROME_EXTENSION_ID);
}

#[cfg(target_os = "macos")]
#[test]
fn native_host_diagnostics_preserve_framing_and_secrets() {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let home = std::env::temp_dir().join(format!("pomotroid-host-{}", uuid::Uuid::new_v4()));
    let config_dir = home.join("Library/Application Support/com.splode.pomotroid");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::fs::write(config_dir.join("focus_browser_config.json"),
        r#"{"token":"DO_NOT_LOG_TOKEN","port":1421,"profiles":[]}"#).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_pomotroid-native-host"))
        .env("HOME", &home)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().unwrap();
    let mut frame = Vec::new();
    write_native_message(&mut frame, &NativeInboundMessage::Connect).unwrap();
    child.stdin.take().unwrap().write_all(&frame).unwrap();
    let output = child.wait_with_output().unwrap();
    std::fs::remove_dir_all(home).unwrap();
    assert!(output.status.success());
    let mut cursor = Cursor::new(&output.stdout);
    assert_eq!(read_native_message::<NativeOutboundMessage>(&mut cursor).unwrap(),
        NativeOutboundMessage::Config { token: "DO_NOT_LOG_TOKEN".into(), port: 1421, protocol_version: 3 });
    assert_eq!(cursor.position() as usize, output.stdout.len());
    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("config_sent"));
    assert!(!stderr.contains("DO_NOT_LOG_TOKEN"));
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn chrome_native_registration_replaces_old_origin() {
    use pomotroid_lib::focus::native_messaging::{
        get_chrome_manifest_dir, register_native_messaging_manifests, HOST_NAME,
    };

    // A subprocess isolates HOME from concurrently running tests and personal browser manifests.
    if let Some(root) = std::env::var_os("GRACE_TEST_NATIVE_HOST_DIR") {
        let root = std::path::PathBuf::from(root);
        assert_eq!(std::env::var_os("HOME").unwrap(), root.as_os_str());
        let executable = root.join("pomotroid-native-host");
        std::fs::write(&executable, "fixture").unwrap();
        let directory = get_chrome_manifest_dir().unwrap();
        assert!(directory.starts_with(&root));
        std::fs::create_dir_all(&directory).unwrap();
        let manifest_path = directory.join(format!("{HOST_NAME}.json"));
        let old_manifest = generate_chrome_manifest(&executable, &["ddiojihepmbimcfoefnebpolgaljlcfn"]);
        std::fs::write(&manifest_path, serde_json::to_vec(&old_manifest).unwrap()).unwrap();
        register_native_messaging_manifests(&executable).unwrap();
        let updated: serde_json::Value = serde_json::from_slice(&std::fs::read(manifest_path).unwrap()).unwrap();
        assert_eq!(updated["allowed_origins"], serde_json::json!(["chrome-extension://cgibenlmgmblmalggjalnoaikjkdnoid/"]));
        assert_eq!(updated["path"], executable.to_string_lossy().as_ref());
        return;
    }

    let root = std::env::temp_dir().join(format!("grace-chrome-registration-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "chrome_native_registration_replaces_old_origin", "--test-threads=1"])
        .env("HOME", &root)
        .env("GRACE_TEST_NATIVE_HOST_DIR", &root)
        .output().unwrap();
    std::fs::remove_dir_all(root).unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stdout));
}
