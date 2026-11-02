# Focus Sessions and Distraction Blocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete Focus Sessions feature with customizable Pomodoro durations, application and website distraction blocking (system-wide on macOS and Windows), break-unblocking toggle, session locking during active rounds, and a deliberate two-way emergency exit (60-second hold or 30+ character passphrase).

**Architecture:** Rust backend (`src-tauri/src/focus/`) acts as the single source of truth for session profiles, validation, state machine transitions, and enforcement orchestration. An isolated native helper architecture enforces application and system-wide domain blocks with lease-based crash watchdog auto-recovery. The Svelte 5 frontend interacts exclusively through typed IPC wrappers (`src/lib/ipc/index.ts`), rendering a centered session selector in the titlebar, a dedicated Sessions configuration section in Settings, and an accessible Emergency Exit dialog.

**Tech Stack:** Tauri 2, Rust (rusqlite, tokio, argon2, idna), SvelteKit + Svelte 5 (runes `$state`, `$derived`), TypeScript, Paraglide JS i18n, macOS (`SMAppService`, `NSWorkspace`, `/etc/hosts` + DNS flush), Windows (Service / UAC elevation, `C:\Windows\System32\drivers\etc\hosts` + `DnsFlushResolverCache`, `TerminateProcess`).

**Spec:** User requirements from prompt and confirmed decisions:
- Named configurable "Sessions" storing custom work, short break, and long break durations, work round count, and lists of blocked applications and websites.
- Top-center dropdown in titlebar allowing user to select a session.
- Configurable in Settings (add, edit, delete sessions, configure blocked apps/sites).
- Starting the work timer triggers enforcement of blocked apps and websites.
- Option in Settings to temporarily unblock apps and websites during break timers (`unblock_during_breaks`).
- Session switching is strictly locked while a session is active.
- Session lifetime lasts for one full Pomodoro cycle (N work rounds + breaks) then automatically completes and unblocks.
- Deliberate emergency exit: holding a button or Spacebar continuously for 60 seconds, OR entering a 30+ character passphrase twice.
- System-wide enforcement on macOS and Windows with authorization requests and crash recovery.
- Robust tests for every lifecycle step (profile persistence, state machine, enforcement barriers, and restore-after-exit).

---

## Global Constraints

- **Durations:** All time values in Rust and TypeScript are stored and transmitted in **seconds**. Work: 60–5400s (1–90m). Short break: 60–1800s (1–30m). Long break: 60–3600s (1–60m). Work rounds: 1–12.
- **Enforcement Authority:** Rust owns all timer advancement, session switching locks, and blocking state. The frontend never decides whether blocking is active.
- **Crash Recovery:** All native blocking rules MUST operate on an expiring safety lease (default: 15s expiration, 2s heartbeat). If Pomotroid terminates or crashes, blocks automatically lift.
- **Zero Data Loss on Legacy Timer:** Existing `sessions` history table remains untouched. Existing "No session" mode retains current infinite Pomodoro loop.
- **Aesthetic Floor:** Retain custom titlebar geometry, Mona Sans variable font, CSS zoom scaling on `.timer`, and CSS custom property theme tokens.
- **Plan Persistence:** All active implementation plans and decomposed subplans MUST be committed to the `plans/` directory (`plans/focus-sessions-master-plan.md` and `plans/subplans/`), and `AGENTS.md` updated so subsequent sessions have full roadmap context.

---

## Review Focus

1. **Crash during active work round:** App terminates abruptly while apps and websites are blocked. Helper watchdog lease expires within 15 seconds, restoring `/etc/hosts` and process access without manual repair.
2. **Session switching bypass via IPC/Shortcuts:** User attempts to trigger `focus_profile_select`, `timer_reset`, or `timer_skip` via global shortcut, tray menu, or direct IPC while session is active. Rust controller rejects with `FocusError::SessionLocked`.
3. **Emergency exit hold cancellation:** User holds emergency button for 59.5 seconds, then window loses focus or key releases. Attempt immediately cancels with zero progress retained.
4. **Passphrase verification security:** Passphrase requires minimum 30 characters, stored only as salted Argon2id hash. User must type it twice identically during active run to unlock.
5. **Break unblocking toggle transition:** With `unblock_during_breaks = true`, transition from Work to Short Break restores sites and apps. When break countdown hits 0 and next Work round begins, blocking is re-enforced before timer ticks.

