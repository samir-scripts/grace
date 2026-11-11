pub mod apps;
pub mod protocol;
pub mod hosts;
pub mod macos;
pub mod watchdog;
pub mod windows;

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::focus::model::AppTarget;
use hosts::{apply_hosts_file, default_hosts_path, revert_hosts_file};
use watchdog::WatchdogLease;

#[derive(Debug, PartialEq, Eq)]
pub enum EnforcerError {
    NotAuthorized,
    HostsFileError(String),
    InvalidTarget(String),
    ProcessTerminationFailed(String),
    PlatformUnsupported,
    LeaseLost,
}

impl fmt::Display for EnforcerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAuthorized => write!(f, "Focus enforcement is not authorized by the operating system"),
            Self::HostsFileError(e) => write!(f, "Failed to modify hosts file: {e}"),
            Self::InvalidTarget(e) => write!(f, "Invalid blocked application: {e}"),
            Self::ProcessTerminationFailed(e) => write!(f, "Failed to terminate blocked application: {e}"),
            Self::PlatformUnsupported => write!(f, "Platform is not supported for native enforcement"),
            Self::LeaseLost => write!(f, "Focus enforcement lease was lost"),
        }
    }
}

impl std::error::Error for EnforcerError {}

pub trait NativeEnforcer: Send + Sync {
    fn apply_blocking(&self, apps: &[AppTarget], domains: &[String]) -> Result<(), EnforcerError>;
    fn release_blocking(&self) -> Result<(), EnforcerError>;
    fn renew_lease(&self) -> Result<(), EnforcerError>;
}

pub struct SystemEnforcer {
    watchdog: WatchdogLease,
    is_active: Arc<AtomicBool>,
    apps: Arc<Mutex<Option<apps::ApplicationMonitor>>>,
    hosts_applied: Arc<AtomicBool>,
}

impl Default for SystemEnforcer {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemEnforcer {
    pub fn new() -> Self {
        let is_active = Arc::new(AtomicBool::new(false));
        let active_flag = Arc::clone(&is_active);
        let apps = Arc::new(Mutex::new(None::<apps::ApplicationMonitor>));
        let apps_expired = Arc::clone(&apps);
        let hosts_applied = Arc::new(AtomicBool::new(false));
        let hosts_expired = Arc::clone(&hosts_applied);

        // Crash recovery watchdog: 15 second lease, releases hosts file if heartbeat ceases
        let watchdog = WatchdogLease::new(Duration::from_secs(15), move || {
            log::warn!("[enforcer] Watchdog lease expired. Reverting hosts file.");
            if let Some(monitor) = apps_expired.lock().unwrap().take() {
                if let Err(error) = monitor.stop() {
                    log::error!("[enforcer] monitor shutdown failed: {error}");
                }
            }
            if hosts_expired.load(Ordering::Relaxed) {
                let hosts_path = default_hosts_path();
                match revert_hosts_file(&hosts_path) {
                    Ok(()) => hosts_expired.store(false, Ordering::Relaxed),
                    Err(error) => log::error!("[enforcer] hosts recovery failed: {error}"),
                }
            }
            active_flag.store(false, Ordering::Relaxed);
        });

        Self {
            watchdog,
            is_active,
            apps,
            hosts_applied,
        }
    }
}

impl NativeEnforcer for SystemEnforcer {
    fn apply_blocking(&self, apps: &[AppTarget], domains: &[String]) -> Result<(), EnforcerError> {

        // 3. Apply hosts file modifications if domains present
        if !domains.is_empty() {
            self.hosts_applied.store(true, Ordering::Relaxed);
            let hosts_path = default_hosts_path();
            apply_hosts_file(&hosts_path, domains)
                .map_err(|e| EnforcerError::HostsFileError(e.to_string()))?;

            // Flush DNS
            #[cfg(target_os = "macos")]
            {
                let enforcer = macos::MacOSEnforcer::new();
                let _ = enforcer.flush_dns();
            }
            #[cfg(target_os = "windows")]
            {
                let enforcer = windows::WindowsEnforcer::new();
                let _ = enforcer.flush_dns();
            }
        }

        if !apps.is_empty() {
            *self.apps.lock().unwrap() = Some(apps::ApplicationMonitor::start(apps.to_vec())?);
        }
        self.watchdog.arm();

        self.is_active.store(true, Ordering::Relaxed);
        Ok(())
    }

    fn release_blocking(&self) -> Result<(), EnforcerError> {
        if let Some(monitor) = self.apps.lock().unwrap().take() {
            // Stopping removes the policy even if the worker previously reported an error.
            if let Err(error) = monitor.stop() {
                log::warn!("[enforcer] stopped unhealthy application monitor: {error}");
            }
        }
        if self.hosts_applied.load(Ordering::Relaxed) {
            revert_hosts_file(&default_hosts_path()).map_err(|e| EnforcerError::HostsFileError(e.to_string()))?;
            #[cfg(target_os = "macos")]
            macos::MacOSEnforcer::new().flush_dns()?;
            #[cfg(target_os = "windows")]
            windows::WindowsEnforcer::new().flush_dns()?;
            self.hosts_applied.store(false, Ordering::Relaxed);
        }
        self.watchdog.disarm();
        self.is_active.store(false, Ordering::Relaxed);
        Ok(())
    }

    fn renew_lease(&self) -> Result<(), EnforcerError> {
        if !self.is_active.load(Ordering::Relaxed) || !self.watchdog.is_armed() {
            return Err(EnforcerError::LeaseLost);
        }
        if let Some(monitor) = self.apps.lock().unwrap().as_ref() {
            monitor.health()?;
        }
        self.watchdog.renew();
        Ok(())
    }
}

/// In-memory mock enforcer for test isolation and platforms without root access
pub struct MockEnforcer {
    pub is_active: AtomicBool,
    pub blocked_domains: std::sync::Mutex<Vec<String>>,
    pub blocked_apps: std::sync::Mutex<Vec<AppTarget>>,
}

impl Default for MockEnforcer {
    fn default() -> Self {
        Self::new()
    }
}

impl MockEnforcer {
    pub fn new() -> Self {
        Self {
            is_active: AtomicBool::new(false),
            blocked_domains: std::sync::Mutex::new(Vec::new()),
            blocked_apps: std::sync::Mutex::new(Vec::new()),
        }
    }
}

impl NativeEnforcer for MockEnforcer {
    fn apply_blocking(&self, apps: &[AppTarget], domains: &[String]) -> Result<(), EnforcerError> {
        *self.blocked_apps.lock().unwrap() = apps.to_vec();
        *self.blocked_domains.lock().unwrap() = domains.to_vec();
        self.is_active.store(true, Ordering::Relaxed);
        Ok(())
    }

    fn release_blocking(&self) -> Result<(), EnforcerError> {
        self.blocked_apps.lock().unwrap().clear();
        self.blocked_domains.lock().unwrap().clear();
        self.is_active.store(false, Ordering::Relaxed);
        Ok(())
    }

    fn renew_lease(&self) -> Result<(), EnforcerError> { Ok(()) }
}
