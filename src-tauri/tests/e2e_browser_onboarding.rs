use std::sync::Arc;
use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use pomotroid_lib::focus::browser::{BrowserBridge, BrowserKind, ClientMessage, ServerMessage};
use pomotroid_lib::focus::browser_detector::detect_installed_browsers;
use pomotroid_lib::focus::enforcer::NativeEnforcer;
use pomotroid_lib::focus::enterprise_policy::merge_firefox_policies;
use pomotroid_lib::focus::native_messaging::{
    read_native_message, write_native_message, NativeInboundMessage, NativeOutboundMessage,
};

#[tokio::test]
async fn test_e2e_browser_onboarding_lifecycle() {
    // 1. Browser Detection
    let browsers = detect_installed_browsers();
    // Verify detected browsers have valid paths
    for b in &browsers {
        assert!(b.executable_path.exists());
    }

    // 2. Enterprise Policy Generation
    let dummy_xpi = std::path::Path::new("/tmp/test_focus.xpi");
    let base_policy = json!({ "policies": {} });
    let merged = merge_firefox_policies(&base_policy, dummy_xpi);
    assert_eq!(
        merged["policies"]["ExtensionSettings"]["focus@pomotroid.local"]["installation_mode"],
        "force_installed"
    );

    // 3. Native Messaging Handshake Simulation
    let mut pipe_in = Vec::new();
    let mut pipe_out = Vec::new();
    write_native_message(&mut pipe_in, &NativeInboundMessage::Connect).unwrap();

    let mut read_cursor = std::io::Cursor::new(pipe_in);
    let inbound = read_native_message::<NativeInboundMessage>(&mut read_cursor).unwrap();
    assert_eq!(inbound, NativeInboundMessage::Connect);

    let test_token = "e2e-auto-paired-token-999";
    let test_port = 14228;
    write_native_message(
        &mut pipe_out,
        &NativeOutboundMessage::Config {
            token: test_token.into(),
            port: test_port,
        },
    ).unwrap();

    let mut resp_cursor = std::io::Cursor::new(pipe_out);
    let outbound = read_native_message::<NativeOutboundMessage>(&mut resp_cursor).unwrap();
    let (received_token, received_port) = match outbound {
        NativeOutboundMessage::Config { token, port } => (token, port),
    };
    assert_eq!(received_token, test_token);
    assert_eq!(received_port, test_port);

    // 4. Connect Extension Client to BrowserBridge using credentials received via Native Messaging
    let bridge = Arc::new(BrowserBridge::new_in_memory(test_token.into(), test_port).await.unwrap());
    bridge.set_required_profile("zen-profile-e2e", BrowserKind::Zen, true);

    let ws_url = format!("ws://127.0.0.1:{test_port}/focus-browser");
    let (mut ws, _) = connect_async(&ws_url).await.expect("Failed to connect websocket");

    // Send Hello handshake with received credentials
    let hello = ClientMessage::Hello {
        version: 1,
        token: received_token,
        profile_id: "zen-profile-e2e".into(),
        browser: BrowserKind::Zen,
        install_type: "admin".into(),
        may_disable: false,
    };
    let hello_text = serde_json::to_string(&hello).unwrap();
    ws.send(Message::Text(hello_text.into())).await.unwrap();

    // Verify ServerMessage::Policy arrives
    let policy_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .expect("Timeout waiting for policy")
        .expect("Stream ended")
        .expect("WS error");

    if let Message::Text(text) = policy_msg {
        let parsed: ServerMessage = serde_json::from_str(&text).unwrap();
        match parsed {
            ServerMessage::Policy { active, .. } => {
                assert!(!active);
            }
            _ => panic!("Expected policy message"),
        }
    } else {
        panic!("Expected text message");
    }

    // Send Ack
    let ack = ClientMessage::Ack {
        revision: 0,
        profile_id: "zen-profile-e2e".into(),
    };
    ws.send(Message::Text(serde_json::to_string(&ack).unwrap().into())).await.unwrap();

    // Verify bridge setup info reflects active online profile
    tokio::time::sleep(Duration::from_millis(50)).await;
    let setup = bridge.get_setup_info();
    let prof = setup.profiles.iter().find(|p| p.profile_id == "zen-profile-e2e").unwrap();
    assert_eq!(prof.browser, BrowserKind::Zen);
    assert_eq!(prof.install_type, "admin");
    assert!(!prof.may_disable);
    assert!(prof.is_required);
    assert!(prof.is_connected);

    // 5. Test blocking policy application and ACK for Zen
    let (mut ws_tx, mut ws_rx) = ws.split();
    let ack_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = ws_rx.next().await {
            let parsed: Result<ServerMessage, _> = serde_json::from_str(&text);
            if let Ok(ServerMessage::Policy { revision, active, domains, .. }) = parsed {
                if active && domains.contains(&"zen-distraction.com".to_string()) {
                    let ack = ClientMessage::Ack {
                        revision,
                        profile_id: "zen-profile-e2e".into(),
                    };
                    ws_tx.send(Message::Text(serde_json::to_string(&ack).unwrap().into())).await.unwrap();
                } else if active && domains.contains(&"error-trigger.com".to_string()) {
                    let err = ClientMessage::Error {
                        revision,
                        profile_id: "zen-profile-e2e".into(),
                        code: "dnr_syntax_error".into(),
                    };
                    ws_tx.send(Message::Text(serde_json::to_string(&err).unwrap().into())).await.unwrap();
                } else if !active {
                    let ack = ClientMessage::Ack {
                        revision,
                        profile_id: "zen-profile-e2e".into(),
                    };
                    ws_tx.send(Message::Text(serde_json::to_string(&ack).unwrap().into())).await.unwrap();
                }
            }
        }
    });

    let b = bridge.clone();
    tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["zen-distraction.com".into()]).expect("apply_blocking should succeed with ACK");
    }).await.unwrap();
    assert!(bridge.health().is_ok());

    // 6. Test that Zen reporting DNR error fails apply_blocking fast
    let b = bridge.clone();
    let start = std::time::Instant::now();
    let err_res = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["error-trigger.com".into()])
    }).await.unwrap();
    assert!(err_res.is_err(), "Expected error when client reports DNR failure");
    assert!(start.elapsed() < Duration::from_secs(2), "Expected immediate error, took {:?}", start.elapsed());
    let err_text = err_res.unwrap_err().to_string();
    assert!(err_text.contains("dnr_syntax_error"), "Error text should contain client code, got: {}", err_text);

    // 7. Test policy release
    let b = bridge.clone();
    tokio::task::spawn_blocking(move || {
        b.release_blocking().expect("release_blocking should succeed");
    }).await.unwrap();

    ack_task.abort();
    bridge.shutdown().await;
}