---
## Task 0: Plan Persistence & AGENTS.md Integration

**Files:**
- Create: `plans/README.md`
- Create: `plans/focus-sessions-master-plan.md`
- Create: `plans/subplans/01-db-and-persistence.md`
- Create: `plans/subplans/02-domain-validation-security.md`
- Create: `plans/subplans/03-state-machine-escape.md`
- Create: `plans/subplans/04-native-enforcers-macos-windows.md`
- Create: `plans/subplans/05-timer-controller-interception.md`
- Create: `plans/subplans/06-ipc-contract-stores.md`
- Create: `plans/subplans/07-ui-selector-titlebar.md`
- Create: `plans/subplans/08-ui-settings-sessions.md`
- Create: `plans/subplans/09-ui-emergency-exit.md`
- Create: `plans/subplans/10-e2e-system-tests.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: Committed, reviewable plan files in `plans/` directory for cross-session continuity.
- Produces: Mandatory section in `AGENTS.md` instructing agents to consult `plans/` for active roadmaps.

- [ ] **Step 1: Create `plans/` directory structure and index**

Create `plans/README.md` indexing the focus sessions master plan and subplans.

- [ ] **Step 2: Commit master plan and decompose subplans into `plans/subplans/`**

Write each discrete task (Tasks 1 through 10) into its dedicated subplan markdown file inside `plans/subplans/` with self-contained context, interfaces, failing tests, implementation steps, and verification commands tailored for smaller model execution.

- [ ] **Step 3: Update `AGENTS.md` with Plans and Roadmaps directive**

Add a prominent section in `AGENTS.md`:
```markdown
## Plans and Roadmaps

Always check the `plans/` directory before starting work. Active and pending multi-step feature plans, architecture specifications, and progress states are maintained in `plans/` (e.g., `plans/focus-sessions-master-plan.md` and `plans/subplans/`). Agents MUST review existing plans in `plans/` to maintain continuity across sessions.
```

- [ ] **Step 4: Verify files and git status**

Confirm all 12 plan files exist in `plans/` and `AGENTS.md` contains the directive.

- [ ] **Step 5: Commit**

```bash
git add plans/ AGENTS.md
git commit -m "docs: establish plans directory, focus sessions roadmap, and AGENTS.md guidance"
```

---


## Task 1: Database Schema & Migration 7 for Focus Profiles

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

## Task 2: Domain Normalization & Passphrase Security

**Files:**
- Create: `src-tauri/src/focus/validation.rs`
- Create: `src-tauri/src/focus/security.rs`
- Modify: `src-tauri/Cargo.toml` (add `idna = "1"`, `argon2 = "0.5"`)
- Test: `src-tauri/src/focus/validation.rs`, `src-tauri/src/focus/security.rs`

**Interfaces:**
- Produces:
```rust
pub fn normalize_domain(input: &str) -> Result<String, ValidationError>;
pub fn hash_passphrase(plain: &str) -> Result<String, SecurityError>;
pub fn verify_passphrase(plain: &str, hash: &str) -> bool;
```

- [ ] **Step 1: Write failing domain validation and passphrase hashing tests**
```rust
#[test]
fn test_domain_normalization() {
    assert_eq!(normalize_domain("https://WWW.Reddit.COM/r/all").unwrap(), "reddit.com");
    assert_eq!(normalize_domain("discord.gg/").unwrap(), "discord.gg");
    assert!(normalize_domain("localhost").is_err());
    assert!(normalize_domain("127.0.0.1").is_err());
    assert!(normalize_domain("invalid..domain").is_err());
}

