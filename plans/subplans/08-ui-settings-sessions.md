Status: completed

Verification Evidence:
- `npm run check` completed with 0 errors and 0 warnings (910 files checked).
- `SessionsSection.svelte` created with profile list, duration sliders, blocked sites/apps chips, unblock breaks toggle, and emergency passphrase configuration.

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 8: Settings Sessions Management UI

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

