<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listInstalledBrowsers,
    registerNativeHost,
    installBrowserExtension,
    removeBrowserExtension,
    getBrowserSetup,
    requireBrowserProfile,
  } from '$lib/ipc';
  import type { InstalledBrowser, BrowserSetupInfo, BrowserKind } from '$lib/types';
  import * as m from '$paraglide/messages.js';

  interface Props {
    isLocked?: boolean;
    activeSessionId?: string;
    editingSessionId?: string;
  }

  let { isLocked = false, activeSessionId = '', editingSessionId = '' }: Props = $props();

  let installedBrowsers = $state<InstalledBrowser[]>([]);
  let browserSetup = $state<BrowserSetupInfo | null>(null);
  let mutating = $state<{ kind: BrowserKind; action: 'install' | 'remove' } | null>(null);
  let statusMessage = $state('');
  let statusType = $state<'success' | 'error' | ''>('');

  onMount(() => {
    loadBrowsers();
    refreshSetup();
    const interval = setInterval(refreshSetup, 3000);
    return () => clearInterval(interval);
  });

  async function loadBrowsers() {
    try {
      installedBrowsers = await listInstalledBrowsers();
    } catch (e) {
      console.warn('[BrowserSetup] failed to list browsers:', e);
    }
  }

  async function refreshSetup() {
    try {
      browserSetup = await getBrowserSetup();
    } catch (e) {
      console.warn('[BrowserSetup] failed to get browser setup:', e);
    }
  }

  async function handleInstall(browser: InstalledBrowser) {
    mutating = { kind: browser.kind, action: 'install' };
    statusMessage = '';
    statusType = '';
    try {
      await registerNativeHost();
      await installBrowserExtension(browser.kind);
      statusMessage = m.browser_install_success();
      statusType = 'success';
      await loadBrowsers();
      await refreshSetup();
    } catch (e: any) {
      statusMessage = typeof e === 'string' ? e : (e?.message || 'Failed to install extension');
      statusType = 'error';
    } finally {
      mutating = null;
    }
  }

  async function handleRemove(browser: InstalledBrowser) {
    if (isLocked) {
      statusMessage = m.browser_locked_hint();
      statusType = 'error';
      return;
    }
    mutating = { kind: browser.kind, action: 'remove' };
    statusMessage = '';
    statusType = '';
    try {
      await removeBrowserExtension(browser.kind);
      statusMessage = m.browser_remove_success();
      statusType = 'success';
      await loadBrowsers();
      await refreshSetup();
    } catch (e: any) {
      statusMessage = typeof e === 'string' ? e : (e?.message || 'Failed to remove extension');
      statusType = 'error';
    } finally {
      mutating = null;
    }
  }

  async function toggleRequireProfile(profileId: string, browser: BrowserKind, currentReq: boolean) {
    try {
      await requireBrowserProfile(profileId, browser, !currentReq);
      await refreshSetup();
    } catch (e) {
      console.error('[BrowserSetup] failed to toggle required profile:', e);
    }
  }
</script>

