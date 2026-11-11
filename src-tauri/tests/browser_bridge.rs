use std::sync::Arc;
use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use pomotroid_lib::focus::browser::{BrowserBridge, BrowserKind};
use pomotroid_lib::focus::enforcer::NativeEnforcer;

fn require_disposable_guest() {
    assert_eq!(std::env::var("POMOTROID_DISPOSABLE_GUEST").as_deref(), Ok("1"), "native browser enforcement tests require a disposable guest");
}

#[tokio::test]
async fn test_browser_bridge_rejects_unauthorized_hello() {
    let bridge = Arc::new(BrowserBridge::new_in_memory("secret-token-123".into(), 14215).await.unwrap());
    let url = "ws://127.0.0.1:14215/focus-browser";

    let (mut ws, _) = connect_async(url).await.unwrap();
    // Send bad token
    let hello = json!({
        "type": "hello",
        "version": 1,
        "token": "wrong-token",
        "profile_id": "prof-1",
        "browser": "chrome",
        "install_type": "admin",
        "may_disable": false
    });
    ws.send(Message::Text(hello.to_string().into())).await.unwrap();

    // Must be disconnected / closed
    let msg = ws.next().await;
    assert!(matches!(msg, None | Some(Err(_)) | Some(Ok(Message::Close(_)))));
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn test_browser_bridge_applies_and_releases_with_ack() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("secret-token-123".into(), 14216).await.unwrap());
    bridge.set_required_profile("prof-chrome-1", BrowserKind::Chrome, true).unwrap();

    let url = "ws://127.0.0.1:14216/focus-browser";
    let (ws, _) = connect_async(url).await.unwrap();

    let mut ws = authenticate(ws, "secret-token-123", "prof-chrome-1", "chrome").await;

    // Spawn client task to acknowledge policies
    let client_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = ws.next().await {
            let data: serde_json::Value = serde_json::from_str(&text).unwrap();
            if data["type"] == "policy" {
                let rev = data["revision"].as_u64().unwrap();
                let ack = json!({ "type": "ack", "revision": rev, "profile_id": "prof-chrome-1" });
                ws.send(Message::Text(ack.to_string().into())).await.unwrap();
            }
        }
    });

    // Bridge apply should wait for ack and succeed
    tokio::time::sleep(Duration::from_millis(50)).await;
    let b = bridge.clone();
    tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["reddit.com".into()]).unwrap();
    }).await.unwrap();

    assert!(bridge.health().is_ok());

    // Release should wait for ack and succeed
    let b = bridge.clone();
    tokio::task::spawn_blocking(move || {
        b.release_blocking().unwrap();
    }).await.unwrap();

    client_task.abort();
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn test_browser_bridge_detects_disconnect_for_required_profile() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("secret-token-123".into(), 14217).await.unwrap());
    bridge.set_required_profile("prof-req-1", BrowserKind::Chrome, true).unwrap();

    let url = "ws://127.0.0.1:14217/focus-browser";
    let (ws, _) = connect_async(url).await.unwrap();

    let mut ws = authenticate(ws, "secret-token-123", "prof-req-1", "chrome").await;

    let client_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = ws.next().await {
            let data: serde_json::Value = serde_json::from_str(&text).unwrap();
            if data["type"] == "policy" {
                let rev = data["revision"].as_u64().unwrap();
                let ack = json!({ "type": "ack", "revision": rev, "profile_id": "prof-req-1" });
                ws.send(Message::Text(ack.to_string().into())).await.unwrap();
            }
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let b = bridge.clone();
    tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["youtube.com".into()]).unwrap();
    }).await.unwrap();
    assert!(bridge.health().is_ok());

    // Kill client connection
    client_task.abort();
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Health check must now fail because required profile is disconnected
    assert!(bridge.health().is_err());
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn test_browser_bridge_fails_apply_on_client_error() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("token-123".into(), 14221).await.unwrap());
    bridge.set_required_profile("prof-err-1", BrowserKind::Zen, true).unwrap();

    let (ws, _) = connect_async("ws://127.0.0.1:14221/focus-browser").await.unwrap();
    let mut ws = authenticate(ws, "token-123", "prof-err-1", "zen").await;

    // A client that cannot apply its policy disconnects before acknowledgement.
    tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = ws.next().await {
            let data: serde_json::Value = serde_json::from_str(&text).unwrap();
            if data["type"] == "policy" && data["active"] == true {
                ws.socket.close(None).await.unwrap();
                break;
            }
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let b = bridge.clone();
    let start = std::time::Instant::now();
    let res = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["facebook.com".into()])
    }).await.unwrap();

    assert!(res.is_err(), "Expected apply_blocking to fail after disconnect");
    assert!(start.elapsed() < Duration::from_secs(2), "disconnect should wake apply promptly");
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn test_browser_bridge_heartbeat_does_not_forge_ack() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("token-hb-123".into(), 14222).await.unwrap());
    bridge.set_required_profile("prof-hb-1", BrowserKind::Zen, true).unwrap();

    let (ws, _) = connect_async("ws://127.0.0.1:14222/focus-browser").await.unwrap();
    let mut ws = authenticate(ws, "token-hb-123", "prof-hb-1", "zen").await;

    // Client responds ONLY with heartbeat reporting the new revision, never sending Ack
    tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = ws.next().await {
            let data: serde_json::Value = serde_json::from_str(&text).unwrap();
            if data["type"] == "policy" {
                let rev = data["revision"].as_u64().unwrap();
                let hb_msg = json!({
                    "type": "heartbeat",
                    "revision": rev,
                    "profile_id": "prof-hb-1"
                });
                ws.send(Message::Text(hb_msg.to_string().into())).await.unwrap();
            }
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let b = bridge.clone();
    let res = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["facebook.com".into()])
    }).await.unwrap();

    // Because heartbeat should NOT satisfy the ack requirement, it must fail (timeout after 5s)
    assert!(res.is_err(), "Heartbeat must not satisfy acknowledgment requirement");
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn test_browser_bridge_fails_when_domains_non_empty_and_no_clients() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("token-no-client".into(), 14223).await.unwrap());
    let b = bridge.clone();
    let res = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["facebook.com".into()])
    }).await.unwrap();

    assert!(res.is_err(), "Non-empty domains must require at least one connected browser companion");
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn disconnected_nonrequired_companion_causes_lease_loss() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("lease-token".into(), 14239).await.unwrap());
    bridge.set_required_profile("temporary", BrowserKind::Chrome, false).unwrap();
    let (ws, _) = connect_async("ws://127.0.0.1:14239/focus-browser").await.unwrap();
    let mut ws = authenticate(ws, "lease-token", "temporary", "chrome").await;
    let task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = ws.next().await {
            let msg: serde_json::Value = serde_json::from_str(&text).unwrap();
            if msg["type"] == "policy" {
                let ack = json!({"type": "ack", "revision": msg["revision"], "profile_id": "temporary"});
                ws.send(Message::Text(ack.to_string().into())).await.unwrap();
            }
        }
    });
    for _ in 0..100 {
        if bridge.get_setup_info().profiles.iter().any(|p| p.is_connected) { break; }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let b = bridge.clone();
    tokio::task::spawn_blocking(move || b.apply_blocking(&[], &["example.com".into()])).await.unwrap().unwrap();
    task.abort();
    for _ in 0..100 {
        if bridge.get_setup_info().profiles.iter().all(|p| !p.is_connected) { break; }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(bridge.health().is_err(), "disconnected participant must invalidate protection");
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn mixed_rules_require_browser_before_inspecting_applications() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("preflight-token".into(), 14240).await.unwrap());
    let app = pomotroid_lib::focus::model::AppTarget {
        id: "test".into(), name: "Test".into(), identifier: String::new(), platform: "all".into(),
    };
    let b = bridge.clone();
    let result = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[app], &["example.com".into()])
    }).await.unwrap();
    assert!(matches!(result, Err(pomotroid_lib::focus::enforcer::EnforcerError::HostsFileError(_))));
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn test_browser_bridge_requires_all_connected_participants_even_with_required_profile() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("token-dual".into(), 14225).await.unwrap());
    bridge.set_required_profile("prof-req", BrowserKind::Chrome, true).unwrap();
    bridge.set_required_profile("prof-unreq", BrowserKind::Zen, false).unwrap();

    // Connect required client
    let (ws_req, _) = connect_async("ws://127.0.0.1:14225/focus-browser").await.unwrap();
    let mut ws_req = authenticate(ws_req, "token-dual", "prof-req", "chrome").await;

    // Connect unrequired client
    let (ws_unreq, _) = connect_async("ws://127.0.0.1:14225/focus-browser").await.unwrap();
    let _ws_unreq = authenticate(ws_unreq, "token-dual", "prof-unreq", "zen").await;

    // Required client ACKs, but unrequired client never ACKs
    tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = ws_req.next().await {
            let data: serde_json::Value = serde_json::from_str(&text).unwrap();
            if data["type"] == "policy" {
                let rev = data["revision"].as_u64().unwrap();
                let ack = json!({ "type": "ack", "revision": rev, "profile_id": "prof-req" });
                ws_req.send(Message::Text(ack.to_string().into())).await.unwrap();
            }
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let b = bridge.clone();
    let res = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["youtube.com".into()])
    }).await.unwrap();

    assert!(res.is_err(), "All participating browsers must ACK, even when one is explicitly marked required");
    bridge.shutdown().await;
}
#[tokio::test]
async fn test_browser_bridge_handles_apps_only_without_browser_clients() {
    let bridge = Arc::new(BrowserBridge::new_in_memory("token-apps-only".into(), 14226).await.unwrap());
    let b = bridge.clone();
    // When domains is empty, no browser clients are required
    let res = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &[])
    }).await.unwrap();
    assert!(res.is_ok());
    assert!(bridge.release_blocking().is_ok());
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

