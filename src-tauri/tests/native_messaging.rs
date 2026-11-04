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
    };
    write_native_message(&mut buffer, &msg).unwrap();

    // Verify 4-byte length prefix matches payload length
    assert!(buffer.len() > 4);
    let len = u32::from_ne_bytes(buffer[0..4].try_into().unwrap()) as usize;
    assert_eq!(len, buffer.len() - 4);

    // Read it back
    let mut cursor = Cursor::new(buffer);
    let decoded = read_native_message::<NativeOutboundMessage>(&mut cursor).unwrap();
    match decoded {
        NativeOutboundMessage::Config { token, port } => {
            assert_eq!(token, "test-token-xyz");
            assert_eq!(port, 1421);
        }
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
    assert_eq!(id.len(), 32);
    assert!(id.bytes().all(|b| (b'a'..=b'p').contains(&b)));
    let manifest = generate_chrome_manifest(Path::new("/tmp/pomotroid-native-host"), &[id]);
    assert_eq!(manifest["allowed_origins"][0], format!("chrome-extension://{id}/"));
    assert_eq!(id, pomotroid_lib::focus::enterprise_policy::CHROME_EXTENSION_ID);
}
