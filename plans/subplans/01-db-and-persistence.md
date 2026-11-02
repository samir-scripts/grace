Status: completed

Verification Evidence:
- Tests passed: `test focus::repository::tests::test_migration_7_and_profile_crud ... ok`
- Tests passed: `test focus::repository::tests::test_preferences_and_journal_persistence ... ok`
- Tests passed: `test db::migrations::tests::migration_is_idempotent ... ok`
- Tests passed: `test db::migrations::tests::all_tables_created ... ok`

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 1: Database Schema & Migration 7 for Focus Profiles

**Files:**
- Modify: `src-tauri/src/db/migrations.rs:80-140`
- Create: `src-tauri/src/focus/model.rs`
- Create: `src-tauri/src/focus/repository.rs`
- Test: `src-tauri/src/focus/repository.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces: `FocusProfile`, `AppTarget`, `FocusPreferences`, `FocusRepository`
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppTarget {
    pub id: String, // uuid
    pub name: String,
    pub identifier: String, // bundle_id (macOS) or executable name/path (Windows)
    pub platform: String,   // "macos" | "windows" | "all"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FocusProfile {
    pub id: String,
    pub name: String,
    pub work_secs: u32,
    pub short_break_secs: u32,
    pub long_break_secs: u32,
    pub work_rounds: u32,
    pub blocked_apps: Vec<AppTarget>,
    pub blocked_domains: Vec<String>,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FocusPreferences {
    pub selected_profile_id: Option<String>,
    pub unblock_during_breaks: bool,
    pub emergency_passphrase_hash: Option<String>,
}
```

- [ ] **Step 1: Write failing migration and repository tests in `src-tauri/src/focus/repository.rs`**
```rust
#[test]
fn test_migration_7_and_profile_crud() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::db::migrations::run(&conn).unwrap();
    
    let repo = FocusRepository::new();
    let profile = FocusProfile {
        id: "test-uuid-1".to_string(),
        name: "Deep Work".to_string(),
        work_secs: 1500,
        short_break_secs: 300,
        long_break_secs: 900,
        work_rounds: 4,
        blocked_apps: vec![AppTarget {
            id: "app-1".to_string(),
            name: "Discord".to_string(),
            identifier: "com.hnc.Discord".to_string(),
            platform: "macos".to_string(),
        }],
        blocked_domains: vec!["reddit.com".to_string(), "youtube.com".to_string()],
        revision: 1,
    };
    
    repo.save_profile(&conn, &profile).unwrap();
    let loaded = repo.get_profile(&conn, "test-uuid-1").unwrap().unwrap();
    assert_eq!(loaded, profile);
}
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cargo test --manifest-path src-tauri/Cargo.toml test_migration_7_and_profile_crud`
Expected: FAIL with missing module or migration error.

- [ ] **Step 3: Implement Migration 7 in `src-tauri/src/db/migrations.rs` and repository methods**
Add `MIGRATION_7` creating:
1. `focus_profiles` (`id TEXT PRIMARY KEY`, `name TEXT NOT NULL`, `work_secs INTEGER`, `short_break_secs INTEGER`, `long_break_secs INTEGER`, `work_rounds INTEGER`, `blocked_apps_json TEXT`, `blocked_domains_json TEXT`, `revision INTEGER NOT NULL`)
2. `focus_preferences` (`id INTEGER PRIMARY KEY CHECK (id = 1)`, `selected_profile_id TEXT`, `unblock_during_breaks INTEGER DEFAULT 0`, `emergency_passphrase_hash TEXT`)
3. `focus_run_journal` (`run_id TEXT PRIMARY KEY`, `profile_snapshot_json TEXT NOT NULL`, `phase TEXT NOT NULL`, `current_round INTEGER NOT NULL`, `started_at INTEGER NOT NULL`, `lease_expires_at INTEGER NOT NULL`)
Increment schema version check to 7. Implement `FocusRepository` in `src-tauri/src/focus/repository.rs`.

- [ ] **Step 4: Run test to verify it passes**
Run: `cargo test --manifest-path src-tauri/Cargo.toml test_migration_7_and_profile_crud`
Expected: PASS.

- [ ] **Step 5: Commit changes**
`git add src-tauri/src/db/migrations.rs src-tauri/src/focus/`
`git commit -m "feat(db): add migration 7 for focus profiles, preferences, and run journal"`

---

