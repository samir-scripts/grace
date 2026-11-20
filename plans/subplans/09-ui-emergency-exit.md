Status: completed

Verification Evidence:
- `npm run check` completed with 0 errors and 0 warnings (911 files checked).
- `FocusEscapeDialog.svelte` implemented with continuous 60s hold pulse, passphrase validation, and shortcut isolation in `localShortcuts.ts`.
- Locked-session dialog refinement: Chromium fixtures verified default Hold selection, in-button countdown, keyboard focus, passphrase mismatch and backend rejection/success, and clearing on close. Inspected 360×478 English and 240×240 French, including validation and scroll to the actions.
- In a disposable macOS ARM64 Tauri app, a continuous hold released the protected session after 60 seconds. In a second session, mismatched entries kept it locked and a matching configured passphrase released it. The German validation form scrolled to the submit button at 240×240 and 240×320, with 32 CSS pixels reserved above the dialog for native controls. Both English modes fit at 360×478.
- Initial refinement checks: `npm run check` reported 0 errors and 0 warnings; `npm run test:appearance` passed 62 tests; `npm test` passed 274 tests with 2 skips.

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 9: Deliberate Emergency Exit Dialog

**Files:**
- Create: `src/lib/components/FocusEscapeDialog.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/utils/localShortcuts.ts`

**Interfaces:**
- Opened when user clicks lock icon or chooses "End Session..." during active run.
- Supports continuous 60-second hold (Spacebar or Hold Button) with an in-button countdown and fill.
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

