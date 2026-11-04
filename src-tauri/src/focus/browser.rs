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

use super::enforcer::apps::ApplicationMonitor;
use super::enforcer::{EnforcerError, NativeEnforcer};
use super::model::AppTarget;

pub const BROWSER_PORT_DEFAULT: u16 = 1421;
pub const BROWSER_PROTOCOL_VERSION: u32 = 1;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConfig {
    pub token: String,
    pub port: u16,
    pub profiles: Vec<RequiredProfile>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectedProfileInfo {
    pub profile_id: String,
    pub browser: BrowserKind,
    pub install_type: String,
    pub may_disable: bool,
    pub is_required: bool,
    pub is_connected: bool,
    pub last_seen_secs_ago: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserSetupInfo {
    pub token: String,
    pub port: u16,
    pub profiles: Vec<ConnectedProfileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Hello {
        version: u32,
        token: String,
        profile_id: String,
        browser: BrowserKind,
        install_type: String,
        may_disable: bool,
    },
    Ack {
        revision: u64,
        profile_id: String,
    },
    Heartbeat {
        revision: u64,
        profile_id: String,
    },
    Error {
        revision: u64,
        profile_id: String,
        code: String,
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
    profile_id: String,
    browser: BrowserKind,
    install_type: String,
    may_disable: bool,
    last_seen: Instant,
    last_acked_revision: u64,
    last_error_revision: Option<u64>,
    last_error_code: Option<String>,
}

struct SharedState {
    token: String,
    port: u16,
    config_path: Option<PathBuf>,
    current_revision: AtomicU64,
    is_active: AtomicBool,
    current_domains: Mutex<Vec<String>>,
    required_profiles: Mutex<HashMap<String, (BrowserKind, bool)>>,
    connected_clients: Mutex<HashMap<String, ConnectedClient>>,
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
            current_domains: Mutex::new(Vec::new()),
            required_profiles: Mutex::new(required_profiles),
            connected_clients: Mutex::new(HashMap::new()),
            ack_condvar: Condvar::new(),
            apps: Mutex::new(None),
        });

        let addr: SocketAddr = ([127, 0, 0, 1], port).into();
        let listener = TcpListener::bind(addr).await.map_err(|e| format!("Failed to bind port {port}: {e}"))?;

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
                browser: *browser,
                install_type: client.map(|c| c.install_type.clone()).unwrap_or_else(|| "unknown".into()),
                may_disable: client.map(|c| c.may_disable).unwrap_or(true),
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
                    browser: client.browser,
                    install_type: client.install_type.clone(),
                    may_disable: client.may_disable,
                    is_required: false,
                    is_connected: true,
                    last_seen_secs_ago: client.last_seen.elapsed().as_secs(),
                });
            }
        }

        BrowserSetupInfo { token, port, profiles }
    }
    pub fn set_required_profile(&self, profile_id: &str, browser: BrowserKind, required: bool) {
        let mut profiles = self.shared.required_profiles.lock().unwrap();
        profiles.insert(profile_id.to_string(), (browser, required));
        drop(profiles);
        self.save_config();
    }
    pub fn remove_profiles_for_browser(&self, browser: BrowserKind) {
        let mut profiles = self.shared.required_profiles.lock().unwrap();
        profiles.retain(|_, (b, _)| *b != browser);
        drop(profiles);
        let mut clients = self.shared.connected_clients.lock().unwrap();
        clients.retain(|_, c| c.browser != browser);
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
    ws.on_upgrade(move |socket| handle_socket(socket, shared, broadcast_tx))
}

async fn handle_socket(
    mut socket: WebSocket,
    shared: Arc<SharedState>,
    broadcast_tx: broadcast::Sender<String>,
) {

    let mut authenticated_info: Option<(String, BrowserKind, String, bool)> = None;

    // First frame must be Hello with valid token within 5 seconds
    let hello_res = tokio::time::timeout(Duration::from_secs(5), socket.next()).await;
    match hello_res {
        Ok(Some(Ok(Message::Text(text)))) => {
            if let Ok(ClientMessage::Hello { version, token, profile_id, browser, install_type, may_disable }) = serde_json::from_str(&text) {
                if version == BROWSER_PROTOCOL_VERSION && token == shared.token {
                    authenticated_info = Some((profile_id, browser, install_type, may_disable));
                }
            }
        }
        _ => {}
    }

    let Some((profile_id, browser, install_type, may_disable)) = authenticated_info else {
        let _ = socket.close().await;
        return;
    };

    // Subscribe to broadcast BEFORE inserting client and taking policy snapshot
    let mut rx = broadcast_tx.subscribe();

    let (rev, active, domains) = {
        let mut clients = shared.connected_clients.lock().unwrap();
        clients.insert(profile_id.clone(), ConnectedClient {
            profile_id: profile_id.clone(),
            browser,
            install_type,
            may_disable,
            last_seen: Instant::now(),
            last_acked_revision: 0,
            last_error_revision: None,
            last_error_code: None,
        });
        let active = shared.is_active.load(Ordering::SeqCst);
        let rev = shared.current_revision.load(Ordering::SeqCst);
        let domains = shared.current_domains.lock().unwrap().clone();
        (rev, active, domains)
    };

    let initial_msg = ServerMessage::Policy {
        version: BROWSER_PROTOCOL_VERSION,
        revision: rev,
        active,
        domains,
        lease_secs: BROWSER_LEASE_SECS,
    };
    if let Ok(json) = serde_json::to_string(&initial_msg) {
        let _ = socket.send(Message::Text(json.into())).await;
    }
    let (mut ws_sender, mut ws_receiver) = socket.split();

    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    let profile_for_recv = profile_id.clone();
    let shared_for_recv = Arc::clone(&shared);

    while let Some(Ok(Message::Text(text))) = ws_receiver.next().await {
        if let Ok(msg) = serde_json::from_str::<ClientMessage>(&text) {
            match msg {
                ClientMessage::Ack { revision, profile_id } => {
                    if profile_id == profile_for_recv {
                        let mut clients = shared_for_recv.connected_clients.lock().unwrap();
                        if let Some(c) = clients.get_mut(&profile_id) {
                            c.last_seen = Instant::now();
                            c.last_acked_revision = revision;
                            c.last_error_revision = None;
                            c.last_error_code = None;
                            shared_for_recv.ack_condvar.notify_all();
                        }
                    }
                }
                ClientMessage::Heartbeat { revision: _, profile_id } => {
                    if profile_id == profile_for_recv {
                        let mut clients = shared_for_recv.connected_clients.lock().unwrap();
                        if let Some(c) = clients.get_mut(&profile_id) {
                            c.last_seen = Instant::now();
                        }
                    }
                }
                ClientMessage::Error { revision, profile_id, code } => {
                    if profile_id == profile_for_recv {
                        let mut clients = shared_for_recv.connected_clients.lock().unwrap();
                        if let Some(c) = clients.get_mut(&profile_id) {
                            c.last_seen = Instant::now();
                            c.last_error_revision = Some(revision);
                            c.last_error_code = Some(code);
                            shared_for_recv.ack_condvar.notify_all();
                        }
                    }
                }
                _ => {}
            }
        }
    }

    send_task.abort();
    let mut clients = shared.connected_clients.lock().unwrap();
    clients.remove(&profile_id);
}

