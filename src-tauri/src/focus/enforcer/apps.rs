#[cfg(any(target_os = "macos", target_os = "windows", test))]
use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
#[cfg(any(target_os = "macos", target_os = "windows", test))]
use std::time::{Duration, Instant};

use super::EnforcerError;
use crate::focus::model::AppTarget;

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct RunningProcess {
    pub pid: u32,
    pub start_id: u64,
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
pub(super) trait ProcessBackend: Send {
    fn snapshot(&mut self) -> Result<Vec<RunningProcess>, EnforcerError>;
    fn request_exit(&mut self, process: &RunningProcess, force: bool) -> Result<(), EnforcerError>;
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Default)]
struct Reconciler {
    pending: HashMap<RunningProcess, (Duration, bool)>,
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
impl Reconciler {
    fn reconcile(&mut self, backend: &mut dyn ProcessBackend, now: Duration) -> Result<bool, EnforcerError> {
        let running = backend.snapshot()?;
        self.pending.retain(|identity, _| running.contains(identity));
        for process in &running {
            match self.pending.get_mut(process) {
                None => {
                    backend.request_exit(process, false)?;
                    self.pending.insert(*process, (now, false));
                }
                Some((first_seen, forced)) => {
                    let elapsed = now.saturating_sub(*first_seen);
                    if *forced && elapsed >= Duration::from_secs(3) {
                        return Err(EnforcerError::ProcessTerminationFailed(
                            "A blocked application did not exit after forced termination.".into(),
                        ));
                    }
                    if !*forced && elapsed >= Duration::from_millis(500) {
                        backend.request_exit(process, true)?;
                        *forced = true;
                    }
                }
            }
        }
        Ok(running.is_empty())
    }
}

pub struct ApplicationMonitor {
    stop_tx: mpsc::Sender<()>,
    error: Arc<Mutex<Option<String>>>,
    worker: Option<JoinHandle<()>>,
}

impl ApplicationMonitor {
    pub fn start(targets: Vec<AppTarget>) -> Result<Self, EnforcerError> {
        #[cfg(target_os = "macos")]
        let backend = super::macos::ApplicationBackend::new(targets)?;
        #[cfg(target_os = "windows")]
        let backend = super::windows::ApplicationBackend::new(targets)?;
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = targets;
            Err(EnforcerError::PlatformUnsupported)
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        Self::start_backend(Box::new(backend))
    }

    #[cfg(any(target_os = "macos", target_os = "windows", test))]
    fn start_backend(mut backend: Box<dyn ProcessBackend>) -> Result<Self, EnforcerError> {
        let (stop_tx, stop_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let error = Arc::new(Mutex::new(None));
        let error_worker = Arc::clone(&error);
        let worker = std::thread::Builder::new().name("focus-apps".into()).spawn(move || {
            let start = Instant::now();
            let mut policy = Reconciler::default();
            let mut ready = Some(ready_tx);
            let mut failure_since = None;
            loop {
                match policy.reconcile(backend.as_mut(), start.elapsed()) {
                    Ok(true) => {
                        failure_since = None;
                        if let Some(sender) = ready.take() { let _ = sender.send(()); }
                    }
                    Ok(false) => { failure_since = None; }
                    Err(error) => {
                        if ready.is_some() || failure_since.get_or_insert_with(Instant::now).elapsed() >= Duration::from_secs(2) {
                            *error_worker.lock().unwrap() = Some(error.to_string());
                            break;
                        }
                        log::warn!("[apps] retrying process reconciliation: {error}");
                    }
                }
                match stop_rx.recv_timeout(Duration::from_millis(250)) {
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    _ => break,
                }
            }
        }).map_err(|e| EnforcerError::ProcessTerminationFailed(e.to_string()))?;
        let mut monitor = Self { stop_tx, error, worker: Some(worker) };
        if ready_rx.recv_timeout(Duration::from_secs(4)).is_err() {
            let message = monitor.error.lock().unwrap().clone()
                .unwrap_or_else(|| "Timed out waiting for blocked applications to exit.".into());
            monitor.shutdown();
            return Err(EnforcerError::ProcessTerminationFailed(message));
        }
        Ok(monitor)
    }

    pub fn health(&self) -> Result<(), EnforcerError> {
        if let Some(error) = self.error.lock().unwrap().as_ref() {
            return Err(EnforcerError::ProcessTerminationFailed(error.clone()));
        }
        if self.worker.as_ref().map(|worker| worker.is_finished()).unwrap_or(true) {
            return Err(EnforcerError::ProcessTerminationFailed("Application monitor stopped.".into()));
        }
        Ok(())
    }

    pub fn stop(mut self) -> Result<(), EnforcerError> {
        self.shutdown();
        if let Some(error) = self.error.lock().unwrap().as_ref() {
            return Err(EnforcerError::ProcessTerminationFailed(error.clone()));
        }
        Ok(())
    }

    fn shutdown(&mut self) {
        let _ = self.stop_tx.send(());
        if let Some(worker) = self.worker.take() {
            if worker.join().is_err() {
                *self.error.lock().unwrap() = Some("Application monitor panicked.".into());
            }
        }
    }
}

impl Drop for ApplicationMonitor {
    fn drop(&mut self) { self.shutdown(); }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn application_monitor_rejects_unsupported_platform() {
        assert!(matches!(ApplicationMonitor::start(Vec::new()), Err(EnforcerError::PlatformUnsupported)));
    }