async fn assert_closed(socket: &mut Socket) {
    let msg = tokio::time::timeout(Duration::from_secs(6), socket.next()).await.expect("authentication must terminate");
    assert!(matches!(msg, None | Some(Err(_)) | Some(Ok(Message::Close(_)))));
}

#[tokio::test]
async fn rejects_legacy_token_hello() {
    let bridge = BrowserBridge::new_in_memory("legacy-secret".into(), 14301).await.unwrap();
    let (mut socket, _) = connect_async("ws://127.0.0.1:14301/focus-browser").await.unwrap();
    socket.send(Message::Text(json!({"type":"hello","version":1,"token":"legacy-secret","profile_id":"untrusted","browser":"chrome","install_type":"admin","may_disable":false}).to_string().into())).await.unwrap();
    assert_closed(&mut socket).await;
    assert!(!bridge.get_setup_info().profiles.iter().any(|p| p.is_connected));
    bridge.shutdown().await;
}

#[tokio::test]
async fn rejects_wrong_client_proof() {
    let bridge = BrowserBridge::new_in_memory("secret".into(), 14302).await.unwrap();
    let (mut socket, _) = connect_async("ws://127.0.0.1:14302/focus-browser").await.unwrap();
    challenge(&mut socket, &"0".repeat(64), "secret").await;
    socket.send(Message::Text(json!({"type":"auth_response","version":3,"metadata":"[\"untrusted\"]","proof":"0".repeat(64)}).to_string().into())).await.unwrap();
    assert_closed(&mut socket).await;
    assert!(!bridge.get_setup_info().profiles.iter().any(|p| p.is_connected));
    bridge.shutdown().await;
}

