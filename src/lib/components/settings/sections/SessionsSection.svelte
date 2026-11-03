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
    getBrowserSetup,
    requireBrowserProfile,
  } from '$lib/ipc';
  import type { FocusProfile, BrowserSetupInfo, BrowserKind } from '$lib/types';
  import { settings } from '$lib/stores/settings';
  import { setSetting } from '$lib/ipc';
  import SettingsToggle from '$lib/components/settings/SettingsToggle.svelte';
  import InstalledAppPicker from '$lib/components/settings/InstalledAppPicker.svelte';
  import * as m from '$paraglide/messages.js';

  let profiles = $derived($focusProfiles);
  let activeProfile = $derived($focusSnapshot.active_profile);
  let isLocked = $derived($focusSnapshot.is_locked);
  let unblockBreaks = $derived($focusSnapshot.unblock_during_breaks);

  let browserSetup = $state<BrowserSetupInfo | null>(null);
  let copyFeedback = $state('');

  onMount(() => {
    refreshBrowserSetup();
    const interval = setInterval(refreshBrowserSetup, 3000);
    return () => clearInterval(interval);
  });

  async function refreshBrowserSetup() {
    try {
      browserSetup = await getBrowserSetup();
    } catch (e) {
      console.warn('[sessions] failed to get browser setup:', e);
    }
  }

  async function copyToken() {
    if (!browserSetup?.token) return;
    try {
      await navigator.clipboard.writeText(browserSetup.token);
      copyFeedback = 'Copied!';
      setTimeout(() => { copyFeedback = ''; }, 2000);
    } catch {
      copyFeedback = 'Copy failed';
    }
  }

  async function toggleRequireProfile(profileId: string, browser: BrowserKind, currentReq: boolean) {
    try {
      await requireBrowserProfile(profileId, browser, !currentReq);
      await refreshBrowserSetup();
    } catch (e) {
      console.error('[sessions] failed to toggle required profile:', e);
    }
  }
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
  let originalProfileJson = $state<string>('');
  let domainInput = $state('');
  let statusMessage = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);

  // Unsaved changes confirmation dialog
  let showDiscardDialog = $state(false);
  let pendingSwitchId = $state<string | null>(null);

  // Emergency Passphrase state
  let passphraseInput = $state('');
  let passphraseConfirm = $state('');
  let passphraseStatus = $state<string | null>(null);

  let isDirty = $derived.by(() => {
    if (!originalProfileJson) return false;
    return JSON.stringify(editingProfile) !== originalProfileJson;
  });

  $effect(() => {
    if (profiles.length > 0 && !selectedId) {
      const initial = activeProfile ? profiles.find((p) => p.id === activeProfile.id) || profiles[0] : profiles[0];
      loadProfileForEdit(initial);
    }
  });

  function loadProfileForEdit(p: FocusProfile) {
    selectedId = p.id;
    editingProfile = JSON.parse(JSON.stringify(p));
    originalProfileJson = JSON.stringify(editingProfile);
    errorMessage = null;
    statusMessage = null;
  }

  function createNewProfile() {
    selectedId = 'new';
    editingProfile = {
      id: '',
      name: m.session_new_name(),
      work_secs: 1500,
      short_break_secs: 300,
      long_break_secs: 900,
      work_rounds: 4,
      blocked_apps: [],
      blocked_domains: [],
      revision: 1,
    };
    originalProfileJson = JSON.stringify(editingProfile);
    errorMessage = null;
    statusMessage = null;
  }

  function handleSelectChange(e: Event) {
    const targetVal = (e.target as HTMLSelectElement).value;
    if (targetVal === selectedId) return;

    if (isDirty) {
      pendingSwitchId = targetVal;
      showDiscardDialog = true;
      // Revert select display until user confirms
      (e.target as HTMLSelectElement).value = selectedId;
      return;
    }

    switchSession(targetVal);
  }

  function handleAddClick() {
    if (isDirty) {
      pendingSwitchId = 'new';
      showDiscardDialog = true;
      return;
    }
    createNewProfile();
  }

  function switchSession(id: string) {
    if (id === 'new') {
      createNewProfile();
    } else {
      const found = profiles.find((p) => p.id === id);
      if (found) loadProfileForEdit(found);
    }
  }

  function confirmDiscard() {
    showDiscardDialog = false;
    if (pendingSwitchId) {
      switchSession(pendingSwitchId);
    }
    pendingSwitchId = null;
  }

  function cancelDiscard() {
    showDiscardDialog = false;
    pendingSwitchId = null;
  }

  async function handleSave() {
    errorMessage = null;
    statusMessage = null;
    if (!editingProfile.name.trim()) {
      errorMessage = m.session_name_required();
      return;
    }

    try {
      const saved = await saveFocusProfile(editingProfile);
      selectedId = saved.id;
      editingProfile = JSON.parse(JSON.stringify(saved));
      originalProfileJson = JSON.stringify(editingProfile);
      const all = await getFocusProfiles();
      focusProfiles.set(all);
      statusMessage = m.session_saved();
    } catch (err: any) {
      errorMessage = String(err);
    }
  }

  async function handleDelete(id: string) {
    if (profiles.length <= 1) {
      errorMessage = m.session_last_required();
      return;
    }
    if (isLocked && activeProfile?.id === id) {
      errorMessage = 'Cannot delete active locked session';
      return;
    }
    if (!confirm(m.session_delete_confirm())) return;
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

  async function handleMakeActive(id: string) {
    try {
      await selectFocusProfile(id);
    } catch (err: any) {
      errorMessage = String(err);
    }
  }

  async function toggleSetting(key: string, current: boolean) {
    try {
      const updated = await setSetting(key, current ? 'false' : 'true');
      settings.set(updated);
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

<div class="sessions-container">
  <!-- Top Session Selection Toolbar -->
  <div class="session-toolbar">
    <div class="select-group">
      <label for="session-dropdown" class="toolbar-label">{m.session_select_edit()}</label>
      <div class="select-wrapper">
        <select
          id="session-dropdown"
          class="session-select"
          value={selectedId}
          onchange={handleSelectChange}
        >
          {#if selectedId === 'new'}
            <option value="new">✦ {editingProfile.name || m.session_new_name()}</option>
          {/if}
          {#each profiles as p (p.id)}
            <option value={p.id}>
              {p.name}{activeProfile?.id === p.id ? ` • ${m.session_active_label()}` : ''}
            </option>
          {/each}
        </select>
        <span class="select-arrow" aria-hidden="true">▾</span>
      </div>
    </div>

    <button
      type="button"
      class="btn-add-session"
      onclick={handleAddClick}
      title={m.session_add()}
      aria-label={m.session_add()}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <line x1="8" y1="3" x2="8" y2="13"></line>
        <line x1="3" y1="8" x2="13" y2="8"></line>
      </svg>
    </button>
  </div>

  <!-- Discard changes dialog -->
  {#if showDiscardDialog}
    <div class="modal-backdrop" onclick={cancelDiscard} onkeydown={(e) => e.key === 'Escape' && cancelDiscard()} role="presentation">
      <div class="modal-card" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="discard-title" tabindex="-1">
        <h4 id="discard-title" class="modal-title">{m.session_unsaved_title()}</h4>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={cancelDiscard}>
            {m.session_keep_editing()}
          </button>
          <button type="button" class="btn-discard" onclick={confirmDiscard}>
            {m.session_discard()}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Editor view -->
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
        <div class="name-input-row">
          <input
            id="prof-name"
            type="text"
            class="text-input"
            bind:value={editingProfile.name}
            placeholder="e.g. Deep Work"
          />
          {#if activeProfile?.id === editingProfile.id}
            <span class="active-pill">
              <span class="active-dot"></span>
              {m.session_active_label()}
            </span>
          {:else if editingProfile.id}
            <button
              type="button"
              class="btn-secondary btn-activate"
              onclick={() => handleMakeActive(editingProfile.id)}
            >
              {m.session_make_active()}
            </button>
          {/if}
        </div>
      </div>

      <div class="header-actions">
        {#if editingProfile.id}
          <button
            type="button"
            class="btn-delete"
            disabled={profiles.length <= 1 || (isLocked && activeProfile?.id === editingProfile.id)}
            title={profiles.length <= 1 ? m.session_last_required() : m.session_delete()}
            onclick={() => handleDelete(editingProfile.id)}
          >
            <svg class="trash-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 4h12"></path>
              <path d="M5 4V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V4"></path>
              <path d="M13 4v9.5A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5V4"></path>
            </svg>
            <span>{m.session_delete()}</span>
          </button>
        {/if}
        <button type="button" class="btn-primary" onclick={handleSave}>
          {m.session_save()}
        </button>
      </div>
    </div>

    <!-- Durations & Rounds Sliders -->
    <div class="section-group">
      <h3 class="group-title">{m.session_durations()}</h3>

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

    <!-- Blocked Applications (Device Application Picker) -->
    <div class="section-group">
      <h3 class="group-title">{m.session_blocked_apps()}</h3>
      <InstalledAppPicker
        targets={editingProfile.blocked_apps}
        onChange={(newTargets) => (editingProfile.blocked_apps = newTargets)}
        disabled={isLocked && activeProfile?.id === editingProfile.id}
      />
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
        <button type="button" class="btn-secondary" onclick={addDomain}>+ Add Domain</button>
      </div>

      <div class="chip-container">
        {#each editingProfile.blocked_domains as domain}
          <div class="domain-chip">
            <span>{domain}</span>
            <button type="button" class="chip-remove" onclick={() => removeDomain(domain)} aria-label="Remove domain">×</button>
          </div>
        {/each}
        {#if editingProfile.blocked_domains.length === 0}
          <span class="empty-hint">No websites blocked yet. Add domains like "reddit.com".</span>
        {/if}
      </div>
      <span class="unblock-note">{m.session_no_blocking()}</span>
    </div>
    <!-- Browser Extension Companions -->
    <div class="section-group">
      <h3 class="group-title">Browser Extension Companions</h3>
      <p class="section-desc">
        Pair extensions in Chrome, Firefox, or Safari to enforce website blocks without requiring admin privileges.
      </p>

      {#if browserSetup}
        <div class="pairing-box">
          <div class="token-row">
            <span class="token-label">Pairing Token:</span>
            <code class="token-val">{browserSetup.token}</code>
            <button type="button" class="btn-secondary copy-btn" onclick={copyToken}>
              {copyFeedback || 'Copy Token'}
            </button>
          </div>

          <div class="profiles-list">
            <span class="sub-label">Connected Browser Profiles:</span>
            {#if browserSetup.profiles.length === 0}
              <div class="empty-hint">
                No browser extensions connected yet. Load the extension from <code>extensions/dist/</code> in your browser and enter the token above.
              </div>
            {:else}
              {#each browserSetup.profiles as prof}
                <div class="browser-profile-row">
                  <div class="prof-meta">
                    <span class="prof-browser">{prof.browser.toUpperCase()}</span>
                    <span class="prof-id">{prof.profile_id}</span>
                    {#if prof.is_connected}
                      <span class="badge online">Online</span>
                    {:else}
                      <span class="badge offline">Offline</span>
                    {/if}
                    {#if prof.browser === 'safari'}
                      <span class="badge dev">Dev</span>
                    {/if}
                  </div>
                  <label class="req-toggle">
                    <input
                      type="checkbox"
                      checked={prof.is_required}
                      disabled={isLocked && activeProfile?.id === editingProfile.id}
                      onchange={() => toggleRequireProfile(prof.profile_id, prof.browser, prof.is_required)}
                    />
                    <span>Required for session</span>
                  </label>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- Timer Execution Preferences -->
    <div class="section-group">
      <h3 class="group-title">{m.session_timer_preferences()}</h3>
      <SettingsToggle
        label={m.timer_toggle_short_breaks()}
        description={m.timer_toggle_short_breaks_desc()}
        checked={!$settings.short_breaks_enabled}
        onclick={() => toggleSetting('short_breaks_enabled', $settings.short_breaks_enabled)}
      />
      <SettingsToggle
        label={m.timer_toggle_long_breaks()}
        description={m.timer_toggle_long_breaks_desc()}
        checked={!$settings.long_breaks_enabled}
        onclick={() => toggleSetting('long_breaks_enabled', $settings.long_breaks_enabled)}
      />
      <SettingsToggle
        label={m.timer_toggle_auto_start_work()}
        description={m.timer_toggle_auto_start_work_desc()}
        checked={$settings.auto_start_work}
        onclick={() => toggleSetting('auto_start_work', $settings.auto_start_work)}
      />
      <SettingsToggle
        label={m.timer_toggle_auto_start_break()}
        description={m.timer_toggle_auto_start_break_desc()}
        checked={$settings.auto_start_break}
        onclick={() => toggleSetting('auto_start_break', $settings.auto_start_break)}
      />
      <SettingsToggle
        label={m.timer_toggle_countdown()}
        description={m.timer_toggle_countdown_desc()}
        checked={$settings.dial_countdown}
        onclick={() => toggleSetting('dial_countdown', $settings.dial_countdown)}
      />
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
            <button type="button" class="btn-secondary" onclick={savePassphrase}>Save Passphrase</button>
            <button type="button" class="btn-secondary" onclick={clearPassphrase}>Clear</button>
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
  .sessions-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    position: relative;
  }

  /* Compact top toolbar */
  .session-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 18px;
    background: var(--color-background-light);
    border-bottom: 1px solid var(--color-separator);
    gap: 12px;
    flex-shrink: 0;
  }

  .select-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .toolbar-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-foreground-darker);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .select-wrapper {
    position: relative;
    flex: 1;
    max-width: 280px;
    min-width: 120px;
    display: flex;
    align-items: center;
  }

  .session-select {
    width: 100%;
    appearance: none;
    -webkit-appearance: none;
    background: var(--color-background);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    padding: 6px 26px 6px 10px;
    color: var(--color-foreground);
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    outline: none;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    transition: border-color 140ms ease-out, background 140ms ease-out;
  }

  .session-select:focus {
    border-color: var(--color-accent);
  }

  @media (hover: hover) {
    .session-select:hover {
      border-color: color-mix(in oklch, var(--color-foreground) 24%, transparent);
    }
  }

  .select-arrow {
    position: absolute;
    right: 8px;
    font-size: 9px;
    color: var(--color-foreground-darker);
    pointer-events: none;
  }

  .btn-add-session {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid var(--color-separator);
    color: var(--color-foreground);
    cursor: pointer;
    transition: background 140ms ease-out, border-color 140ms ease-out, transform 100ms ease-out, color 140ms ease-out;
    flex-shrink: 0;
  }

  @media (hover: hover) {
    .btn-add-session:hover {
      background: var(--color-hover);
      border-color: var(--color-accent);
      color: var(--color-accent);
    }
  }

  .btn-add-session:active {
    transform: scale(0.95);
  }

  /* Discard Modal */
  .modal-backdrop {
    position: absolute;
    inset: 0;
    background: color-mix(in oklch, black 40%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }

  .modal-card {
    background: var(--color-background-light);
    border: 1px solid var(--color-separator);
    border-radius: 8px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 320px;
    box-shadow: 0 12px 32px color-mix(in oklch, black 35%, transparent);
  }

  .modal-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-foreground);
    margin: 0;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-discard {
    background: color-mix(in oklch, var(--color-focus-round) 15%, transparent);
    border: 1px solid var(--color-focus-round);
    color: var(--color-focus-round);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: background 140ms ease-out, transform 100ms ease-out;
  }

  @media (hover: hover) {
    .btn-discard:hover {
      background: color-mix(in oklch, var(--color-focus-round) 25%, transparent);
    }
  }

  .btn-discard:active {
    transform: scale(0.97);
  }

  /* Editor scroll body */
  .profile-editor {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-width: 0;
    padding: 18px 22px;
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

  .name-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .name-input-row .text-input {
    flex: 1;
    min-width: 0;
  }

  .active-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: color-mix(in oklch, var(--color-short-round) 16%, transparent);
    color: var(--color-short-round);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .active-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-short-round);
  }

  .btn-activate {
    white-space: nowrap;
    flex-shrink: 0;
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
    transition: border-color 140ms ease-out;
  }

  .text-input:focus {
    border-color: var(--color-accent);
  }

  /* Refined Animated Buttons */
  .btn-primary {
    background: var(--color-accent);
    color: var(--color-background);
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: background 140ms ease-out, transform 100ms ease-out, opacity 140ms ease-out;
  }

  @media (hover: hover) {
    .btn-primary:hover:not(:disabled) {
      background: color-mix(in oklch, var(--color-accent) 88%, white);
    }
  }

  .btn-primary:active:not(:disabled) {
    transform: scale(0.98);
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid var(--color-separator);
    color: var(--color-foreground);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out, transform 100ms ease-out;
  }

  @media (hover: hover) {
    .btn-secondary:hover:not(:disabled) {
      background: var(--color-hover);
      border-color: color-mix(in oklch, var(--color-foreground) 20%, transparent);
    }
  }

  .btn-secondary:active:not(:disabled) {
    transform: scale(0.98);
  }

  .btn-secondary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Refined Delete Button: matches app aesthetic at rest, signals danger on hover/focus */
  .btn-delete {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 1px solid var(--color-separator);
    color: var(--color-foreground-darker);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out, transform 100ms ease-out;
  }

  .trash-icon {
    flex-shrink: 0;
    transition: transform 140ms ease-out;
  }

  @media (hover: hover) {
    .btn-delete:hover:not(:disabled) {
      background: color-mix(in oklch, var(--color-focus-round) 12%, transparent);
      border-color: color-mix(in oklch, var(--color-focus-round) 36%, transparent);
      color: var(--color-focus-round);
    }
    .btn-delete:hover:not(:disabled) .trash-icon {
      transform: scale(1.08);
    }
  }

  .btn-delete:focus-visible {
    border-color: var(--color-focus-round);
    color: var(--color-focus-round);
  }

  .btn-delete:active:not(:disabled) {
    transform: scale(0.98);
  }

  .btn-delete:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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
    transition: color 140ms ease-out;
  }

  @media (hover: hover) {
    .chip-remove:hover {
      color: var(--color-focus-round);
    }
  }

  .empty-hint {
    font-size: 11px;
    color: var(--color-foreground-darker);
    opacity: 0.7;
  }

  .unblock-note {
    font-size: 10px;
    color: var(--color-foreground-darker);
    opacity: 0.8;
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

  .pairing-box {
    padding: 12px;
    background: var(--color-background-light);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .token-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    flex-wrap: wrap;
  }

  .token-label {
    color: var(--color-foreground-darker);
    font-weight: 500;
  }

  .token-val {
    background: rgba(0, 0, 0, 0.2);
    padding: 4px 8px;
    border-radius: 4px;
    font-family: monospace;
    color: var(--color-foreground);
  }

  .copy-btn {
    padding: 4px 10px;
    font-size: 11px;
  }

  .profiles-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .sub-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-foreground-darker);
  }

  .browser-profile-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.15);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    font-size: 12px;
    gap: 12px;
  }

  .prof-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .prof-browser {
    font-weight: 700;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--color-background-dark);
    color: var(--color-foreground);
  }

  .prof-id {
    font-family: monospace;
    color: var(--color-foreground);
  }

  .badge {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .badge.online {
    background: color-mix(in oklch, var(--color-short-round) 25%, transparent);
    color: var(--color-short-round);
  }

  .badge.offline {
    background: color-mix(in oklch, var(--color-foreground-darker) 25%, transparent);
    color: var(--color-foreground-darker);
  }

  .badge.dev {
    background: color-mix(in oklch, var(--color-long-round) 25%, transparent);
    color: var(--color-long-round);
  }

  .req-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--color-foreground-darker);
    cursor: pointer;
  }

  @media (prefers-reduced-motion: reduce) {
    .btn-primary,
    .btn-secondary,
    .btn-delete,
    .btn-add-session,
    .btn-discard,
    .trash-icon {
      transition: none !important;
      transform: none !important;
    }
  }
</style>