use std::process::Command;
use crate::focus::model::AppTarget;
use super::EnforcerError;

pub struct MacOSEnforcer;

impl MacOSEnforcer {
    pub fn new() -> Self {
        Self
    }


    pub fn flush_dns(&self) -> Result<(), EnforcerError> {
        // macOS DNS flush
        let _ = Command::new("dscacheutil").arg("-flushcache").output();
        let _ = Command::new("killall").arg("-HUP").arg("mDNSResponder").output();
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub(super) struct ApplicationBackend {
    bundle_ids: Vec<String>,
}

#[cfg(target_os = "macos")]
impl ApplicationBackend {
    pub(super) fn new(targets: Vec<AppTarget>) -> Result<Self, EnforcerError> {
        // Never allow a root-launched GUI to terminate other users' applications.
        if unsafe { libc::geteuid() } == 0 {
            return Err(EnforcerError::NotAuthorized);
        }
        let mut bundle_ids = Vec::with_capacity(targets.len());
        for target in targets {
            let id = target.identifier.trim();
            if !matches!(target.platform.as_str(), "macos" | "all")
                || id == "com.splode.pomotroid"
                || !id.contains('.')
                || id.split('.').any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
            {
                return Err(EnforcerError::InvalidTarget(target.name));
            }
            if !bundle_ids.iter().any(|existing| existing == id) {
                bundle_ids.push(id.to_owned());
            }
        }
        Ok(Self { bundle_ids })
    }
}

#[cfg(target_os = "macos")]
fn process_identity(pid: i32) -> Result<Option<super::apps::RunningProcess>, EnforcerError> {
    if pid <= 0 || pid as u32 == std::process::id() {
        return Ok(None);
    }
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::uninit();
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    // SAFETY: buffer is correctly aligned and sized; the OS initializes it on a full read.
    let count = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, info.as_mut_ptr().cast(), size) };
    if count != size {
        let error = std::io::Error::last_os_error();
        if matches!(error.raw_os_error(), Some(libc::ESRCH | libc::ENOENT)) {
            return Ok(None);
        }
        return Err(EnforcerError::ProcessTerminationFailed(error.to_string()));
    }
    let info = unsafe { info.assume_init() };
    if info.pbi_uid != unsafe { libc::geteuid() } || info.pbi_ruid != unsafe { libc::getuid() } {
        return Ok(None);
    }
    Ok(Some(super::apps::RunningProcess {
        pid: pid as u32,
        start_id: info.pbi_start_tvsec * 1_000_000 + info.pbi_start_tvusec,
    }))
}

#[cfg(target_os = "macos")]
impl super::apps::ProcessBackend for ApplicationBackend {
    fn snapshot(&mut self) -> Result<Vec<super::apps::RunningProcess>, EnforcerError> {
        use objc2::rc::autoreleasepool;
        use objc2_app_kit::NSRunningApplication;
        use objc2_foundation::NSString;
        autoreleasepool(|_| {
            let mut processes = Vec::new();
            for id in &self.bundle_ids {
                for app in NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(id)).iter() {
                    if !app.isTerminated() {
                        if let Some(identity) = process_identity(app.processIdentifier())? {
                            processes.push(identity);
                        }
                    }
                }
            }
            Ok(processes)
        })
    }

    fn request_exit(&mut self, process: &super::apps::RunningProcess, force: bool) -> Result<(), EnforcerError> {
        use objc2::rc::autoreleasepool;
        use objc2_app_kit::NSRunningApplication;
        use objc2_foundation::NSString;
        autoreleasepool(|_| {
            for id in &self.bundle_ids {
                for app in NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(id)).iter() {
                    if app.processIdentifier() as u32 != process.pid || app.isTerminated() {
                        continue;
                    }
                    if process_identity(app.processIdentifier())?.as_ref() != Some(process) {
                        return Ok(());
                    }
                    // The retained NSRunningApplication identifies this launch, not a later PID reuse.
                    let accepted = if force { app.forceTerminate() } else { app.terminate() };
                    if force && !accepted && !app.isTerminated() {
                        return Err(EnforcerError::ProcessTerminationFailed("The OS refused application termination.".into()));
                    }
                    return Ok(());
                }
            }
            Ok(())
        })
    }
}
