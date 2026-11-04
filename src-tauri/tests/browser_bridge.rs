use std::sync::Arc;
use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use pomotroid_lib::focus::browser::{BrowserBridge, BrowserKind};
use pomotroid_lib::focus::enforcer::NativeEnforcer;

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
async fn test_browser_bridge_applies_and_releases_with_ack() {
    let bridge = Arc::new(BrowserBridge::new_in_memory("secret-token-123".into(), 14216).await.unwrap());
    bridge.set_required_profile("prof-chrome-1", BrowserKind::Chrome, true);

    let url = "ws://127.0.0.1:14216/focus-browser";
    let (mut ws, _) = connect_async(url).await.unwrap();

    let hello = json!({
        "type": "hello",
        "version": 1,
        "token": "secret-token-123",
        "profile_id": "prof-chrome-1",
        "browser": "chrome",
        "install_type": "admin",
        "may_disable": false
    });
    ws.send(Message::Text(hello.to_string().into())).await.unwrap();

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
async fn test_browser_bridge_detects_disconnect_for_required_profile() {
    let bridge = Arc::new(BrowserBridge::new_in_memory("secret-token-123".into(), 14217).await.unwrap());
    bridge.set_required_profile("prof-req-1", BrowserKind::Chrome, true);

    let url = "ws://127.0.0.1:14217/focus-browser";
    let (mut ws, _) = connect_async(url).await.unwrap();

    let hello = json!({
        "type": "hello",
        "version": 1,
        "token": "secret-token-123",
        "profile_id": "prof-req-1",
        "browser": "chrome",
        "install_type": "admin",
        "may_disable": false
    });
    ws.send(Message::Text(hello.to_string().into())).await.unwrap();

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
async fn test_browser_bridge_fails_apply_on_client_error() {
    let bridge = Arc::new(BrowserBridge::new_in_memory("token-123".into(), 14221).await.unwrap());
    bridge.set_required_profile("prof-err-1", BrowserKind::Zen, true);

    let (mut ws, _) = connect_async("ws://127.0.0.1:14221/focus-browser").await.unwrap();
    // Send Hello
    let hello = json!({
        "type": "hello",
        "version": 1,
        "token": "token-123",
        "profile_id": "prof-err-1",
        "browser": "zen",
        "install_type": "admin",
        "may_disable": false
    });
    ws.send(Message::Text(hello.to_string().into())).await.unwrap();

    // Client responds with Error instead of Ack
    tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = ws.next().await {
            let data: serde_json::Value = serde_json::from_str(&text).unwrap();
            if data["type"] == "policy" {
                let rev = data["revision"].as_u64().unwrap();
                let err_msg = json!({
                    "type": "error",
                    "revision": rev,
                    "profile_id": "prof-err-1",
                    "code": "dnr_error"
                });
                ws.send(Message::Text(err_msg.to_string().into())).await.unwrap();
            }
        }
    });

    tokio::time::sleep(Duration::from_millis(50)).await;
    let b = bridge.clone();
    let start = std::time::Instant::now();
    let res = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["facebook.com".into()])
    }).await.unwrap();

    assert!(res.is_err(), "Expected apply_blocking to fail when client reports error");
    assert!(start.elapsed() < Duration::from_secs(2), "apply_blocking should fail immediately on client error instead of timing out, took {:?}", start.elapsed());
    let err_msg = res.unwrap_err().to_string();
    assert!(err_msg.contains("dnr_error"), "Error should contain client error code, got: {}", err_msg);
    bridge.shutdown().await;
}

#[tokio::test]
async fn test_browser_bridge_heartbeat_does_not_forge_ack() {
    let bridge = Arc::new(BrowserBridge::new_in_memory("token-hb-123".into(), 14222).await.unwrap());
    bridge.set_required_profile("prof-hb-1", BrowserKind::Zen, true);

    let (mut ws, _) = connect_async("ws://127.0.0.1:14222/focus-browser").await.unwrap();
    let hello = json!({
        "type": "hello",
        "version": 1,
        "token": "token-hb-123",
        "profile_id": "prof-hb-1",
        "browser": "zen",
        "install_type": "admin",
        "may_disable": false
    });
    ws.send(Message::Text(hello.to_string().into())).await.unwrap();

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
async fn test_browser_bridge_fails_when_domains_non_empty_and_no_clients() {
    let bridge = Arc::new(BrowserBridge::new_in_memory("token-no-client".into(), 14223).await.unwrap());
    let b = bridge.clone();
    let res = tokio::task::spawn_blocking(move || {
        b.apply_blocking(&[], &["facebook.com".into()])
    }).await.unwrap();

    assert!(res.is_err(), "Non-empty domains must require at least one connected browser companion");
    bridge.shutdown().await;
}
