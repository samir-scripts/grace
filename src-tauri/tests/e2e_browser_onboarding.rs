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
#[ignore = "native browser enforcement requires a disposable guest"]
async fn test_e2e_browser_onboarding_lifecycle() {
    assert_eq!(std::env::var("POMOTROID_DISPOSABLE_GUEST").as_deref(), Ok("1"), "run only in a disposable guest");
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
        other => panic!("Unexpected message: {other:?}"),
    };
    assert_eq!(received_token, test_token);
    assert_eq!(received_port, test_port);

    // 4. Connect Extension Client to BrowserBridge using credentials received via Native Messaging
    let bridge = Arc::new(BrowserBridge::new_in_memory(test_token.into(), test_port).await.unwrap());
    bridge.set_required_profile("zen-profile-e2e", BrowserKind::Zen, true).unwrap();

    let ws_url = format!("ws://127.0.0.1:{test_port}/focus-browser");
    let (ws, _) = connect_async(&ws_url).await.expect("Failed to connect websocket");

    let mut ws = authenticate(ws, &received_token, "zen-profile-e2e", "zen").await;

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
    assert_eq!(prof.browser, Some(BrowserKind::Zen));
    assert!(prof.is_required);
    assert!(prof.is_connected);

    // 5. Test blocking policy application and ACK for Zen
    let mut peer = ws;
    let ack_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = peer.next().await {
            let parsed: Result<ServerMessage, _> = serde_json::from_str(&text);
            if let Ok(ServerMessage::Policy { revision, active, domains, .. }) = parsed {
                if active && domains.contains(&"zen-distraction.com".to_string()) {
                    let ack = ClientMessage::Ack {
                        revision,
                        profile_id: "zen-profile-e2e".into(),
                    };
                    peer.send(Message::Text(serde_json::to_string(&ack).unwrap().into())).await.unwrap();
                } else if active && domains.contains(&"error-trigger.com".to_string()) {
                    peer.socket.close(None).await.unwrap();
                    break;
                } else if !active {
                    let ack = ClientMessage::Ack {
                        revision,
                        profile_id: "zen-profile-e2e".into(),
                    };
                    peer.send(Message::Text(serde_json::to_string(&ack).unwrap().into())).await.unwrap();
                }
            }
        }
    });

    let b = bridge.clone();
    tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["zen-distraction.com".into()]).expect("apply_blocking should succeed with ACK");
    }).await.unwrap();
    assert!(bridge.health().is_ok());

    // 6. Test that a disconnected companion fails apply_blocking fast
    let b = bridge.clone();
    let start = std::time::Instant::now();
    let err_res = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["error-trigger.com".into()])
    }).await.unwrap();
    assert!(err_res.is_err(), "Expected error when client disconnects");
    assert!(start.elapsed() < Duration::from_secs(2), "Expected immediate error, took {:?}", start.elapsed());

    // 7. Test policy release
    let b = bridge.clone();
    tokio::task::spawn_blocking(move || {
        b.release_blocking().expect("release_blocking should succeed");
    }).await.unwrap();

    ack_task.abort();
    bridge.shutdown().await;
}
type Socket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
struct Peer { socket: Socket, client_key: Vec<u8>, server_key: Vec<u8>, sent: u64, received: u64 }
fn mac(key: &[u8], input: &str) -> String {
    use hmac::{Hmac, Mac};
    let mut h = Hmac::<sha2::Sha256>::new_from_slice(key).unwrap();
    h.update(input.as_bytes());
    h.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(s: &str) -> Vec<u8> {
    assert_eq!(s.len(), 64);
    assert!(s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    (0..64).step_by(2).map(|i| u8::from_str_radix(&s[i..i+2], 16).unwrap()).collect()
}
async fn challenge(socket: &mut Socket, c: &str, token: &str) -> serde_json::Value {
    socket.send(Message::Text(json!({"type":"auth_init","version":3,"client_nonce":c}).to_string().into())).await.unwrap();
    let Message::Text(wire) = tokio::time::timeout(Duration::from_secs(2), socket.next()).await.unwrap().unwrap().unwrap() else { panic!("expected challenge") };
    let value: serde_json::Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(value["type"], "auth_challenge");
    assert_eq!(value["version"], 3);
    let s = value["server_nonce"].as_str().unwrap();
    unhex(s);
    use hmac::{Hmac, Mac};
    let mut h = Hmac::<sha2::Sha256>::new_from_slice(token.as_bytes()).unwrap();
    h.update(format!("pomotroid-focus-v3\nserver\n{c}\n{s}").as_bytes());
    h.verify_slice(&unhex(value["proof"].as_str().unwrap())).unwrap();
    value
}
async fn authenticate(mut socket: Socket, token: &str, profile: &str, _browser: &str) -> Peer {
    let c = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let ch = challenge(&mut socket, &c, token).await;
    let s = ch["server_nonce"].as_str().unwrap();
    let m = json!([profile]).to_string();
    let proof = mac(token.as_bytes(), &format!("pomotroid-focus-v3\nclient\n{c}\n{s}\n{m}"));
    socket.send(Message::Text(json!({"type":"auth_response","version":3,"metadata":m,"proof":proof}).to_string().into())).await.unwrap();
    let client_key = unhex(&mac(token.as_bytes(), &format!("pomotroid-focus-v3\nkey-client\n{c}\n{s}\n{m}")));
    let server_key = unhex(&mac(token.as_bytes(), &format!("pomotroid-focus-v3\nkey-server\n{c}\n{s}\n{m}")));
    Peer { socket, client_key, server_key, sent: 0, received: 0 }
}
impl Peer {
    async fn next(&mut self) -> Option<Result<Message, tokio_tungstenite::tungstenite::Error>> {
        let message = self.socket.next().await?;
        Some(message.map(|message| {
            if let Message::Text(wire) = message {
                let f: serde_json::Value = serde_json::from_str(&wire).unwrap();
                assert_eq!(f["type"], "authenticated");
                self.received += 1;
                assert_eq!(f["sequence"].as_u64(), Some(self.received));
                let p = f["payload"].as_str().unwrap();
                use hmac::{Hmac, Mac};
                let mut h = Hmac::<sha2::Sha256>::new_from_slice(&self.server_key).unwrap();
                h.update(format!("pomotroid-focus-v3\nframe\n{}\n{p}", self.received).as_bytes());
                h.verify_slice(&unhex(f["mac"].as_str().unwrap())).unwrap();
                Message::Text(p.to_string().into())
            } else { message }
        }))
    }
    async fn send(&mut self, message: Message) -> Result<(), tokio_tungstenite::tungstenite::Error> {
        if let Message::Text(p) = message {
            self.sent += 1;
            let tag = mac(&self.client_key, &format!("pomotroid-focus-v3\nframe\n{}\n{p}", self.sent));
            self.socket.send(Message::Text(json!({"type":"authenticated","sequence":self.sent,"payload":p.as_str(),"mac":tag}).to_string().into())).await
        } else { self.socket.send(message).await }
    }
}
