Status: pending

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 3: Focus State Machine & Emergency Exit Logic

**Files:**
- Create: `src-tauri/src/focus/state.rs`
- Create: `src-tauri/src/focus/escape.rs`
- Test: `src-tauri/src/focus/state.rs`, `src-tauri/src/focus/escape.rs`

**Interfaces:**
- Produces: `FocusStateMachine`, `FocusStatus`, `FocusPhase`, `EscapeHandler`, `EscapeStatus`
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum FocusStatus {
    Idle,
    Preparing,
    Active,
    Releasing,
    RecoveryRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum FocusPhase {
    Work,
    ShortBreak,
    LongBreak,
}

pub struct FocusSnapshot {
    pub status: FocusStatus,
    pub current_phase: Option<FocusPhase>,
    pub active_profile: Option<FocusProfile>,
    pub current_work_round: u32,
    pub total_work_rounds: u32,
    pub is_locked: bool,
    pub blocking_active: bool,
    pub unblock_during_breaks: bool,
}
```

- [ ] **Step 1: Write failing state machine and emergency hold tests**
```rust
#[test]
fn test_focus_cycle_transitions_and_locking() {
    let profile = sample_profile(2); // 2 work rounds
    let mut sm = FocusStateMachine::new();
    sm.select_profile(Some(profile.clone())).unwrap();
    
    // Start work round 1
    sm.handle_work_started().unwrap();
    assert!(sm.snapshot().is_locked);
    assert!(sm.snapshot().blocking_active);
    assert_eq!(sm.snapshot().current_phase, Some(FocusPhase::Work));
    
    // Attempt to switch profile while active -> must error
    assert!(sm.select_profile(None).is_err());
    
    // Transition to break with unblock_during_breaks = true
    sm.set_unblock_during_breaks(true);
    sm.handle_round_completed(FocusPhase::ShortBreak).unwrap();
    assert!(sm.snapshot().is_locked);
    assert!(!sm.snapshot().blocking_active); // unblocked during break
    
    // Back to work round 2
    sm.handle_round_completed(FocusPhase::Work).unwrap();
    assert!(sm.snapshot().blocking_active); // re-blocked
    
    // Final long break
    sm.handle_round_completed(FocusPhase::LongBreak).unwrap();
    
    // Final completion -> returns to Idle, unblocks, unlocks
    sm.handle_cycle_finished().unwrap();
    assert_eq!(sm.snapshot().status, FocusStatus::Idle);
    assert!(!sm.snapshot().is_locked);
    assert!(!sm.snapshot().blocking_active);
}

#[test]
fn test_emergency_hold_60s() {
    let mut escape = EscapeHandler::new();
    let attempt_id = escape.start_hold();
    // Pulse for 59,500ms
    assert!(!escape.pulse_hold(&attempt_id, 59_500));
    assert!(!escape.is_complete(&attempt_id));
    // Pulse past 60,000ms
    assert!(escape.pulse_hold(&attempt_id, 60_000));
    assert!(escape.is_complete(&attempt_id));
}
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cargo test --manifest-path src-tauri/Cargo.toml focus::state`
Expected: FAIL.

- [ ] **Step 3: Implement state machine and escape handler in `src-tauri/src/focus/`**
- Implement `FocusStateMachine` enforcing the complete Pomodoro cycle count (N work rounds + breaks).
- When in `FocusStatus::Active`, lock session selection and editing.
- Implement `EscapeHandler` with monotonic continuous tracking: pulses must arrive within max 1000ms jitter, total continuous hold >= 60,000ms.
- Implement two-stage passphrase validation: first entry creates a 120s token, second identical entry unlocks.

- [ ] **Step 4: Run tests to verify they pass**
Run: `cargo test --manifest-path src-tauri/Cargo.toml focus::state focus::escape`
Expected: PASS.

- [ ] **Step 5: Commit changes**
`git add src-tauri/src/focus/state.rs src-tauri/src/focus/escape.rs`
`git commit -m "feat(focus): implement focus state machine, locking, and emergency exit logic"`

---

