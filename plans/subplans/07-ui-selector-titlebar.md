Status: completed

Verification Evidence:
- `npm run check` completed with 0 errors and 0 warnings (909 files checked).
- `SessionSelector.svelte` successfully mounted into `Titlebar.svelte` with lock state and accessible dropdown.

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 7: Top-Center Session Selector in Titlebar

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

