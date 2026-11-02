// Reactive focus session and distraction blocking state store.
// Populated by Tauri event listeners (focus:changed).

import { writable } from 'svelte/store';
import type { FocusSnapshot, FocusProfile } from '$lib/types';
import { getFocusSnapshot, getFocusProfiles, onFocusChanged } from '$lib/ipc';

const initialSnapshot: FocusSnapshot = {
  status: 'idle',
  current_phase: null,
  active_profile: null,
  current_work_round: 0,
  total_work_rounds: 0,
  is_locked: false,
  blocking_active: false,
  unblock_during_breaks: false,
};

export const focusSnapshot = writable<FocusSnapshot>(initialSnapshot);
export const focusProfiles = writable<FocusProfile[]>([]);

let initialized = false;

export async function initFocusStore() {
  if (initialized) return;
  initialized = true;

  try {
    const [snap, profiles] = await Promise.all([
      getFocusSnapshot(),
      getFocusProfiles(),
    ]);
    focusSnapshot.set(snap);
    focusProfiles.set(profiles);
  } catch (err) {
    console.error('[focus store] failed to load initial state:', err);
  }

  try {
    await onFocusChanged((newSnapshot) => {
      focusSnapshot.set(newSnapshot);
      getFocusProfiles().then(focusProfiles.set).catch(console.error);
    });
  } catch (err) {
    console.error('[focus store] failed to attach focus:changed listener:', err);
  }
}
