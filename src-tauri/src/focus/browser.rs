use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use rand_core::{OsRng, RngCore};
use super::browser_auth::{self, AuthenticatedChannel};

use super::enforcer::apps::ApplicationMonitor;
use super::enforcer::{EnforcerError, NativeEnforcer};
use super::model::AppTarget;

pub const BROWSER_PORT_DEFAULT: u16 = 1421;
pub const BROWSER_PROTOCOL_VERSION: u32 = 3;
pub const BROWSER_LEASE_SECS: u64 = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserKind {
    Chrome,
    Firefox,
    Safari,
    Zen,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequiredProfile {
    pub profile_id: String,
    pub browser: BrowserKind,
    pub is_required: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BrowserConfig {
    pub token: String,
    pub port: u16,
    pub profiles: Vec<RequiredProfile>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectedProfileInfo {
    pub profile_id: String,
    pub browser: Option<BrowserKind>,
    pub is_required: bool,
    pub is_connected: bool,
    pub last_seen_secs_ago: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BrowserSetupInfo {
    pub token: String,
    pub port: u16,
    pub profiles: Vec<ConnectedProfileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Ack {
        revision: u64,
        profile_id: String,
    },
    Heartbeat {
        revision: u64,
        profile_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Policy {
        version: u32,
        revision: u64,
        active: bool,
        domains: Vec<String>,
        lease_secs: u64,
    },
    Heartbeat {
        revision: u64,
    },
}

struct ConnectedClient {
    connection: uuid::Uuid,
    last_seen: Instant,
    last_acked_revision: u64,
}

struct SharedState {
    token: String,
    port: u16,
    config_path: Option<PathBuf>,
    current_revision: AtomicU64,
    is_active: AtomicBool,
    late_participant: AtomicBool,
    current_domains: Mutex<Vec<String>>,
    required_profiles: Mutex<HashMap<String, (BrowserKind, bool)>>,
    connected_clients: Mutex<HashMap<String, ConnectedClient>>,
    active_participants: Mutex<HashSet<String>>,
    ack_condvar: Condvar,
    apps: Mutex<Option<ApplicationMonitor>>,
}

pub struct BrowserBridge {
    shared: Arc<SharedState>,
    broadcast_tx: broadcast::Sender<String>,
    server_task: Mutex<Option<JoinHandle<()>>>,
}

impl BrowserBridge {
    fn generate_token() -> String {
        format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
    }

    pub async fn new_in_memory(token: String, port: u16) -> Result<Self, String> {
        Self::init_bridge(token, port, None, HashMap::new()).await
    }

    pub async fn new_persistent(app_data_dir: &std::path::Path, port: u16) -> Result<Self, String> {
        let config_path = app_data_dir.join("focus_browser_config.json");
        let (token, profiles) = if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                if let Ok(cfg) = serde_json::from_str::<BrowserConfig>(&content) {
                    let mut map = HashMap::new();
                    for p in cfg.profiles {
                        map.insert(p.profile_id, (p.browser, p.is_required));
                    }
                    (cfg.token, map)
                } else {
                    (Self::generate_token(), HashMap::new())
                }
            } else {
                (Self::generate_token(), HashMap::new())
            }
        } else {
            (Self::generate_token(), HashMap::new())
        };

        let bridge = Self::init_bridge(token, port, Some(config_path), profiles).await?;
        bridge.save_config();
        Ok(bridge)
    }

    async fn init_bridge(
        token: String,
        port: u16,
        config_path: Option<PathBuf>,
        required_profiles: HashMap<String, (BrowserKind, bool)>,
    ) -> Result<Self, String> {
        let (broadcast_tx, _) = broadcast::channel(32);
        let shared = Arc::new(SharedState {
            token,
            port,
            config_path,
            current_revision: AtomicU64::new(0),
            is_active: AtomicBool::new(false),
            late_participant: AtomicBool::new(false),
            current_domains: Mutex::new(Vec::new()),
            required_profiles: Mutex::new(required_profiles),
            connected_clients: Mutex::new(HashMap::new()),
            active_participants: Mutex::new(HashSet::new()),
            ack_condvar: Condvar::new(),
            apps: Mutex::new(None),
        });

        let addr: SocketAddr = ([127, 0, 0, 1], port).into();
        let listener = TcpListener::bind(addr).await.map_err(|e| {
            log::debug!("[focus-bridge] listener_failed port={port}");
            format!("Failed to bind port {port}: {e}")
        })?;
        log::debug!("[focus-bridge] listener_ready port={port}");

        let server_shared = Arc::clone(&shared);
        let server_tx = broadcast_tx.clone();

        let app_router = Router::new()
            .route("/focus-browser", get(ws_handler))
            .with_state((server_shared, server_tx));

        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app_router).await;
        });

        Ok(Self {
            shared,
            broadcast_tx,
            server_task: Mutex::new(Some(task)),
        })
    }

    fn save_config(&self) {
        if let Some(path) = &self.shared.config_path {
            let profiles: Vec<RequiredProfile> = self.shared.required_profiles.lock().unwrap()
                .iter()
                .map(|(id, (b, req))| RequiredProfile {
                    profile_id: id.clone(),
                    browser: *b,
                    is_required: *req,
                })
                .collect();
            let cfg = BrowserConfig {
                token: self.shared.token.clone(),
                port: self.shared.port,
                profiles,
            };
            if let Ok(json) = serde_json::to_string_pretty(&cfg) {
                let _ = std::fs::write(path, json);
            }
        }
    }

    pub fn get_setup_info(&self) -> BrowserSetupInfo {
        let token = self.shared.token.clone();
        let port = self.shared.port;
        let clients = self.shared.connected_clients.lock().unwrap();
        let required = self.shared.required_profiles.lock().unwrap();

        let mut profiles = Vec::new();
        for (id, (browser, is_req)) in required.iter() {
            let client = clients.get(id);
            profiles.push(ConnectedProfileInfo {
                profile_id: id.clone(),
                browser: Some(*browser),
                is_required: *is_req,
                is_connected: client.is_some(),
                last_seen_secs_ago: client.map(|c| c.last_seen.elapsed().as_secs()).unwrap_or(0),
            });
        }
        // Also include connected but unconfigured profiles
        for (id, client) in clients.iter() {
            if !required.contains_key(id) {
                profiles.push(ConnectedProfileInfo {
                    profile_id: id.clone(),
                    browser: None,
                    is_required: false,
                    is_connected: true,
                    last_seen_secs_ago: client.last_seen.elapsed().as_secs(),
                });
            }
        }

        BrowserSetupInfo { token, port, profiles }
    }
    pub fn set_required_profile(&self, profile_id: &str, browser: BrowserKind, required: bool) -> Result<(), String> {
        let clients = self.shared.connected_clients.lock().unwrap();
        if self.shared.is_active.load(Ordering::SeqCst) {
            return Err("Browser profiles cannot be changed while website blocking is active.".into());
        }
        let mut profiles = self.shared.required_profiles.lock().unwrap();
        profiles.insert(profile_id.to_string(), (browser, required));
        drop(profiles);
        drop(clients);
        self.save_config();
        Ok(())
    }
    pub fn remove_profiles_for_browser(&self, browser: BrowserKind) {
        let mut clients = self.shared.connected_clients.lock().unwrap();
        let mut profiles = self.shared.required_profiles.lock().unwrap();
        let removed: HashSet<String> = profiles.iter().filter(|(_, (b, _))| *b == browser).map(|(id, _)| id.clone()).collect();
        profiles.retain(|id, _| !removed.contains(id));
        clients.retain(|id, _| !removed.contains(id));
        drop(profiles);
        drop(clients);
        self.save_config();
    }
    pub fn get_token(&self) -> String {
        self.shared.token.clone()
    }
    pub fn is_active(&self) -> bool {
        self.shared.is_active.load(Ordering::SeqCst)
    }

    pub fn health(&self) -> Result<(), EnforcerError> {
        self.renew_lease()
    }
    pub async fn shutdown(&self) {
        if let Some(task) = self.server_task.lock().unwrap().take() {
            task.abort();
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State((shared, broadcast_tx)): State<(Arc<SharedState>, broadcast::Sender<String>)>,
) -> impl IntoResponse {
    ws.max_message_size(1024 * 1024)
        .on_upgrade(move |socket| handle_socket(socket, shared, broadcast_tx))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum HandshakeMessage {
    AuthInit { version: u32, client_nonce: String },
    AuthResponse { version: u32, metadata: String, proof: String },
}

async fn handshake(socket: &mut WebSocket, token: &str) -> Result<(String, AuthenticatedChannel), String> {
    let init = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await.map_err(|_| "init_timeout")?;
    let Some(Ok(Message::Text(text))) = init else { return Err("invalid_init".into()); };
    let HandshakeMessage::AuthInit { version, client_nonce } =
        serde_json::from_str(&text).map_err(|_| "invalid_init")? else { return Err("invalid_init".into()); };
    if version != BROWSER_PROTOCOL_VERSION { return Err("version_mismatch".into()); }
    let mut random = [0u8; 32];
    OsRng.try_fill_bytes(&mut random).map_err(|_| "random_unavailable")?;
    let server_nonce = browser_auth::hex(&random);
    let proof = browser_auth::server_proof(token, &client_nonce, &server_nonce)?;
    let challenge = serde_json::json!({
        "type": "auth_challenge", "version": BROWSER_PROTOCOL_VERSION,
        "server_nonce": server_nonce, "proof": proof
    }).to_string();
    // Bound challenge transport and response independently from the init deadline.
    let keys_and_info = tokio::time::timeout(Duration::from_secs(5), async {
        socket.send(Message::Text(challenge.into())).await.map_err(|_| "challenge_transport")?;
        let Some(Ok(Message::Text(text))) = socket.next().await else { return Err("invalid_response".into()); };
        let HandshakeMessage::AuthResponse { version, metadata, proof } =
            serde_json::from_str(&text).map_err(|_| "invalid_response")? else { return Err("invalid_response".into()); };
        if version != BROWSER_PROTOCOL_VERSION { return Err("version_mismatch".into()); }
        let keys = browser_auth::verify_client(token, &client_nonce, &server_nonce, &metadata, &proof)?;
        Ok::<_, String>((browser_auth::metadata(&metadata)?, AuthenticatedChannel::new(keys)))
    }).await.map_err(|_| "response_timeout")??;
    Ok(keys_and_info)
}

// A subscriber can already have older publications queued when it snapshots
// current state. Never send those after the snapshot or a newer policy.
fn advance_outbound_revision(revision: &mut u64, payload: &str) -> Result<bool, serde_json::Error> {
    #[derive(Deserialize)]
    struct Header<'a> {
        #[serde(rename = "type")]
        kind: &'a str,
        revision: u64,
    }
    let header: Header<'_> = serde_json::from_str(payload)?;
    if header.kind == "policy" {
        if header.revision <= *revision {
            return Ok(false);
        }
        *revision = header.revision;
    }
    Ok(true)
}

async fn handle_socket(
    mut socket: WebSocket,
    shared: Arc<SharedState>,
    broadcast_tx: broadcast::Sender<String>,
) {
    let connection = uuid::Uuid::new_v4();
    log::debug!("[focus-bridge] socket_accepted connection={connection}");
    let (profile_id, mut channel) = match handshake(&mut socket, &shared.token).await {
        Ok(authenticated) => authenticated,
        Err(reason) => {
            log::debug!("[focus-bridge] authentication_failed connection={connection} reason={reason}");
            let _ = socket.close().await;
            return;
        }
    };
    log::debug!("[focus-bridge] hello_accepted connection={connection} version={BROWSER_PROTOCOL_VERSION}");

    // Subscribe before registration and snapshot so concurrent policies cannot be lost.
    let mut rx = broadcast_tx.subscribe();
    let (rev, active, domains) = {
        let mut clients = shared.connected_clients.lock().unwrap();
        if shared.is_active.load(Ordering::SeqCst)
            && !shared.current_domains.lock().unwrap().is_empty()
            && !shared.active_participants.lock().unwrap().contains(&profile_id) {
            shared.late_participant.store(true, Ordering::SeqCst);
            shared.ack_condvar.notify_all();
            return;
        }
        clients.insert(profile_id.clone(), ConnectedClient {
            connection,
            last_seen: Instant::now(),
            last_acked_revision: 0,
        });
        (
            shared.current_revision.load(Ordering::SeqCst),
            shared.is_active.load(Ordering::SeqCst),
            shared.current_domains.lock().unwrap().clone(),
        )
    };
    let initial_msg = ServerMessage::Policy {
        version: BROWSER_PROTOCOL_VERSION, revision: rev, active, domains,
        lease_secs: BROWSER_LEASE_SECS,
    };
    // One connection task owns both directional counters; initial policy and all
    // later broadcasts go through this same outbound sequence owner.
    let (mut sender, mut receiver) = socket.split();
    let initial = serde_json::to_string(&initial_msg).ok()
        .and_then(|payload| channel.encode(&payload).ok());
    if let Some(wire) = initial {
        if sender.send(Message::Text(wire.into())).await.is_ok() {
            log::debug!("[focus-bridge] policy_sent connection={connection} revision={rev} active={active}");
            let mut outbound_revision = rev;
            loop {
                tokio::select! {
                    outgoing = rx.recv() => {
                        let Ok(payload) = outgoing else { break; };
                        match advance_outbound_revision(&mut outbound_revision, &payload) {
                            Ok(true) => {}
                            Ok(false) => continue,
                            Err(_) => break,
                        }
                        let Ok(wire) = channel.encode(&payload) else { break; };
                        if sender.send(Message::Text(wire.into())).await.is_err() { break; }
                    }
                    incoming = receiver.next() => {
                        let Some(Ok(message)) = incoming else { break; };
                        let text = match message {
                            Message::Text(text) => text,
                            Message::Ping(_) | Message::Pong(_) => continue,
                            _ => break,
                        };
                        let payload = match channel.decode(&text) {
                            Ok(payload) => payload,
                            Err(reason) => {
                                log::debug!("[focus-bridge] authentication_failed connection={connection} reason={reason}");
                                break;
                            }
                        };
                        let Ok(message) = serde_json::from_str::<ClientMessage>(&payload) else { break; };
                        let mut clients = shared.connected_clients.lock().unwrap();
                        let Some(client) = clients.get_mut(&profile_id).filter(|c| c.connection == connection) else {
                            // Removed or superseded sockets must reconnect, not keep receiving policy.
                            break;
                        };
                        match message {
                            ClientMessage::Ack { revision, profile_id: claimed } if claimed == profile_id => {
                                log::debug!("[focus-bridge] ack_received connection={connection} revision={revision}");
                                client.last_seen = Instant::now();
                                client.last_acked_revision = revision;
                                shared.ack_condvar.notify_all();
                            }
                            ClientMessage::Heartbeat { revision, profile_id: claimed } if claimed == profile_id => {
                                log::debug!("[focus-bridge] heartbeat_received connection={connection} revision={revision}");
                                client.last_seen = Instant::now();
                            }
                            _ => break,
                        }
                    }
                }
            }
        }
    }
    let _ = sender.close().await;
    log::debug!("[focus-bridge] socket_closed connection={connection}");
    let mut clients = shared.connected_clients.lock().unwrap();
    if clients.get(&profile_id).is_some_and(|c| c.connection == connection) {
        clients.remove(&profile_id);
        shared.ack_condvar.notify_all();
    }
}

fn effective_blocked_apps(
    apps: &[AppTarget],
    domains: &[String],
    connected_kinds: &HashSet<BrowserKind>,
) -> Vec<AppTarget> {
    let mut effective_apps = apps.to_vec();
    if domains.is_empty() {
        return effective_apps;
    }
    // Windows matches executable basenames, so retain its installed-browser scope.
    #[cfg(target_os = "windows")]
    let installed_kinds: HashSet<BrowserKind> = crate::focus::browser_detector::detect_installed_browsers()
        .into_iter().filter(|browser| browser.is_installed).map(|browser| browser.kind).collect();
    for (kind, name) in [
        (BrowserKind::Chrome, "Google Chrome"),
        (BrowserKind::Firefox, "Mozilla Firefox"),
        (BrowserKind::Zen, "Zen Browser"),
        (BrowserKind::Safari, "Safari"),
    ] {
        #[cfg(target_os = "windows")]
        if !installed_kinds.contains(&kind) { continue; }
        if !connected_kinds.contains(&kind) {
            #[cfg(target_os = "macos")]
            let identifiers: &[&str] = match kind {
                BrowserKind::Chrome => &["com.google.Chrome"],
                BrowserKind::Firefox => &["org.mozilla.firefox"],
                BrowserKind::Zen => &["app.zen-browser.zen", "org.mozilla.zen"],
                BrowserKind::Safari => &["com.apple.Safari"],
            };
            #[cfg(target_os = "windows")]
            let identifiers: &[&str] = match kind {
                BrowserKind::Chrome => &["chrome.exe"],
                BrowserKind::Firefox => &["firefox.exe"],
                BrowserKind::Zen => &["zen.exe"],
                BrowserKind::Safari => &["safari.exe"],
            };
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let identifiers: &[&str] = &[];
            for (index, &identifier) in identifiers.iter().enumerate() {
                if !effective_apps.iter().any(|a| a.identifier == identifier) {
                    log::debug!("[focus-bridge] auto_browser_target kind={kind:?}");
                    effective_apps.push(AppTarget {
                        id: if index == 0 { format!("auto_browser_{kind:?}") } else { format!("auto_browser_{kind:?}_{index}") },
                        name: name.into(),
                        identifier: identifier.into(),
                        platform: "all".into(),
                    });
                }
            }
        }
    }
    effective_apps
}

 
impl NativeEnforcer for BrowserBridge {
    fn apply_blocking(&self, apps: &[AppTarget], domains: &[String]) -> Result<(), EnforcerError> {
        log::debug!("[focus-bridge] apply apps={} domains={}", apps.len(), domains.len());
        // 2. Process domain blocking
        let (new_rev, target_participants) = {
            let clients = self.shared.connected_clients.lock().unwrap();
            let required = self.shared.required_profiles.lock().unwrap();
            let has_explicit_required = required.values().any(|(_, is_req)| *is_req);
            if !domains.is_empty() && clients.keys().any(|id| !required.contains_key(id)) {
                return Err(EnforcerError::HostsFileError("Browser companion needs a browser assignment in Settings.".into()));
            }
            if !domains.is_empty() {
                if let Some((id, _)) = required.iter().find(|(id, (_, is_required))| {
                    *is_required && !clients.contains_key(*id)
                }) {
                    log::debug!("[focus-bridge] apply_failed reason=required_disconnected");
                    return Err(EnforcerError::HostsFileError(format!(
                        "Required browser companion '{id}' is not connected."
                    )));
                }
            }
            if !domains.is_empty() && !has_explicit_required && clients.is_empty() {
                log::debug!("[focus-bridge] apply_failed reason=no_companion");
                self.shared.is_active.store(false, Ordering::SeqCst);
                return Err(EnforcerError::HostsFileError(
                    "No browser companion connected to enforce website blocking rules.".into(),
                ));
            }

            let new_rev = self.shared.current_revision.fetch_add(1, Ordering::SeqCst) + 1;
            *self.shared.current_domains.lock().unwrap() = domains.to_vec();
            self.shared.late_participant.store(false, Ordering::SeqCst);
            self.shared.is_active.store(true, Ordering::SeqCst);

            let mut participants: HashSet<String> = clients.keys().cloned().collect();
            for (req_id, (_, is_req)) in required.iter() {
                if *is_req {
                    participants.insert(req_id.clone());
                }
            }
            *self.shared.active_participants.lock().unwrap() = if domains.is_empty() {
                HashSet::new()
            } else {
                participants.clone()
            };
            // Serialize publication with registration/snapshot and other
            // publishers, not merely the in-memory policy mutation.
            let msg = ServerMessage::Policy {
                version: BROWSER_PROTOCOL_VERSION,
                revision: new_rev,
                active: true,
                domains: domains.to_vec(),
                lease_secs: BROWSER_LEASE_SECS,
            };
            let json = serde_json::to_string(&msg)
                .map_err(|e| EnforcerError::HostsFileError(e.to_string()))?;
            log::debug!("[focus-bridge] policy_sent revision={new_rev} participants={}", participants.len());
            let _ = self.broadcast_tx.send(json);
            (new_rev, participants)
        };


        // Wait up to 5 seconds for all target participants to acknowledge
        let start = Instant::now();
        let timeout = Duration::from_secs(5);

        let mut clients = self.shared.connected_clients.lock().unwrap();
        loop {
            if self.shared.late_participant.load(Ordering::SeqCst) {
                self.shared.is_active.store(false, Ordering::SeqCst);
                return Err(EnforcerError::HostsFileError("A browser joined without an active blocking policy.".into()));
            }
            if !domains.is_empty() && target_participants.iter().any(|id| !clients.contains_key(id)) {
                self.shared.is_active.store(false, Ordering::SeqCst);
                return Err(EnforcerError::HostsFileError("Browser companion disconnected before acknowledging blocking rules.".into()));
            }

            let mut all_acked = true;
            if !domains.is_empty() && target_participants.is_empty() {
                all_acked = false;
            } else {
                for p_id in &target_participants {
                    let has_acked = clients.get(p_id).map(|c| c.last_acked_revision >= new_rev).unwrap_or(false);
                    if !has_acked {
                        all_acked = false;
                        break;
                    }
                }
            }

            if all_acked {
                break;
            }

            let elapsed = start.elapsed();
            if elapsed >= timeout {
                log::debug!("[focus-bridge] apply_failed reason=ack_timeout revision={new_rev}");
                self.shared.is_active.store(false, Ordering::SeqCst);
                return Err(EnforcerError::HostsFileError("Timed out waiting for required browser extensions to acknowledge blocking rules.".into()));
            }

            let remaining = timeout - elapsed;
            let res = self.shared.ack_condvar.wait_timeout(clients, remaining).unwrap();
            clients = res.0;
        }
        drop(clients);
        let effective_apps = if domains.is_empty() {
            apps.to_vec()
        } else {
            let connected_browser_kinds: HashSet<BrowserKind> = {
                let clients = self.shared.connected_clients.lock().unwrap();
                let required = self.shared.required_profiles.lock().unwrap();
                target_participants.iter().filter_map(|id| {
                    clients.get(id).filter(|client| client.last_acked_revision >= new_rev)
                        .and_then(|_| required.get(id).map(|(kind, _)| *kind))
                }).collect()
            };
            effective_blocked_apps(apps, domains, &connected_browser_kinds)
        };
        log::debug!("[focus-bridge] app_monitor_targets count={}", effective_apps.len());
        if !effective_apps.is_empty() {
            let monitor = ApplicationMonitor::start(effective_apps).inspect_err(|_| {
                log::debug!("[focus-bridge] apply_failed reason=app_monitor_failed");
            })?;
            *self.shared.apps.lock().unwrap() = Some(monitor);
            log::debug!("[focus-bridge] app_monitor_ready");
        } else {
            log::debug!("[focus-bridge] app_monitor_skipped");
        }

        Ok(())
    }

    fn release_blocking(&self) -> Result<(), EnforcerError> {
        // Stop app monitor
        if let Some(monitor) = self.shared.apps.lock().unwrap().take() {
            let _ = monitor.stop();
        }

        let new_rev = {
            // The same lock protects registration snapshots, apply publication,
            // and release publication, so no connection sees a torn policy.
            let _clients = self.shared.connected_clients.lock().unwrap();
            let new_rev = self.shared.current_revision.fetch_add(1, Ordering::SeqCst) + 1;
            *self.shared.current_domains.lock().unwrap() = Vec::new();
            self.shared.is_active.store(false, Ordering::SeqCst);
            self.shared.late_participant.store(false, Ordering::SeqCst);
            self.shared.active_participants.lock().unwrap().clear();
            log::debug!("[focus-bridge] policy_released revision={new_rev}");
            let msg = ServerMessage::Policy {
                version: BROWSER_PROTOCOL_VERSION,
                revision: new_rev,
                active: false,
                domains: Vec::new(),
                lease_secs: BROWSER_LEASE_SECS,
            };
            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = self.broadcast_tx.send(json);
            }
            new_rev
        };

        // Wait up to 2 seconds for online acks (best effort)
        let start = Instant::now();
        let timeout = Duration::from_secs(2);
        let mut clients = self.shared.connected_clients.lock().unwrap();
        while start.elapsed() < timeout {
            let all_acked = clients.values().all(|c| c.last_acked_revision >= new_rev);
            if all_acked {
                break;
            }
            let remaining = timeout - start.elapsed();
            let res = self.shared.ack_condvar.wait_timeout(clients, remaining).unwrap();
            clients = res.0;
        }

        Ok(())
    }

    fn renew_lease(&self) -> Result<(), EnforcerError> {
        if !self.shared.is_active.load(Ordering::SeqCst) {
            return Ok(());
        }
        if self.shared.late_participant.load(Ordering::SeqCst) {
            return Err(EnforcerError::LeaseLost);
        }

        if let Some(monitor) = self.shared.apps.lock().unwrap().as_ref() {
            monitor.health()?;
        }

        let current_rev = self.shared.current_revision.load(Ordering::SeqCst);
        let clients = self.shared.connected_clients.lock().unwrap();
        let required = self.shared.required_profiles.lock().unwrap();

        for (req_id, (_, is_req)) in required.iter() {
            if *is_req {
                let client = clients.get(req_id);
                match client {
                    Some(c) => {
                        if c.last_seen.elapsed() > Duration::from_secs(BROWSER_LEASE_SECS) {
                            log::debug!("[focus-bridge] lease_failed reason=stale_heartbeat");
                            return Err(EnforcerError::LeaseLost);
                        }
                        if c.last_acked_revision < current_rev {
                            log::debug!("[focus-bridge] lease_failed reason=stale_ack");
                            return Err(EnforcerError::LeaseLost);
                        }
                    }
                    None => {
                        log::debug!("[focus-bridge] lease_failed reason=required_disconnected");
                        return Err(EnforcerError::LeaseLost);
                    }
                }
            }
        }
        for id in self.shared.active_participants.lock().unwrap().iter() {
            match clients.get(id) {
                None => {
                    log::debug!("[focus-bridge] lease_failed reason=participant_disconnected");
                    return Err(EnforcerError::LeaseLost);
                }
                Some(client) if client.last_seen.elapsed() > Duration::from_secs(BROWSER_LEASE_SECS) => {
                    log::debug!("[focus-bridge] lease_failed reason=stale_heartbeat");
                    return Err(EnforcerError::LeaseLost);
                }
                Some(client) if client.last_acked_revision < current_rev => {
                    log::debug!("[focus-bridge] lease_failed reason=stale_ack");
                    return Err(EnforcerError::LeaseLost);
                }
                Some(_) => {}
            }
        }

        let heartbeat_msg = ServerMessage::Heartbeat { revision: current_rev };
        if let Ok(json) = serde_json::to_string(&heartbeat_msg) {
            let _ = self.broadcast_tx.send(json);
        }

        Ok(())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod effective_blocked_apps_tests {
    use super::*;

    #[test]
    fn zen_connected_is_not_an_automatic_block_target() {
        let targets = effective_blocked_apps(&[], &["example.com".into()], &HashSet::from([BrowserKind::Zen]));
        assert!(targets.iter().any(|target| target.identifier == "com.google.Chrome"));
        assert!(!targets.iter().any(|target| target.identifier == "app.zen-browser.zen"));
        assert!(!targets.iter().any(|target| target.identifier == "org.mozilla.zen"));
    }

    #[test]
    fn unconnected_safari_and_both_zen_bundle_ids_are_blocked() {
        let explicit = AppTarget { id: "existing".into(), name: "Zen".into(), identifier: "org.mozilla.zen".into(), platform: "macos".into() };
        let targets = effective_blocked_apps(&[], &["example.com".into()], &HashSet::new());
        assert_eq!(targets.iter().filter(|target| target.identifier == "org.mozilla.zen").count(), 1);
        assert!(targets.iter().any(|target| target.identifier == "app.zen-browser.zen"));
        assert!(targets.iter().any(|target| target.identifier == "com.apple.Safari"));
        let with_explicit = effective_blocked_apps(&[explicit], &["example.com".into()], &HashSet::new());
        assert_eq!(with_explicit.iter().filter(|target| target.identifier == "org.mozilla.zen").count(), 1);
    }

    #[test]
    fn undiscovered_unconnected_browsers_remain_blocked() {
        let targets = effective_blocked_apps(&[], &["example.com".into()], &HashSet::from([BrowserKind::Firefox]));
        assert!(targets.iter().any(|target| target.identifier == "com.apple.Safari"));
        assert!(targets.iter().any(|target| target.identifier == "com.google.Chrome"));
        assert!(targets.iter().any(|target| target.identifier == "org.mozilla.zen"));
        assert!(!targets.iter().any(|target| target.identifier == "org.mozilla.firefox"));
    }

    #[test]
    fn empty_domains_do_not_add_browser_targets() {
        let explicit = AppTarget { id: "app".into(), name: "App".into(), identifier: "test.app".into(), platform: "all".into() };
        let targets = effective_blocked_apps(&[explicit], &[], &HashSet::from([BrowserKind::Zen]));
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].identifier, "test.app");
    }

    #[test]
    fn explicit_zen_target_remains_explicit() {
        let explicit = AppTarget { id: "zen".into(), name: "Zen".into(), identifier: "app.zen-browser.zen".into(), platform: "all".into() };
        let targets = effective_blocked_apps(&[explicit], &["example.com".into()], &HashSet::from([BrowserKind::Zen]));
        assert_eq!(targets.iter().filter(|target| target.identifier == "app.zen-browser.zen").count(), 1);
        assert!(targets.iter().any(|target| target.id == "zen"));
    }
}

#[cfg(test)]
mod policy_publication_tests {
    use super::*;

    #[tokio::test]
    async fn unmapped_participant_cannot_start_domain_enforcement() {
        let bridge = BrowserBridge::new_in_memory("test-only".into(), 14309).await.unwrap();
        bridge.shared.connected_clients.lock().unwrap().insert("profile".into(), ConnectedClient {
            connection: uuid::Uuid::new_v4(),
            last_seen: Instant::now(),
            last_acked_revision: 0,
        });
        let setup = bridge.get_setup_info();
        assert_eq!(setup.profiles[0].browser, None);
        let error = bridge.apply_blocking(&[], &["example.com".into()]).unwrap_err().to_string();
        assert!(error.contains("browser assignment"));
        assert!(!bridge.is_active());
        bridge.set_required_profile("profile", BrowserKind::Zen, false).unwrap();
        assert_eq!(bridge.get_setup_info().profiles[0].browser, Some(BrowserKind::Zen));
        bridge.shared.is_active.store(true, Ordering::SeqCst);
        assert!(bridge.set_required_profile("profile", BrowserKind::Chrome, true).is_err());
        bridge.shared.is_active.store(false, Ordering::SeqCst);
        bridge.shutdown().await;
    }

    #[test]
    fn queued_policies_never_regress_snapshot_revision_but_heartbeats_survive() {
        let policy = |revision| serde_json::to_string(&ServerMessage::Policy {
            version: BROWSER_PROTOCOL_VERSION, revision, active: true,
            domains: vec!["example.com".into()], lease_secs: BROWSER_LEASE_SECS,
        }).unwrap();
        let mut revision = 3; // Current initial snapshot, with older broadcasts queued.
        assert!(!advance_outbound_revision(&mut revision, &policy(1)).unwrap());
        assert!(!advance_outbound_revision(&mut revision, &policy(2)).unwrap());
        assert!(!advance_outbound_revision(&mut revision, &policy(3)).unwrap());
        assert!(advance_outbound_revision(&mut revision, &policy(4)).unwrap());
        assert_eq!(revision, 4);
        let heartbeat = serde_json::to_string(&ServerMessage::Heartbeat { revision: 4 }).unwrap();
        assert!(advance_outbound_revision(&mut revision, &heartbeat).unwrap());
        assert_eq!(revision, 4);
        assert!(!advance_outbound_revision(&mut revision, &policy(3)).unwrap());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn release_cannot_change_policy_while_connection_snapshot_is_owned() {
        let bridge = Arc::new(BrowserBridge::new_in_memory("snapshot-test".into(), 14308).await.unwrap());
        // Registration/snapshot holds this mutex. Keep domains locked as well so
        // the old release path visibly stops between revision and domain writes.
        let clients = bridge.shared.connected_clients.lock().unwrap();
        let domains = bridge.shared.current_domains.lock().unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let b = bridge.clone();
        let release = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            b.release_blocking().unwrap();
        });
        started_rx.recv().unwrap();
        let deadline = Instant::now() + Duration::from_millis(200);
        while bridge.shared.current_revision.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
            std::thread::yield_now();
        }
        let observed_revision = bridge.shared.current_revision.load(Ordering::SeqCst);
        drop(domains);
        drop(clients);
        release.join().unwrap();
        assert_eq!(observed_revision, 0, "release changed revision during a connection's snapshot");
        assert_eq!(bridge.shared.current_revision.load(Ordering::SeqCst), 1);
        assert!(!bridge.shared.is_active.load(Ordering::SeqCst));
        assert!(bridge.shared.current_domains.lock().unwrap().is_empty());
        bridge.shutdown().await;
    }
}