#[tokio::test]
async fn rejects_replayed_response_on_new_connection() {
    let bridge = BrowserBridge::new_in_memory("secret".into(), 14303).await.unwrap();
    let url = "ws://127.0.0.1:14303/focus-browser";
    let (mut first, _) = connect_async(url).await.unwrap();
    let c = "0".repeat(64);
    let ch = challenge(&mut first, &c, "secret").await;
    let m = "[\"untrusted\"]";
    let proof = mac(b"secret", &format!("pomotroid-focus-v3\nclient\n{c}\n{}\n{m}", ch["server_nonce"].as_str().unwrap()));
    first.close(None).await.unwrap();
    let (mut second, _) = connect_async(url).await.unwrap();
    let fresh = challenge(&mut second, &c, "secret").await;
    assert_ne!(fresh["server_nonce"], ch["server_nonce"]);
    second.send(Message::Text(json!({"type":"auth_response","version":3,"metadata":m,"proof":proof}).to_string().into())).await.unwrap();
    assert_closed(&mut second).await;
    assert!(!bridge.get_setup_info().profiles.iter().any(|p| p.is_connected));
    bridge.shutdown().await;
}

#[tokio::test]
async fn no_policy_before_client_auth() {
    let bridge = BrowserBridge::new_in_memory("secret".into(), 14304).await.unwrap();
    let (mut socket, _) = connect_async("ws://127.0.0.1:14304/focus-browser").await.unwrap();
    challenge(&mut socket, &"0".repeat(64), "secret").await;
    assert!(tokio::time::timeout(Duration::from_millis(100), socket.next()).await.is_err());
    assert!(!bridge.get_setup_info().profiles.iter().any(|p| p.is_connected));
    assert_closed(&mut socket).await;
    bridge.shutdown().await;
}

