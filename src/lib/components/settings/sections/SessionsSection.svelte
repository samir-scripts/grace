<script lang="ts">
  import { onMount } from 'svelte';
  import { focusSnapshot, focusProfiles } from '$lib/stores/focus';
  import {
    saveFocusProfile,
    deleteFocusProfile,
    selectFocusProfile,
    setFocusUnblockBreaks,
    setFocusPassphrase,
    clearFocusPassphrase,
    getFocusProfiles,
  } from '$lib/ipc';
  import type { FocusProfile, AppTarget } from '$lib/types';
  import SettingsToggle from '$lib/components/settings/SettingsToggle.svelte';
  import * as m from '$paraglide/messages.js';

  let profiles = $derived($focusProfiles);
  let activeProfile = $derived($focusSnapshot.active_profile);
  let isLocked = $derived($focusSnapshot.is_locked);
  let unblockBreaks = $derived($focusSnapshot.unblock_during_breaks);

  // Selected profile in the settings editor
  let editingProfile = $state<FocusProfile>({
    id: '',
    name: '',
    work_secs: 1500,
    short_break_secs: 300,
    long_break_secs: 900,
    work_rounds: 4,
    blocked_apps: [],
    blocked_domains: [],
    revision: 1,
  });

  let selectedId = $state<string>('');
  let domainInput = $state('');
  let appNameInput = $state('');
  let appIdentifierInput = $state('');
  let statusMessage = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);

  // Emergency Passphrase state
  let passphraseInput = $state('');
  let passphraseConfirm = $state('');
  let passphraseStatus = $state<string | null>(null);

  $effect(() => {
    if (profiles.length > 0 && !selectedId) {
      loadProfileForEdit(profiles[0]);
    } else if (profiles.length === 0 && !selectedId) {
      createNewProfile();
    }
  });

  function loadProfileForEdit(p: FocusProfile) {
    selectedId = p.id;
    editingProfile = JSON.parse(JSON.stringify(p));
    errorMessage = null;
    statusMessage = null;
  }

  function createNewProfile() {
    selectedId = '';
    editingProfile = {
      id: '',
      name: 'New Focus Session',
      work_secs: 1500,
      short_break_secs: 300,
      long_break_secs: 900,
      work_rounds: 4,
      blocked_apps: [],
      blocked_domains: ['reddit.com', 'youtube.com'],
      revision: 1,
    };
    errorMessage = null;
    statusMessage = null;
  }

  async function handleSave() {
    errorMessage = null;
    statusMessage = null;
    if (!editingProfile.name.trim()) {
      errorMessage = 'Session name cannot be empty';
      return;
    }

    try {
      const saved = await saveFocusProfile(editingProfile);
      selectedId = saved.id;
      editingProfile = JSON.parse(JSON.stringify(saved));
      const all = await getFocusProfiles();
      focusProfiles.set(all);
      statusMessage = 'Session saved successfully';
    } catch (err: any) {
      errorMessage = String(err);
    }
  }

  async function handleDelete(id: string) {
    if (isLocked && activeProfile?.id === id) {
      errorMessage = 'Cannot delete active locked session';
      return;
    }
    if (!confirm('Are you sure you want to delete this focus session?')) return;

    try {
      await deleteFocusProfile(id);
      const all = await getFocusProfiles();
      focusProfiles.set(all);
      if (selectedId === id) {
        if (all.length > 0) loadProfileForEdit(all[0]);
        else createNewProfile();
      }
    } catch (err: any) {
      errorMessage = String(err);
    }
  }

  async function handleMakeActive(id: string | null) {
    try {
      await selectFocusProfile(id);
    } catch (err: any) {
      errorMessage = String(err);
    }
  }

  async function handleToggleUnblock(val: boolean) {
    try {
      await setFocusUnblockBreaks(!val);
    } catch (err: any) {
      errorMessage = String(err);
    }
  }

  function addDomain() {
    const raw = domainInput.trim().toLowerCase();
    if (!raw) return;
    if (!editingProfile.blocked_domains.includes(raw)) {
      editingProfile.blocked_domains = [...editingProfile.blocked_domains, raw];
    }
    domainInput = '';
  }

  function removeDomain(domain: string) {
    editingProfile.blocked_domains = editingProfile.blocked_domains.filter((d) => d !== domain);
  }

  function addApp() {
    const name = appNameInput.trim();
    const id = appIdentifierInput.trim() || name;
    if (!name) return;

    const newTarget: AppTarget = {
      id: String(Date.now()),
      name,
      identifier: id,
      platform: 'all',
    };
    editingProfile.blocked_apps = [...editingProfile.blocked_apps, newTarget];
    appNameInput = '';
    appIdentifierInput = '';
  }

  function removeApp(appId: string) {
    editingProfile.blocked_apps = editingProfile.blocked_apps.filter((a) => a.id !== appId);
  }

  async function savePassphrase() {
    passphraseStatus = null;
    if (passphraseInput.length < 30) {
      passphraseStatus = 'Error: Passphrase must be at least 30 characters long';
      return;
    }
    if (passphraseInput !== passphraseConfirm) {
      passphraseStatus = 'Error: Passphrases do not match';
      return;
    }

    try {
      await setFocusPassphrase(passphraseInput);
      passphraseStatus = 'Passphrase updated successfully';
      passphraseInput = '';
      passphraseConfirm = '';
    } catch (err: any) {
      passphraseStatus = `Error: ${err}`;
    }
  }

  async function clearPassphrase() {
    try {
      await clearFocusPassphrase();
      passphraseStatus = 'Passphrase cleared';
    } catch (err: any) {
      passphraseStatus = `Error: ${err}`;
    }
  }

  function barWidth(val: number, min: number, max: number): string {
    const frac = (val - min) / (max - min);
    return `calc(${frac} * (100% - 14px) + 7px)`;
  }
