use std::process::Command;
use crate::focus::model::AppTarget;
use super::EnforcerError;

pub struct MacOSEnforcer;

impl MacOSEnforcer {
    pub fn new() -> Self {
        Self
    }

    pub fn terminate_matching_apps(&self, targets: &[AppTarget]) -> Result<usize, EnforcerError> {
        #[cfg(target_os = "macos")]
        {
            use objc2::rc::autoreleasepool;
            use objc2_app_kit::NSRunningApplication;
            use objc2_foundation::NSString;

            // Bundle identifiers are not process command-line substrings. Resolve running
            // applications natively so catalog selections target the actual application.
            autoreleasepool(|_| {
                let mut terminated_count = 0;
                for target in targets {
                    if target.identifier.trim().is_empty() || target.platform == "windows" {
                        continue;
                    }
                    let running = NSRunningApplication::runningApplicationsWithBundleIdentifier(
                        &NSString::from_str(target.identifier.trim()),
                    );
                    for application in running.iter() {
                        if application.terminate() {
                            terminated_count += 1;
                            log::info!("[macos-enforcer] requested termination: {}", target.identifier);
                        }
                    }
                }
                Ok(terminated_count)
            })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = targets;
            Err(EnforcerError::PlatformUnsupported)
        }
    }

    pub fn flush_dns(&self) -> Result<(), EnforcerError> {
        // macOS DNS flush
        let _ = Command::new("dscacheutil").arg("-flushcache").output();
        let _ = Command::new("killall").arg("-HUP").arg("mDNSResponder").output();
        Ok(())
    }
}
