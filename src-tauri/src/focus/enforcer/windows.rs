use std::process::Command;
use crate::focus::model::AppTarget;
use super::EnforcerError;

pub struct WindowsEnforcer;

impl WindowsEnforcer {
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

            let output = Command::new("taskkill")
                .args(["/F", "/IM", identifier])
                .output();

            if let Ok(out) = output {
                if out.status.success() {
                    terminated_count += 1;
                    log::info!("[windows-enforcer] terminated process: {identifier}");
                }
            }
        }
        Ok(terminated_count)
    }

    pub fn flush_dns(&self) -> Result<(), EnforcerError> {
        let _ = Command::new("ipconfig").arg("/flushdns").output();
        Ok(())
    }
}