<div class="browser-setup-container">
  <div class="header-group">
    <h3 class="group-title">{m.browser_companions_title()}</h3>
    <p class="section-desc">{m.browser_companions_desc()}</p>
  </div>

  {#if statusMessage}
    <div class="alert" class:success={statusType === 'success'} class:error={statusType === 'error'}>
      {statusMessage}
    </div>
  {/if}

  <!-- Installed Browsers List -->
  <div class="browser-grid">
    {#each installedBrowsers as browser}
      <div class="browser-card">
        <div class="browser-info">
          <div class="browser-icon-wrapper">
            {#if browser.kind === 'chrome'}
              <svg class="browser-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" />
                <line x1="21.17" y1="8" x2="12" y2="8" />
                <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
                <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
              </svg>
            {:else if browser.kind === 'firefox'}
              <svg class="browser-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12c0-2.8 1.15-5.33 3-7.15" />
                <path d="M16 8c-1.5-1.5-4-1-5 1s0 4 2 5 3 2 3 4-2 3-4 3" />
              </svg>
            {:else if browser.kind === 'zen'}
              <svg class="browser-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M7 8h10l-10 8h10" />
              </svg>
            {:else}
              <svg class="browser-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <polygon points="12 8 8 16 16 16 12 8" />
              </svg>
            {/if}
          </div>
          <div class="browser-text">
            <span class="browser-name">{browser.name}</span>
            <span class="browser-status">
              {#if browser.is_installed}
                <span class="badge installed">{m.browser_status_installed()}</span>
              {:else}
                <span class="badge not-installed">{m.browser_status_not_installed()}</span>
              {/if}
            </span>
          </div>
        </div>

        {#if browser.is_extension_installed}
          <button
            type="button"
            class="btn-install btn-remove"
            disabled={mutating !== null || isLocked}
            title={isLocked ? m.browser_locked_hint() : undefined}
            onclick={() => handleRemove(browser)}
          >
            {#if mutating?.kind === browser.kind && mutating?.action === 'remove'}
              {m.browser_removing()}
            {:else}
              {m.browser_remove_button()}
            {/if}
          </button>
        {:else}
          <button
            type="button"
            class="btn-install"
            disabled={mutating !== null}
            onclick={() => handleInstall(browser)}
          >
            {#if mutating?.kind === browser.kind && mutating?.action === 'install'}
              {m.browser_installing()}
            {:else}
              {m.browser_install_button()}
            {/if}
          </button>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Connected Profiles List -->
  {#if browserSetup}
    <div class="profiles-section">
      <span class="sub-label">{m.browser_connected_profiles()}:</span>
      {#if browserSetup.profiles.length === 0}
        <div class="empty-hint">
          {m.browser_no_profiles()}
        </div>
      {:else}
        <div class="profiles-list">
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
              </div>
              <label class="req-toggle">
                <input
                  type="checkbox"
                  checked={prof.is_required}
                  disabled={isLocked && activeSessionId === editingSessionId}
                  onchange={() => toggleRequireProfile(prof.profile_id, prof.browser, prof.is_required)}
                />
                <span>{m.browser_required_toggle()}</span>
              </label>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .browser-setup-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .header-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .group-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-foreground);
    margin: 0;
  }

  .section-desc {
    font-size: 11px;
    color: var(--color-foreground-darker);
    margin: 0;
    line-height: 1.4;
  }

  .alert {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 11px;
  }

  .alert.success {
    background: color-mix(in oklch, var(--color-short-round) 15%, transparent);
    border: 1px solid var(--color-short-round);
    color: var(--color-short-round);
  }

  .alert.error {
    background: color-mix(in oklch, var(--color-focus-round) 15%, transparent);
    border: 1px solid var(--color-focus-round);
    color: var(--color-focus-round);
  }

  .browser-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .browser-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--color-background-light);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    gap: 12px;
  }

  .browser-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .browser-icon-wrapper {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-foreground);
  }

  .browser-icon {
    width: 20px;
    height: 20px;
  }

  .browser-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .browser-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-foreground);
  }

  .browser-status {
    display: flex;
  }

  .badge {
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .badge.installed {
    background: color-mix(in oklch, var(--color-short-round) 20%, transparent);
    color: var(--color-short-round);
  }

  .badge.not-installed {
    background: color-mix(in oklch, var(--color-foreground-darker) 20%, transparent);
    color: var(--color-foreground-darker);
  }

  .badge.online {
    background: color-mix(in oklch, var(--color-short-round) 25%, transparent);
    color: var(--color-short-round);
  }

  .badge.offline {
    background: color-mix(in oklch, var(--color-foreground-darker) 25%, transparent);
    color: var(--color-foreground-darker);
  }

  .btn-install {
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 600;
    background: var(--color-accent);
    color: #ffffff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: opacity 0.15s ease;
    white-space: nowrap;
  }

  .btn-install:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-install:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-install.btn-remove {
    background: transparent;
    color: var(--color-focus-round);
    border: 1px solid var(--color-focus-round);
  }

  .btn-install.btn-remove:hover:not(:disabled) {
    background: color-mix(in oklch, var(--color-focus-round) 15%, transparent);
  }
  .profiles-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .sub-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-foreground-darker);
  }

  .empty-hint {
    padding: 12px;
    background: rgba(0, 0, 0, 0.1);
    border: 1px dashed var(--color-separator);
    border-radius: 6px;
    font-size: 11px;
    color: var(--color-foreground-darker);
    line-height: 1.4;
  }

  .profiles-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .browser-profile-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--color-background-light);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    font-size: 11px;
    gap: 12px;
  }

  .prof-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .prof-browser {
    font-weight: 700;
    font-size: 9px;
    padding: 2px 5px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.25);
    color: var(--color-foreground);
  }

  .prof-id {
    font-family: monospace;
    color: var(--color-foreground);
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
    .btn-install {
      transition: none !important;
    }
  }
</style>