#[test]
fn test_passphrase_min_length_and_argon2() {
    let short = "too-short-passphrase";
    assert!(hash_passphrase(short).is_err());
    let valid = "this-is-a-long-passphrase-with-more-than-thirty-characters!";
    let hash = hash_passphrase(valid).unwrap();
    assert!(verify_passphrase(valid, &hash));
    assert!(!verify_passphrase("wrong-passphrase-with-more-than-thirty-characters!!", &hash));
}
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cargo test --manifest-path src-tauri/Cargo.toml test_domain_normalization`
Expected: FAIL.

- [ ] **Step 3: Implement domain normalization and Argon2id hashing**
In `src-tauri/src/focus/validation.rs`:
- Strip `http://`, `https://`, trailing slashes, paths, and query parameters.
- Convert to lowercase, strip leading `www.`.
- Run IDNA punycode conversion. Reject IP addresses (`127.0.0.1`, `::1`), `localhost`, and invalid TLDs.
In `src-tauri/src/focus/security.rs`:
- Enforce `plain.chars().count() >= 30`.
- Hash using Argon2id with recommended parameters (`m=19456`, `t=2`, `p=1`).

- [ ] **Step 4: Run tests to verify they pass**
Run: `cargo test --manifest-path src-tauri/Cargo.toml focus::validation focus::security`
Expected: PASS.

- [ ] **Step 5: Commit changes**
`git add src-tauri/Cargo.toml src-tauri/src/focus/validation.rs src-tauri/src/focus/security.rs`
`git commit -m "feat(focus): add domain normalization and secure passphrase hashing"`

---

## Task 3: Focus State Machine & Emergency Exit Logic

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

## Task 4: Native Enforcers (macOS & Windows) & Crash Recovery Watchdog

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

## Task 5: Timer Integration & Control Interception Barrier

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

## Task 6: Typed IPC Contract & Svelte Stores

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/ipc/index.ts`
- Create: `src/lib/stores/focus.ts`
- Modify: `src-tauri/src/commands.rs` (expose focus commands)

**Interfaces:**
- Exposes:
```typescript
export interface AppTarget {
  id: string;
  name: string;
  identifier: string;
  platform: 'macos' | 'windows' | 'all';
}

export interface FocusProfile {
  id: string;
  name: string;
  work_secs: number;
  short_break_secs: number;
  long_break_secs: number;
  work_rounds: number;
  blocked_apps: AppTarget[];
  blocked_domains: string[];
  revision: number;
}

export interface FocusSnapshot {
  status: 'idle' | 'preparing' | 'active' | 'releasing' | 'recovery_required';
  current_phase: 'work' | 'short_break' | 'long_break' | null;
  active_profile: FocusProfile | null;
  current_work_round: number;
  total_work_rounds: number;
  is_locked: bool;
  blocking_active: bool;
  unblock_during_breaks: bool;
}

// IPC methods:
export const getFocusProfiles = (): Promise<FocusProfile[]> => ...;
export const saveFocusProfile = (profile: FocusProfile): Promise<FocusProfile> => ...;
export const deleteFocusProfile = (id: string): Promise<void> => ...;
export const selectFocusProfile = (id: string | null): Promise<void> => ...;
export const getFocusSnapshot = (): Promise<FocusSnapshot> => ...;
export const setFocusPreferences = (prefs: { unblock_during_breaks: boolean }): Promise<void> => ...;
export const startEmergencyHold = (): Promise<string> => ...;
export const pulseEmergencyHold = (attemptId: string, elapsedMs: number): Promise<boolean> => ...;
export const submitEmergencyPassphrase = (passphrase: string): Promise<boolean> => ...;
```

- [ ] **Step 1: Write type definitions and IPC wrappers in `src/lib/types.ts` and `src/lib/ipc/index.ts`**
Add all new focus interfaces, IPC commands, and event listener `onFocusChanged`.

- [ ] **Step 2: Implement Rust IPC command handlers in `src-tauri/src/commands.rs`**
Expose `focus_profiles_get`, `focus_profile_save`, `focus_profile_delete`, `focus_profile_select`, `focus_snapshot_get`, `focus_preferences_set`, `focus_escape_start_hold`, `focus_escape_pulse_hold`, `focus_escape_submit_passphrase`.
Register in `tauri::generate_handler![]` in `src-tauri/src/lib.rs`.

- [ ] **Step 3: Create reactive store `src/lib/stores/focus.ts`**
```typescript
import { writable } from 'svelte/store';
import type { FocusSnapshot, FocusProfile } from '$lib/types';
import { getFocusSnapshot, getFocusProfiles, onFocusChanged } from '$lib/ipc';

