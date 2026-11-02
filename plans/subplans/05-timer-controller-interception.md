Status: pending

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 5: Timer Integration & Control Interception Barrier

**Files:**
- Create: `src-tauri/src/focus/controller.rs`
- Modify: `src-tauri/src/timer/mod.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/focus/controller.rs`

**Interfaces:**
- Produces: `FocusController` registered as Tauri managed state in `src-tauri/src/lib.rs`.
- Enforces: Intercepts `timer_toggle`, `timer_reset`, `timer_skip`, `timer_restart_round`, `settings_set`.

- [ ] **Step 1: Write integration tests verifying timer commands respect active focus runs**
```rust
#[test]
fn test_timer_reset_blocked_during_active_focus() {
    let (controller, timer) = setup_test_focus_timer();
    controller.select_profile("profile-1").unwrap();
    
    // Start work
    timer.toggle(); // transitions to work
    assert!(controller.is_active());
    
    // Timer reset must not silently kill active focus session
    let res = controller.check_timer_command(TimerAction::Reset);
    assert!(res.is_err());
    
    // Restart round is permitted
    assert!(controller.check_timer_command(TimerAction::RestartRound).is_ok());
}
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cargo test --manifest-path src-tauri/Cargo.toml focus::controller`
Expected: FAIL.

- [ ] **Step 3: Implement `FocusController` and connect into `listen_events` in `src-tauri/src/timer/mod.rs`**
In `src-tauri/src/timer/mod.rs`:
- On `TimerEvent::Started`: If `current_round == RoundType::Work` and a focus profile is selected, activate native blocking BEFORE first second ticks.
- On `TimerEvent::Complete`: Advance focus cycle state. If next round is a break and `unblock_during_breaks` is true, call `enforcer.release_blocking()`.
- On final round completion: Call `enforcer.release_blocking()`, clear run journal, transition to `Idle`, emit `focus:changed`.
- In `src-tauri/src/commands.rs`: Reject `timer_reset`, `timer_skip`, and session switching commands when `FocusController` reports an active run.

- [ ] **Step 4: Run tests to verify they pass**
Run: `cargo test --manifest-path src-tauri/Cargo.toml focus::controller`
Expected: PASS.

- [ ] **Step 5: Commit changes**
`git add src-tauri/src/focus/controller.rs src-tauri/src/timer/mod.rs src-tauri/src/commands.rs src-tauri/src/lib.rs`
`git commit -m "feat(focus): wire focus controller into timer event loop and intercept control actions"`

---