</script>

<div class="sessions-layout">
  <!-- Sidebar of profiles -->
  <div class="profiles-sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">{m.nav_sessions()}</span>
      <button class="btn-add" onclick={createNewProfile} title={m.session_add()}>+ {m.session_add()}</button>
    </div>

    <div class="profile-cards">
      {#each profiles as p (p.id)}
        {@const isCurrent = editingProfile.id === p.id}
        {@const isActive = activeProfile?.id === p.id}
        <div
          class="profile-card"
          class:selected={isCurrent}
          class:active-session={isActive}
          onclick={() => loadProfileForEdit(p)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && loadProfileForEdit(p)}
        >
          <div class="card-header">
            <span class="card-name">{p.name}</span>
            {#if isActive}
              <span class="badge active-badge">Active</span>
            {/if}
          </div>
          <div class="card-meta">
            {Math.round(p.work_secs / 60)}m focus • {p.work_rounds} rounds
          </div>
          <div class="card-counts">
            {p.blocked_domains.length} sites • {p.blocked_apps.length} apps
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Detail / Editor view -->
  <div class="profile-editor">
    {#if errorMessage}
      <div class="alert error">{errorMessage}</div>
    {/if}
    {#if statusMessage}
      <div class="alert success">{statusMessage}</div>
    {/if}

    <div class="editor-header">
      <div class="name-field">
        <label for="prof-name">{m.session_name()}</label>
        <input
          id="prof-name"
          type="text"
          class="text-input"
          bind:value={editingProfile.name}
          placeholder="e.g. Deep Work"
        />
      </div>

      <div class="header-actions">
        {#if editingProfile.id}
          <button
            class="btn-secondary"
            disabled={activeProfile?.id === editingProfile.id}
            onclick={() => handleMakeActive(editingProfile.id)}
          >
            {activeProfile?.id === editingProfile.id ? 'Currently Active' : 'Make Active'}
          </button>
          <button
            class="btn-danger"
            disabled={isLocked && activeProfile?.id === editingProfile.id}
            onclick={() => handleDelete(editingProfile.id)}
          >
            {m.session_delete()}
          </button>
        {/if}
        <button class="btn-primary" onclick={handleSave}>
          {m.session_save()}
        </button>
      </div>
    </div>

    <!-- Durations & Rounds Sliders -->
    <div class="section-group">
      <h3 class="group-title">Timer Durations</h3>

      <div class="slider-row">
        <div class="slider-label-row">
          <span>{m.session_work_duration()}</span>
          <span class="duration-badge">{Math.round(editingProfile.work_secs / 60)}m</span>
        </div>
        <div class="slider-container">
          <input
            type="range"
            min="1"
            max="90"
            value={Math.round(editingProfile.work_secs / 60)}
            oninput={(e) => (editingProfile.work_secs = Number((e.target as HTMLInputElement).value) * 60)}
          />
          <div class="slider-bar" style="width: {barWidth(Math.round(editingProfile.work_secs / 60), 1, 90)}; background: var(--color-focus-round);"></div>
        </div>
      </div>

      <div class="slider-row">
        <div class="slider-label-row">
          <span>{m.session_short_break_duration()}</span>
          <span class="duration-badge">{Math.round(editingProfile.short_break_secs / 60)}m</span>
        </div>
        <div class="slider-container">
          <input
            type="range"
            min="1"
            max="30"
            value={Math.round(editingProfile.short_break_secs / 60)}
            oninput={(e) => (editingProfile.short_break_secs = Number((e.target as HTMLInputElement).value) * 60)}
          />
          <div class="slider-bar" style="width: {barWidth(Math.round(editingProfile.short_break_secs / 60), 1, 30)}; background: var(--color-short-round);"></div>
        </div>
      </div>

      <div class="slider-row">
        <div class="slider-label-row">
          <span>{m.session_long_break_duration()}</span>
          <span class="duration-badge">{Math.round(editingProfile.long_break_secs / 60)}m</span>
        </div>
        <div class="slider-container">
          <input
            type="range"
            min="1"
            max="60"
            value={Math.round(editingProfile.long_break_secs / 60)}
            oninput={(e) => (editingProfile.long_break_secs = Number((e.target as HTMLInputElement).value) * 60)}
          />
          <div class="slider-bar" style="width: {barWidth(Math.round(editingProfile.long_break_secs / 60), 1, 60)}; background: var(--color-long-round);"></div>
        </div>
      </div>

      <div class="slider-row">
        <div class="slider-label-row">
          <span>{m.session_rounds()}</span>
          <span class="duration-badge">{editingProfile.work_rounds}</span>
        </div>
        <div class="slider-container">
          <input
            type="range"
            min="1"
            max="12"
            bind:value={editingProfile.work_rounds}
          />
          <div class="slider-bar" style="width: {barWidth(editingProfile.work_rounds, 1, 12)}; background: var(--color-accent);"></div>
        </div>
      </div>
    </div>

    <!-- Blocked Websites -->
    <div class="section-group">
      <h3 class="group-title">{m.session_blocked_sites()}</h3>
      <div class="input-add-row">
        <input
          type="text"
          class="text-input"
          bind:value={domainInput}
          placeholder={m.session_site_placeholder()}
          onkeydown={(e) => e.key === 'Enter' && addDomain()}
        />
        <button class="btn-secondary" onclick={addDomain}>+ Add Domain</button>
      </div>

      <div class="chip-container">
        {#each editingProfile.blocked_domains as domain}
          <div class="domain-chip">
            <span>{domain}</span>
            <button class="chip-remove" onclick={() => removeDomain(domain)} aria-label="Remove domain">×</button>
          </div>
        {/each}
        {#if editingProfile.blocked_domains.length === 0}
          <span class="empty-hint">No websites blocked yet. Add domains like "reddit.com".</span>
        {/if}
      </div>
    </div>

    <!-- Blocked Applications -->
    <div class="section-group">
      <h3 class="group-title">{m.session_blocked_apps()}</h3>
      <div class="input-add-row">
        <input
          type="text"
          class="text-input"
          bind:value={appNameInput}
          placeholder="App Name (e.g. Discord)"
        />
        <input
          type="text"
          class="text-input"
          bind:value={appIdentifierInput}
          placeholder="Process / Bundle ID (optional)"
        />
        <button class="btn-secondary" onclick={addApp}>+ Add App</button>
      </div>

      <div class="chip-container">
        {#each editingProfile.blocked_apps as app}
          <div class="domain-chip">
            <span>{app.name}</span>
            <button class="chip-remove" onclick={() => removeApp(app.id)} aria-label="Remove app">×</button>
          </div>
        {/each}
        {#if editingProfile.blocked_apps.length === 0}
          <span class="empty-hint">No applications blocked yet.</span>
        {/if}
      </div>
    </div>

    <!-- Global Preferences -->
    <div class="section-group">
      <h3 class="group-title">Session Preferences</h3>
      <SettingsToggle
        label={m.session_unblock_breaks()}
        description={m.session_unblock_breaks_desc()}
        checked={unblockBreaks}
        onclick={() => handleToggleUnblock(unblockBreaks)}
      />

      <!-- Optional Emergency Passphrase -->
      <div class="passphrase-box">
        <div class="passphrase-header">
          <strong>Emergency Exit Passphrase (Optional)</strong>
          <span class="passphrase-sub">Minimum 30 characters. Required twice to unlock early if hold option is not used.</span>
        </div>
        <div class="passphrase-inputs">
          <input
            type="password"
            class="text-input"
            bind:value={passphraseInput}
            placeholder="Passphrase (30+ characters)"
          />
          <input
            type="password"
            class="text-input"
            bind:value={passphraseConfirm}
            placeholder="Confirm passphrase"
          />
          <div class="passphrase-btns">
            <button class="btn-secondary" onclick={savePassphrase}>Save Passphrase</button>
            <button class="btn-secondary" onclick={clearPassphrase}>Clear</button>
          </div>
        </div>
        {#if passphraseStatus}
          <div class="passphrase-status" class:error={passphraseStatus.startsWith('Error')}>
            {passphraseStatus}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .sessions-layout {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .profiles-sidebar {
    width: 170px;
    background: var(--color-background-light);
    border-right: 1px solid var(--color-separator);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-width: 0;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--color-separator);
  }

  .sidebar-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-foreground);
  }

  .btn-add {
    background: transparent;
    border: 1px solid var(--color-separator);
    color: var(--color-foreground-darker);
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .btn-add:hover {
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  .profile-cards {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .profile-card {
    padding: 10px;
    background: var(--color-background);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color var(--transition-snappy), background var(--transition-snappy);
  }

  .profile-card:hover {
    background: var(--color-hover);
  }

  .profile-card.selected {
    border-color: var(--color-accent);
    background: color-mix(in oklch, var(--color-accent) 12%, var(--color-background));
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .card-name {
    font-weight: 600;
    font-size: 12px;
    color: var(--color-foreground);
  }

  .card-meta {
    font-size: 10px;
    color: var(--color-foreground-darker);
  }

  .card-counts {
    font-size: 9px;
    color: var(--color-foreground-darker);
    opacity: 0.8;
    margin-top: 2px;
  }

  .active-badge {
    background: color-mix(in oklch, var(--color-short-round) 30%, transparent);
    color: var(--color-short-round);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
  }

  .profile-editor {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-width: 0;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .editor-header {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--color-separator);
  }

  .name-field {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .name-field label {
    font-size: 12px;
    color: var(--color-foreground-darker);
    font-weight: 500;
  }

  .header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
  }
  .text-input {
    background: var(--color-hover);
    border: 1px solid color-mix(in oklch, var(--color-foreground) 18%, transparent);
    border-radius: 6px;
    padding: 6px 10px;
    color: var(--color-foreground);
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }

  .text-input:focus {
    border-color: var(--color-accent);
  }

  .btn-primary {
    background: var(--color-accent);
    color: var(--color-background);
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid var(--color-separator);
    color: var(--color-foreground);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 11px;
    cursor: pointer;
  }

  .btn-secondary:hover {
    background: var(--color-hover);
  }

  .btn-danger {
    background: color-mix(in oklch, var(--color-focus-round) 20%, transparent);
    border: 1px solid var(--color-focus-round);
    color: var(--color-focus-round);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 11px;
    cursor: pointer;
  }

  .section-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .group-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-foreground);
    margin: 0;
  }

  .slider-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .slider-label-row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--color-foreground-darker);
  }

  .duration-badge {
    color: var(--color-foreground);
    font-weight: 600;
  }

  .slider-container {
    position: relative;
    height: 20px;
    display: flex;
    align-items: center;
  }

  .slider-container input[type='range'] {
    position: relative;
    z-index: 2;
    width: 100%;
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    background: color-mix(in oklch, var(--color-foreground) 14%, transparent);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .slider-container input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-foreground);
    cursor: pointer;
  }

  .slider-container input[type='range']::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-foreground);
    cursor: pointer;
    border: none;
  }

  .slider-bar {
    position: absolute;
    left: 0;
    height: 4px;
    border-radius: 2px;
    pointer-events: none;
    z-index: 1;
    transition: width 0.05s;
  }

  .input-add-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .input-add-row .text-input {
    flex: 1 1 140px;
    min-width: 0;
  }

  .chip-container {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 32px;
    padding: 8px;
    background: color-mix(in oklch, var(--color-background-light) 60%, var(--color-background));
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    align-items: center;
  }

  .domain-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: color-mix(in oklch, var(--color-foreground) 10%, transparent);
    border-radius: 4px;
    font-size: 11px;
    color: var(--color-foreground);
    max-width: 100%;
    min-width: 0;
  }

  .domain-chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .chip-remove {
    background: none;
    border: none;
    color: var(--color-foreground-darker);
    cursor: pointer;
    font-size: 13px;
    padding: 0;
    line-height: 1;
  }

  .chip-remove:hover {
    color: var(--color-focus-round);
  }

  .empty-hint {
    font-size: 11px;
    color: var(--color-foreground-darker);
    opacity: 0.7;
  }

  .passphrase-box {
    padding: 12px;
    background: var(--color-background-light);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .passphrase-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: var(--color-foreground);
  }

  .passphrase-sub {
    font-size: 10px;
    color: var(--color-foreground-darker);
  }

  .passphrase-inputs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .passphrase-inputs .text-input {
    flex: 1 1 140px;
    min-width: 0;
  }

  .passphrase-btns {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .passphrase-status {
    font-size: 10px;
    color: var(--color-short-round);
  }

  .passphrase-status.error {
    color: var(--color-focus-round);
  }

  .alert {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
  }

  .alert.error {
    background: color-mix(in oklch, var(--color-focus-round) 15%, transparent);
    border: 1px solid var(--color-focus-round);
    color: var(--color-focus-round);
  }

  .alert.success {
    background: color-mix(in oklch, var(--color-short-round) 15%, transparent);
    border: 1px solid var(--color-short-round);
    color: var(--color-short-round);
  }
</style>
