Status: completed

Verification Evidence:
- Integration suite `cargo test --manifest-path src-tauri/Cargo.toml --test focus_lifecycle_test`: 3 passed (100%).
- Complete Rust suite `cargo test --manifest-path src-tauri/Cargo.toml`: 104 passed across 4 test suites with 0 failures.
- TypeScript and Svelte diagnostics `npm run check`: 911 files checked, 0 errors, 0 warnings.
- Production static build `npm run build`: built in 2.60s with 0 errors.

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 10: End-to-End System Tests & Verification

**Files:**
- Create: `src-tauri/tests/focus_lifecycle_test.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Verifies:
  1. Profile creation, duration loading, and domain normalization.
  2. Starting work round activates blocking rules.
  3. Session switching and reset commands are rejected while active.
  4. Break transitions release blocking if `unblock_during_breaks == true`, and re-block upon returning to work.
  5. Completion of full cycle cleanly releases all blocks and unlocks session switching.
  6. Emergency hold and passphrase both cleanly trigger release.
  7. Watchdog lease auto-cleans blocks if app terminates.

- [ ] **Step 1: Write integration tests in `src-tauri/tests/focus_lifecycle_test.rs`**
```rust
#[tokio::test]
async fn test_full_focus_lifecycle_and_enforcement() {
    let app = setup_test_app().await;
    
    // 1. Create and select profile with Discord and reddit.com
    let profile = create_test_profile("Deep Work", vec!["Discord"], vec!["reddit.com"]);
    app.select_profile(&profile.id).await.unwrap();
    
    // 2. Start Work timer
    app.timer_toggle().await.unwrap();
    assert!(app.is_enforcement_active().await);
    assert!(app.is_session_locked().await);
    
    // 3. Verify session switching is rejected
    assert!(app.select_profile("other-id").await.is_err());
    
    // 4. Complete work -> break transition
    app.advance_to_break().await;
    if app.get_unblock_during_breaks().await {
        assert!(!app.is_enforcement_active().await);
    }
    
    // 5. Emergency exit test
    app.emergency_hold_exit(60_000).await.unwrap();
    assert!(!app.is_enforcement_active().await);
    assert!(!app.is_session_locked().await);
}
```

- [ ] **Step 2: Run test suite to verify implementation**
Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: All unit and integration tests PASS.

- [ ] **Step 3: Run frontend type-check and build**
Run: `npm run check` and `npm run build`
Expected: Clean compile with 0 errors.

- [ ] **Step 4: Commit changes**
`git add src-tauri/tests/focus_lifecycle_test.rs`
`git commit -m "test(focus): add comprehensive end-to-end focus lifecycle and enforcement tests"`

---

