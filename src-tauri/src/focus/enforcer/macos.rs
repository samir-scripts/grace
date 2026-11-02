use std::process::Command;
use crate::focus::model::AppTarget;
use super::EnforcerError;

pub struct MacOSEnforcer;

impl MacOSEnforcer {
    pub fn new() -> Self {
        Self
    }

    pub fn terminate_matching_apps(&self, targets: &[AppTarget]) -> Result<usize, EnforcerError> {
        let mut terminated_count = 0;
        for target in targets {
            let identifier = target.identifier.trim();
            if identifier.is_empty() {
                continue;
            }

            // On macOS: target by bundle id or process name using pkill / killall
            // Safe termination: first SIGTERM, then pkill
            let output = Command::new("pkill")
                .arg("-f")
                .arg(identifier)
                .output();

            if let Ok(out) = output {
                if out.status.success() {
                    terminated_count += 1;
                    log::info!("[macos-enforcer] terminated app matching: {identifier}");
                }
            }
        }
        Ok(terminated_count)
    }

    pub fn flush_dns(&self) -> Result<(), EnforcerError> {
        // macOS DNS flush
        let _ = Command::new("dscacheutil").arg("-flushcache").output();
        let _ = Command::new("killall").arg("-HUP").arg("mDNSResponder").output();
        Ok(())
    }
}
