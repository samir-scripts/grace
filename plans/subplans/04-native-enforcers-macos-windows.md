Status: pending

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 4: Native Enforcers (macOS & Windows) & Crash Recovery Watchdog

**Files:**
- Create: `src-tauri/src/focus/enforcer/mod.rs`
- Create: `src-tauri/src/focus/enforcer/macos.rs`
- Create: `src-tauri/src/focus/enforcer/windows.rs`
- Create: `src-tauri/src/focus/enforcer/hosts.rs`
- Create: `src-tauri/src/focus/enforcer/watchdog.rs`
- Test: `src-tauri/src/focus/enforcer/hosts.rs`, `src-tauri/src/focus/enforcer/watchdog.rs`

**Interfaces:**
- Produces: `NativeEnforcer` trait, `WatchdogLease`
```rust
pub trait NativeEnforcer: Send + Sync {
    fn apply_blocking(&self, apps: &[AppTarget], domains: &[String]) -> Result<(), EnforcerError>;
    fn release_blocking(&self) -> Result<(), EnforcerError>;
    fn is_authorized(&self) -> bool;
    fn request_authorization(&self) -> Result<(), EnforcerError>;
}
```

- [ ] **Step 1: Write failing tests for hosts manager and watchdog recovery**
```rust
#[test]
fn test_hosts_block_injection_and_clean_removal() {
    let original = "127.0.0.1 localhost\n::1 localhost\n";
    let domains = vec!["reddit.com".to_string(), "discord.com".to_string()];
    let blocked = inject_hosts_block(original, &domains);
    assert!(blocked.contains("# BEGIN POMOTROID BLOCK"));
    assert!(blocked.contains("127.0.0.1 reddit.com"));
    assert!(blocked.contains("127.0.0.1 discord.com"));
    
    let cleaned = remove_hosts_block(&blocked);
    assert_eq!(cleaned, original);
}

#[test]
fn test_watchdog_lease_expiration() {
    let mut watchdog = WatchdogLease::new(Duration::from_millis(100));
    watchdog.renew();
    assert!(!watchdog.has_expired());
    std::thread::sleep(Duration::from_millis(150));
    assert!(watchdog.has_expired());
}
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cargo test --manifest-path src-tauri/Cargo.toml focus::enforcer`
Expected: FAIL.

- [ ] **Step 3: Implement cross-platform native enforcer and safety watchdog**
In `src-tauri/src/focus/enforcer/`:
- `hosts.rs`: atomic write of tagged block `# BEGIN POMOTROID BLOCK ... # END POMOTROID BLOCK` into system hosts path.
- `macos.rs`:
  - Apps: `NSWorkspace.shared.runningApplications` enumeration; terminate matching `bundle_id` or `bundle_path`.
  - DNS: Trigger `dscacheutil -flushcache` and `killall -HUP mDNSResponder`.
- `windows.rs`:
  - Apps: Process snapshot via `CreateToolhelp32Snapshot`, match executable path, terminate matching processes via `TerminateProcess`.
  - DNS: Invoke `DnsFlushResolverCache`.
- `watchdog.rs`: 15s lease timer; background thread runs cleanup callback if heartbeats stop for >15s.

- [ ] **Step 4: Run tests to verify they pass**
Run: `cargo test --manifest-path src-tauri/Cargo.toml focus::enforcer`
Expected: PASS.

- [ ] **Step 5: Commit changes**
`git add src-tauri/src/focus/enforcer/`
`git commit -m "feat(focus): add native process and domain enforcers with watchdog recovery"`

---