    #[derive(Default)]
    struct Processes {
        running: Vec<RunningProcess>,
        requests: Vec<(u32, u64, bool)>,
        deny: bool,
    }
    impl ProcessBackend for Processes {
        fn snapshot(&mut self) -> Result<Vec<RunningProcess>, EnforcerError> {
            Ok(self.running.clone())
        }
        fn request_exit(&mut self, process: &RunningProcess, force: bool) -> Result<(), EnforcerError> {
            if self.deny { return Err(EnforcerError::ProcessTerminationFailed("denied".into())); }
            self.requests.push((process.pid, process.start_id, force));
            Ok(())
        }
    }
    fn process(pid: u32, start_id: u64) -> RunningProcess {
        RunningProcess { pid, start_id }
    }
    #[test]
    fn relaunch_is_terminated_on_each_pass() {
        let mut backend = Processes { running: vec![process(42, 1)], ..Default::default() };
        let mut policy = Reconciler::default();
        policy.reconcile(&mut backend, Duration::ZERO).unwrap();
        backend.running.clear();
        policy.reconcile(&mut backend, Duration::from_millis(250)).unwrap();
        backend.running.push(process(43, 2));
        policy.reconcile(&mut backend, Duration::from_millis(500)).unwrap();
        assert_eq!(backend.requests, [(42, 1, false), (43, 2, false)]);
    }
    #[test]
    fn force_only_after_grace_period() {
        let mut backend = Processes { running: vec![process(42, 1)], ..Default::default() };
        let mut policy = Reconciler::default();
        policy.reconcile(&mut backend, Duration::ZERO).unwrap();
        policy.reconcile(&mut backend, Duration::from_millis(499)).unwrap();
        assert_eq!(backend.requests, [(42, 1, false)]);
        policy.reconcile(&mut backend, Duration::from_millis(500)).unwrap();
        assert_eq!(backend.requests, [(42, 1, false), (42, 1, true)]);
    }
    #[test]
    fn pid_reuse_does_not_inherit_force_request() {
        let mut backend = Processes { running: vec![process(42, 1)], ..Default::default() };
        let mut policy = Reconciler::default();
        policy.reconcile(&mut backend, Duration::ZERO).unwrap();
        backend.running = vec![process(42, 2)];
        policy.reconcile(&mut backend, Duration::from_millis(750)).unwrap();
        assert_eq!(backend.requests, [(42, 1, false), (42, 2, false)]);
    }
    #[test]
    fn termination_denial_is_reported() {
        let mut backend = Processes { running: vec![process(42, 1)], deny: true, ..Default::default() };
        assert!(Reconciler::default().reconcile(&mut backend, Duration::ZERO).is_err());
    }
    #[test]
    fn surviving_forced_termination_is_not_reported_as_success() {
        let mut backend = Processes { running: vec![process(42, 1)], ..Default::default() };
        let mut policy = Reconciler::default();
        policy.reconcile(&mut backend, Duration::ZERO).unwrap();
        policy.reconcile(&mut backend, Duration::from_millis(500)).unwrap();
        assert!(policy.reconcile(&mut backend, Duration::from_secs(3)).is_err());
    }

    #[test]
    fn stop_prevents_future_termination() {
        struct Inventory(Arc<Mutex<Vec<RunningProcess>>>);
        impl ProcessBackend for Inventory {
            fn snapshot(&mut self) -> Result<Vec<RunningProcess>, EnforcerError> {
                Ok(self.0.lock().unwrap().clone())
            }
            fn request_exit(&mut self, process: &RunningProcess, _: bool) -> Result<(), EnforcerError> {
                self.0.lock().unwrap().retain(|entry| entry != process);
                Ok(())
            }
        }
        let inventory = Arc::new(Mutex::new(vec![process(42, 1)]));
        let monitor = ApplicationMonitor::start_backend(Box::new(Inventory(inventory.clone()))).unwrap();
        assert!(inventory.lock().unwrap().is_empty());
        monitor.stop().unwrap();
        inventory.lock().unwrap().push(process(43, 2));
        assert_eq!(*inventory.lock().unwrap(), [process(43, 2)]);
    }

    #[test]
    fn monitor_retries_transient_failure_and_terminates_relaunches() {
        struct Inventory(Arc<Mutex<(Vec<RunningProcess>, bool)>>);
        impl ProcessBackend for Inventory {
            fn snapshot(&mut self) -> Result<Vec<RunningProcess>, EnforcerError> {
                Ok(self.0.lock().unwrap().0.clone())
            }
            fn request_exit(&mut self, process: &RunningProcess, _: bool) -> Result<(), EnforcerError> {
                let mut state = self.0.lock().unwrap();
                if state.1 {
                    state.1 = false;
                    return Err(EnforcerError::ProcessTerminationFailed("transient".into()));
                }
                state.0.retain(|entry| entry != process);
                Ok(())
            }
        }
        let inventory = Arc::new(Mutex::new((Vec::new(), true)));
        let monitor = ApplicationMonitor::start_backend(Box::new(Inventory(inventory.clone()))).unwrap();
        for pid in 1..=5 {
            inventory.lock().unwrap().0.push(process(pid, pid as u64));
            let deadline = Instant::now() + Duration::from_secs(2);
            while !inventory.lock().unwrap().0.is_empty() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(20));
            }
            assert!(inventory.lock().unwrap().0.is_empty(), "relaunch {pid} remained running");
        }
        assert!(monitor.health().is_ok());
        monitor.stop().unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_foreign_platform_and_self_targets() {
        for (identifier, platform) in [("discord.exe", "windows"), ("com.splode.pomotroid", "macos"), ("Discord", "all")] {
            let target = AppTarget {
                id: "test".into(), name: "Test".into(), identifier: identifier.into(), platform: platform.into(),
            };
            assert!(matches!(ApplicationMonitor::start(vec![target]), Err(EnforcerError::InvalidTarget(_))));
        }
    }
}
