Status: pending

Context: Implement named finite Pomodoro sessions in Tauri 2/Rust and Svelte 5. Read [master plan](../focus-sessions-master-plan.md) for global constraints and shared contracts. Durations use seconds; Rust owns enforcement and session locks.

# Task 6: Typed IPC Contract & Svelte Stores

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