#[tokio::test]
async fn authenticates_then_sends_verifiable_policy() {
    let bridge = BrowserBridge::new_in_memory("secret".into(), 14305).await.unwrap();
    let (socket, _) = connect_async("ws://127.0.0.1:14305/focus-browser").await.unwrap();
    let mut peer = authenticate(socket, "secret", "trusted", "firefox").await;
    let Message::Text(policy) = peer.next().await.unwrap().unwrap() else { panic!("expected policy") };
    let policy: serde_json::Value = serde_json::from_str(&policy).unwrap();
    assert_eq!(policy["type"], "policy");
    assert_eq!(policy["version"], 3);
    assert_eq!(policy["active"], false);
    assert_eq!(peer.received, 1);
    assert!(bridge.get_setup_info().profiles.iter().any(|p| p.profile_id == "trusted" && p.is_connected));
    bridge.shutdown().await;
}

#[tokio::test]
async fn rejects_tampered_ack() {
    let bridge = BrowserBridge::new_in_memory("secret".into(), 14306).await.unwrap();
    let (socket, _) = connect_async("ws://127.0.0.1:14306/focus-browser").await.unwrap();
    let mut peer = authenticate(socket, "secret", "trusted", "chrome").await;
    peer.next().await.unwrap().unwrap();
    let payload = json!({"type":"ack","revision":0,"profile_id":"trusted"}).to_string();
    let tag = mac(&peer.client_key, &format!("pomotroid-focus-v3\nframe\n1\n{payload}"));
    peer.socket.send(Message::Text(json!({"type":"authenticated","sequence":1,"payload":payload.replace(":0", ":1"),"mac":tag}).to_string().into())).await.unwrap();
    assert_closed(&mut peer.socket).await;
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn stale_same_profile_socket_cannot_update_or_remove_replacement() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("secret".into(), 14307).await.unwrap());
    bridge.set_required_profile("same", BrowserKind::Zen, false).unwrap();
    let url = "ws://127.0.0.1:14307/focus-browser";
    let (socket, _) = connect_async(url).await.unwrap();
    let mut old = authenticate(socket, "secret", "same", "chrome").await;
    old.next().await.unwrap().unwrap();
    let (socket, _) = connect_async(url).await.unwrap();
    let mut replacement = authenticate(socket, "secret", "same", "zen").await;
    replacement.next().await.unwrap().unwrap();
    // Only the replacement may satisfy apply's ACK requirement.
    let b = bridge.clone();
    let apply = tokio::task::spawn_blocking(move || b.apply_blocking(&[], &["example.com".into()]));
    let Message::Text(policy) = replacement.next().await.unwrap().unwrap() else { panic!("policy") };
    let policy: serde_json::Value = serde_json::from_str(&policy).unwrap();
    let revision = policy["revision"].as_u64().unwrap();
    let _ = old.next().await;
    old.send(Message::Text(json!({"type":"ack","revision":revision,"profile_id":"same"}).to_string().into())).await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(!apply.is_finished(), "stale ACK must not satisfy replacement");
    assert_closed(&mut old.socket).await;
    assert!(!apply.is_finished(), "stale socket closure must not fail replacement policy");
    let setup = bridge.get_setup_info();
    let p = setup.profiles.iter().find(|p| p.profile_id == "same").unwrap();
    assert!(p.is_connected);
    assert_eq!(p.browser, Some(BrowserKind::Zen));
    replacement.send(Message::Text(json!({"type":"ack","revision":revision,"profile_id":"same"}).to_string().into())).await.unwrap();
    apply.await.unwrap().unwrap();
    assert!(bridge.health().is_ok());
    bridge.shutdown().await;
}

