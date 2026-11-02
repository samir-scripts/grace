pub mod hosts;
pub mod macos;
pub mod watchdog;
pub mod windows;

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::focus::model::AppTarget;
use hosts::{apply_hosts_file, default_hosts_path, revert_hosts_file};
use watchdog::WatchdogLease;

#[derive(Debug, PartialEq, Eq)]
pub enum EnforcerError {
    NotAuthorized,
    HostsFileError(String),
    ProcessTerminationFailed(String),
    PlatformUnsupported,
}

impl fmt::Display for EnforcerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAuthorized => write!(f, "Focus enforcement is not authorized by the operating system"),
            Self::HostsFileError(e) => write!(f, "Failed to modify hosts file: {e}"),
            Self::ProcessTerminationFailed(e) => write!(f, "Failed to terminate blocked application: {e}"),
            Self::PlatformUnsupported => write!(f, "Platform is not supported for native enforcement"),
        }
    }
}

impl std::error::Error for EnforcerError {}

pub trait NativeEnforcer: Send + Sync {
    fn apply_blocking(&self, apps: &[AppTarget], domains: &[String]) -> Result<(), EnforcerError>;
    fn release_blocking(&self) -> Result<(), EnforcerError>;
    fn is_authorized(&self) -> bool;
    fn request_authorization(&self) -> Result<(), EnforcerError>;
    fn renew_lease(&self);
}

pub struct SystemEnforcer {
    watchdog: WatchdogLease,
    is_active: Arc<AtomicBool>,
}

impl SystemEnforcer {
    pub fn new() -> Self {
        let is_active = Arc::new(AtomicBool::new(false));
        let active_flag = Arc::clone(&is_active);

        // Crash recovery watchdog: 15 second lease, releases hosts file if heartbeat ceases
        let watchdog = WatchdogLease::new(Duration::from_secs(15), move || {
            log::warn!("[enforcer] Watchdog lease expired. Reverting hosts file.");
            let hosts_path = default_hosts_path();
            let _ = revert_hosts_file(&hosts_path);
            active_flag.store(false, Ordering::Relaxed);
        });

        Self {
            watchdog,
            is_active,
        }
    }
}

impl NativeEnforcer for SystemEnforcer {
    fn apply_blocking(&self, apps: &[AppTarget], domains: &[String]) -> Result<(), EnforcerError> {
        // 1. Arm watchdog lease first
        self.watchdog.arm();

        // 2. Terminate matching apps
        #[cfg(target_os = "macos")]
        {
            let enforcer = macos::MacOSEnforcer::new();
            let _ = enforcer.terminate_matching_apps(apps);
        }
        #[cfg(target_os = "windows")]
        {
            let enforcer = windows::WindowsEnforcer::new();
            let _ = enforcer.terminate_matching_apps(apps);
        }

        // 3. Apply hosts file modifications if domains present
        if !domains.is_empty() {
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

        self.is_active.store(true, Ordering::Relaxed);
        Ok(())
    }

    fn release_blocking(&self) -> Result<(), EnforcerError> {
        // Disarm watchdog
        self.watchdog.disarm();

        // Revert hosts file
        let hosts_path = default_hosts_path();
        let _ = revert_hosts_file(&hosts_path);

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

        self.is_active.store(false, Ordering::Relaxed);
        Ok(())
    }

    fn is_authorized(&self) -> bool {
        // Checks if hosts file is writable
        let hosts_path = default_hosts_path();
        if let Ok(metadata) = std::fs::metadata(&hosts_path) {
            !metadata.permissions().readonly()
        } else {
            false
        }
    }

    fn request_authorization(&self) -> Result<(), EnforcerError> {
        Ok(())
    }

    fn renew_lease(&self) {
        self.watchdog.renew();
    }
}

/// In-memory mock enforcer for test isolation and platforms without root access
pub struct MockEnforcer {
    pub is_active: AtomicBool,
    pub blocked_domains: std::sync::Mutex<Vec<String>>,
    pub blocked_apps: std::sync::Mutex<Vec<AppTarget>>,
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

    fn is_authorized(&self) -> bool {
        true
    }

    fn request_authorization(&self) -> Result<(), EnforcerError> {
        Ok(())
    }

    fn renew_lease(&self) {}
}
