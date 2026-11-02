use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub struct WatchdogLease {
    last_heartbeat: Arc<Mutex<Instant>>,
    lease_duration: Duration,
    is_active: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
}

impl WatchdogLease {
    pub fn new<F>(lease_duration: Duration, on_expire: F) -> Self
    where
        F: Fn() + Send + Sync + 'static,
    {
        let last_heartbeat = Arc::new(Mutex::new(Instant::now()));
        let is_active = Arc::new(AtomicBool::new(false));
        let shutdown = Arc::new(AtomicBool::new(false));

        let hb_clone = Arc::clone(&last_heartbeat);
        let active_clone = Arc::clone(&is_active);
        let shutdown_clone = Arc::clone(&shutdown);

        let thread_handle = std::thread::Builder::new()
            .name("focus-watchdog".to_string())
            .spawn(move || {
                let check_interval = Duration::from_millis(100);
                while !shutdown_clone.load(Ordering::Relaxed) {
                    std::thread::sleep(check_interval);

                    if active_clone.load(Ordering::Relaxed) {
                        let elapsed = {
                            let guard = hb_clone.lock().unwrap();
                            Instant::now().duration_since(*guard)
                        };

                        if elapsed > lease_duration {
                            log::warn!(
                                "[watchdog] lease expired (elapsed={elapsed:?}, lease={lease_duration:?}). Executing automatic cleanup callback."
                            );
                            active_clone.store(false, Ordering::Relaxed);
                            on_expire();
                        }
                    }
                }
            })
            .expect("failed to spawn focus watchdog thread");

        Self {
            last_heartbeat,
            lease_duration,
            is_active,
            shutdown,
            thread_handle: Some(thread_handle),
        }
    }

    pub fn arm(&self) {
        let mut guard = self.last_heartbeat.lock().unwrap();
        *guard = Instant::now();
        self.is_active.store(true, Ordering::Relaxed);
    }

    pub fn disarm(&self) {
        self.is_active.store(false, Ordering::Relaxed);
    }

    pub fn renew(&self) {
        let mut guard = self.last_heartbeat.lock().unwrap();
        *guard = Instant::now();
    }

    pub fn is_armed(&self) -> bool {
        self.is_active.load(Ordering::Relaxed)
    }

    pub fn has_expired(&self) -> bool {
        if !self.is_armed() {
            return false;
        }
        let guard = self.last_heartbeat.lock().unwrap();
        Instant::now().duration_since(*guard) > self.lease_duration
    }
}

impl Drop for WatchdogLease {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_watchdog_lease_expiration_and_recovery() {
        let expired_called = Arc::new(AtomicBool::new(false));
        let flag_clone = Arc::clone(&expired_called);

        let watchdog = WatchdogLease::new(Duration::from_millis(150), move || {
            flag_clone.store(true, Ordering::Relaxed);
        });

        // Initially disarmed
        assert!(!watchdog.is_armed());
        std::thread::sleep(Duration::from_millis(200));
        assert!(!expired_called.load(Ordering::Relaxed));

        // Arm and renew
        watchdog.arm();
        assert!(watchdog.is_armed());
        std::thread::sleep(Duration::from_millis(80));
        watchdog.renew();
        std::thread::sleep(Duration::from_millis(80));
        assert!(!expired_called.load(Ordering::Relaxed));

        // Allow to expire
        std::thread::sleep(Duration::from_millis(200));
        assert!(expired_called.load(Ordering::Relaxed));
        assert!(!watchdog.is_armed());
    }
}