#[tokio::test]
#[ignore = "native browser enforcement requires a disposable guest"]
async fn late_unmapped_browser_invalidates_active_protection() {
    require_disposable_guest();
    let bridge = Arc::new(BrowserBridge::new_in_memory("late-secret".into(), 14311).await.unwrap());
    bridge.set_required_profile("first", BrowserKind::Firefox, false).unwrap();
    let url = "ws://127.0.0.1:14311/focus-browser";
    let (socket, _) = connect_async(url).await.unwrap();
    let mut first = authenticate(socket, "late-secret", "first", "firefox").await;
    first.next().await.unwrap().unwrap();
    let b = bridge.clone();
    let apply = tokio::task::spawn_blocking(move || b.apply_blocking(&[], &["example.com".into()]));
    let Message::Text(policy) = first.next().await.unwrap().unwrap() else { panic!("policy") };
    let revision = serde_json::from_str::<serde_json::Value>(&policy).unwrap()["revision"].as_u64().unwrap();
    first.send(Message::Text(json!({"type":"ack","revision":revision,"profile_id":"first"}).to_string().into())).await.unwrap();
    apply.await.unwrap().unwrap();
    let (socket, _) = connect_async(url).await.unwrap();
    let mut late = authenticate(socket, "late-secret", "new-profile", "firefox").await;
    assert_closed(&mut late.socket).await;
    assert!(bridge.health().is_err(), "a browser profile without policy must invalidate protection");
    bridge.shutdown().await;
}

#[tokio::test]
async fn removed_browser_profile_closes_its_socket_on_next_message() {
    let bridge = BrowserBridge::new_in_memory("remove-secret".into(), 14312).await.unwrap();
    bridge.set_required_profile("removed", BrowserKind::Firefox, false).unwrap();
    let (socket, _) = connect_async("ws://127.0.0.1:14312/focus-browser").await.unwrap();
    let mut peer = authenticate(socket, "remove-secret", "removed", "firefox").await;
    peer.next().await.unwrap().unwrap();
    bridge.remove_profiles_for_browser(BrowserKind::Firefox);
    peer.send(Message::Text(json!({"type":"heartbeat","revision":0,"profile_id":"removed"}).to_string().into())).await.unwrap();
    assert_closed(&mut peer.socket).await;
    bridge.shutdown().await;
}