impl NativeEnforcer for BrowserBridge {
    fn apply_blocking(&self, apps: &[AppTarget], domains: &[String]) -> Result<(), EnforcerError> {
        // 1. Process application blocking
        if !apps.is_empty() {
            let monitor = ApplicationMonitor::start(apps.to_vec())?;
            *self.shared.apps.lock().unwrap() = Some(monitor);
        }

        // 2. Process domain blocking
        let (new_rev, target_participants) = {
            let clients = self.shared.connected_clients.lock().unwrap();
            let required = self.shared.required_profiles.lock().unwrap();
            let has_explicit_required = required.values().any(|(_, is_req)| *is_req);
            if !domains.is_empty() && !has_explicit_required && clients.is_empty() {
                self.shared.is_active.store(false, Ordering::SeqCst);
                return Err(EnforcerError::HostsFileError(
                    "No browser companion connected to enforce website blocking rules.".into(),
                ));
            }

            let new_rev = self.shared.current_revision.fetch_add(1, Ordering::SeqCst) + 1;
            *self.shared.current_domains.lock().unwrap() = domains.to_vec();
            self.shared.is_active.store(true, Ordering::SeqCst);

            let mut participants: HashSet<String> = clients.keys().cloned().collect();
            for (req_id, (_, is_req)) in required.iter() {
                if *is_req {
                    participants.insert(req_id.clone());
                }
            }
            (new_rev, participants)
        };

        let msg = ServerMessage::Policy {
            version: BROWSER_PROTOCOL_VERSION,
            revision: new_rev,
            active: true,
            domains: domains.to_vec(),
            lease_secs: BROWSER_LEASE_SECS,
        };
        let json = serde_json::to_string(&msg).map_err(|e| EnforcerError::HostsFileError(e.to_string()))?;
        let _ = self.broadcast_tx.send(json);

        // Wait up to 5 seconds for all target participants to acknowledge
        let start = Instant::now();
        let timeout = Duration::from_secs(5);

        let mut clients = self.shared.connected_clients.lock().unwrap();
        loop {
            // Check if any client reported an error for this revision
            for (id, client) in clients.iter() {
                if client.last_error_revision == Some(new_rev) {
                    let err_code = client.last_error_code.as_deref().unwrap_or("unknown error");
                    self.shared.is_active.store(false, Ordering::SeqCst);
                    return Err(EnforcerError::HostsFileError(format!(
                        "Browser extension '{}' reported an error applying blocking rules: {}",
                        id, err_code
                    )));
                }
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
                self.shared.is_active.store(false, Ordering::SeqCst);
                return Err(EnforcerError::HostsFileError("Timed out waiting for required browser extensions to acknowledge blocking rules.".into()));
            }

            let remaining = timeout - elapsed;
            let res = self.shared.ack_condvar.wait_timeout(clients, remaining).unwrap();
            clients = res.0;
        }

        Ok(())
    }

    fn release_blocking(&self) -> Result<(), EnforcerError> {
        // Stop app monitor
        if let Some(monitor) = self.shared.apps.lock().unwrap().take() {
            let _ = monitor.stop();
        }

        let new_rev = self.shared.current_revision.fetch_add(1, Ordering::SeqCst) + 1;
        *self.shared.current_domains.lock().unwrap() = Vec::new();
        self.shared.is_active.store(false, Ordering::SeqCst);

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
                        if c.last_seen.elapsed() > Duration::from_secs(BROWSER_LEASE_SECS) || c.last_acked_revision < current_rev {
                            return Err(EnforcerError::LeaseLost);
                        }
                    }
                    None => return Err(EnforcerError::LeaseLost),
                }
            }
        }

        let heartbeat_msg = ServerMessage::Heartbeat { revision: current_rev };
        if let Ok(json) = serde_json::to_string(&heartbeat_msg) {
            let _ = self.broadcast_tx.send(json);
        }

        Ok(())
    }
}