export const focusSnapshot = writable<FocusSnapshot | null>(null);
export const focusProfiles = writable<FocusProfile[]>([]);
```

- [ ] **Step 4: Type-check with `npm run check`**
Run: `npm run check`
Expected: 0 errors in `$lib/types.ts`, `$lib/ipc/index.ts`, `$lib/stores/focus.ts`.

- [ ] **Step 5: Commit changes**
`git add src/lib/types.ts src/lib/ipc/index.ts src/lib/stores/focus.ts src-tauri/src/commands.rs src-tauri/src/lib.rs`
`git commit -m "feat(ipc): add typed focus session interfaces, IPC commands, and reactive store"`

---

## Task 7: Top-Center Session Selector in Titlebar

**Files:**
- Create: `src/lib/components/SessionSelector.svelte`
- Modify: `src/lib/components/Titlebar.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/messages/en.json` (and other locale files)

**Interfaces:**
- Component props: `disabled: boolean` (when active/locked).
- Displays currently selected session name or "No Session".
- Dropdown allows selecting available profiles or navigating to Settings to configure.

- [ ] **Step 1: Create `src/lib/components/SessionSelector.svelte`**
```svelte
<script lang="ts">
  import { focusSnapshot, focusProfiles } from '$lib/stores/focus';
  import { selectFocusProfile } from '$lib/ipc';
  import * as m from '$paraglide/messages.js';

  let isOpen = $state(false);
  let isLocked = $derived($focusSnapshot?.is_locked ?? false);
  let activeProfile = $derived($focusSnapshot?.active_profile);
</script>

<div class="session-selector" class:locked={isLocked}>
  <button 
    class="selector-btn" 
    disabled={isLocked}
    onclick={() => isOpen = !isOpen}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
  >
    {#if isLocked}
      <span class="lock-icon">🔒</span>
    {/if}
    <span class="session-name">
      {activeProfile ? activeProfile.name : m.session_none()}
    </span>
    {#if !isLocked}
      <span class="chevron" class:open={isOpen}>▾</span>
    {/if}
  </button>

  {#if isOpen && !isLocked}
    <!-- Dropdown list with saved profiles + "Settings..." link -->
  {/if}
</div>
```

- [ ] **Step 2: Mount `SessionSelector` into `src/lib/components/Titlebar.svelte`**
Position in top-center of titlebar. Apply `position: absolute; left: 50%; transform: translateX(-50%);` with `data-tauri-drag-region="false"`.
Ensure compatibility with compact mode: truncate profile name when window width < 300px.

- [ ] **Step 3: Add localization strings in `src/messages/en.json`**
Add `session_none`, `session_select`, `session_active_locked`, `session_manage`.
Run `npm run paraglide:compile`.

- [ ] **Step 4: Verify visually and type check**
Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit changes**
`git add src/lib/components/SessionSelector.svelte src/lib/components/Titlebar.svelte src/messages/`
`git commit -m "feat(ui): add top-center session selector to Titlebar with lock state"`

---

## Task 8: Settings Sessions Management UI

**Files:**
- Create: `src/lib/components/settings/sections/SessionsSection.svelte`
- Modify: `src/routes/settings/+page.svelte`
- Modify: `src/messages/*.json`

**Interfaces:**
- In Settings sidebar, add `Sessions` tab (`m.nav_sessions`).
- UI allows:
  - Creating a new session profile.
  - Customizing Work, Short Break, Long Break times, and Rounds interval.
  - Adding/removing blocked apps (with native app picker).
  - Adding/removing blocked websites (with live domain validation).
  - Toggling "Temporarily unblock during breaks" (`unblock_during_breaks`).
  - Configuring emergency passphrase (minimum 30 characters, entered twice).

- [ ] **Step 1: Create `src/lib/components/settings/sections/SessionsSection.svelte`**
Adopt existing Pomotroid styling:
- Reusable slider + badge pattern from `TimerSection.svelte` (`formatMMSS`, `parseMMSS`).
- Toggle component `SettingsToggle.svelte` for `unblock_during_breaks`.
- Tag-based list input for blocked domains with real-time normalization preview.
- Application selection list with remove buttons.

- [ ] **Step 2: Add navigation item in `src/routes/settings/+page.svelte`**
Add `{ id: 'sessions', label: m.nav_sessions() }` to `SECTIONS` array.
Render `<SessionsSection />` when `active === 'sessions'`.

- [ ] **Step 3: Add localization entries in `src/messages/en.json`**
Add `nav_sessions`, `session_name`, `session_work_duration`, `session_break_duration`, `session_blocked_apps`, `session_blocked_sites`, `session_unblock_breaks`.
Run `npm run paraglide:compile`.

- [ ] **Step 4: Run type check**
Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit changes**
`git add src/lib/components/settings/sections/SessionsSection.svelte src/routes/settings/+page.svelte src/messages/`
`git commit -m "feat(ui): add sessions configuration section in settings"`

---

## Task 9: Deliberate Emergency Exit Dialog

**Files:**
- Create: `src/lib/components/FocusEscapeDialog.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/utils/localShortcuts.ts`

**Interfaces:**
- Opened when user clicks lock icon or chooses "End Session..." during active run.
- Supports continuous 60-second hold (Spacebar or Hold Button) with visual progress ring/bar.
- Supports passphrase entry (if configured) requiring typing passphrase twice.

- [ ] **Step 1: Create `src/lib/components/FocusEscapeDialog.svelte`**
```svelte
<script lang="ts">
  import { startEmergencyHold, pulseEmergencyHold, submitEmergencyPassphrase } from '$lib/ipc';
  let holdProgress = $state(0); // 0 to 100%
  let isHolding = $state(false);
  let passphraseInput = $state('');
  let passphraseConfirm = $state('');
  let step = $state<'choice' | 'hold' | 'passphrase'>('choice');
</script>

<div class="escape-modal-backdrop">
  <div class="escape-modal" role="dialog" aria-modal="true">
    <h3>Emergency Exit</h3>
    <p>Hold for 60 seconds or enter your 30+ char passphrase twice to exit early.</p>
    <!-- 60-second continuous hold button with requestAnimationFrame pulse -->
    <!-- Two-stage passphrase form -->
  </div>
</div>
```

- [ ] **Step 2: Intercept local keyboard shortcut in `src/lib/utils/localShortcuts.ts`**
When escape dialog is open, prevent Spacebar from triggering `timerToggle()`. Dedicate Spacebar to emergency hold.

- [ ] **Step 3: Mount dialog into `src/routes/+page.svelte`**
Mount conditionally when user clicks locked session indicator.

- [ ] **Step 4: Run type check**
Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 5: Commit changes**
`git add src/lib/components/FocusEscapeDialog.svelte src/routes/+page.svelte src/lib/utils/localShortcuts.ts`
`git commit -m "feat(ui): implement 60-second hold and passphrase emergency exit dialog"`

---

## Task 10: End-to-End System Tests & Verification

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

## Critical Files & Anchors

1. `src-tauri/src/timer/mod.rs:85-175`: Central event listener and controller entry point where focus enforcement barriers are attached to timer phase changes.
2. `src-tauri/src/db/migrations.rs:80-140`: Database schema migration adding `focus_profiles`, `focus_preferences`, and `focus_run_journal`.
3. `src/lib/components/Titlebar.svelte:177-285`: Hosts top-center `SessionSelector` in the draggable custom titlebar.
4. `src/routes/settings/+page.svelte:20-60, 140-180`: Settings sidebar and container hosting `SessionsSection.svelte`.
5. `src/lib/ipc/index.ts:1-120`: Typed IPC communication boundary connecting frontend UI components to backend focus controllers.

---

## Verification & Proof Commands

1. **Rust unit & integration tests:**
   `cargo test --manifest-path src-tauri/Cargo.toml`
   Proves profile persistence, domain parsing, Argon2id validation, state machine cycle execution, and watchdog lease expiry.
2. **Frontend Type & Svelte Checks:**
   `npm run check`
   Proves all TypeScript types, Svelte 5 runes, and Paraglide i18n accessors match the IPC contract.
3. **Frontend Production Build:**
   `npm run build`
   Proves the static SvelteKit bundle builds cleanly with zero compilation errors.
