<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listInstalledBrowsers,
    getInstalledApplicationIcon,
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
  let isRefreshing = $state(false);
  let iconCache = $state<Record<string, string | null>>({});
  let loadGeneration = 0;

  function isActive(kind: BrowserKind): boolean {
    return browserSetup?.profiles.some((profile) => profile.browser === kind && profile.is_connected) ?? false;
  }

  async function loadIcon(id: string) {
    if (id in iconCache) return;
    iconCache[id] = null;
    try {
      iconCache[id] = await getInstalledApplicationIcon(id);
    } catch {
      // Icon failures must not prevent browser setup.
    }
  }

  async function handleRefreshAll() {
    if (isRefreshing || mutating !== null) return;
    isRefreshing = true;
    statusMessage = '';
    try {
      await Promise.all([loadBrowsers(), refreshSetup()]);
    } catch (e: any) {
      statusMessage = typeof e === 'string' ? e : (e?.message || 'Failed to refresh browsers');
      statusType = 'error';
    } finally {
      isRefreshing = false;
    }
  }


  onMount(() => {
    loadBrowsers();
    refreshSetup();
    const interval = setInterval(refreshSetup, 3000);
    return () => { clearInterval(interval); loadGeneration++; };
  });

  async function loadBrowsers() {
    try {
      // Safari has no supported companion installation.
      const generation = ++loadGeneration;
      const browsers = (await listInstalledBrowsers()).filter((browser) => browser.kind !== 'safari');
      if (generation !== loadGeneration) return;
      installedBrowsers = browsers;
      await Promise.all(browsers.map((browser) => browser.catalog_id ? loadIcon(browser.catalog_id) : Promise.resolve()));
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
    if (isLocked || mutating !== null) return;
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

  async function assignProfile(profileId: string, browser: BrowserKind, required: boolean) {
    try {
      await requireBrowserProfile(profileId, browser, required);
    } catch (e: any) {
      statusMessage = typeof e === 'string' ? e : (e?.message || 'Failed to assign browser');
      statusType = 'error';
    } finally {
      await refreshSetup();
    }
  }
</script>

<div class="browser-setup-container">
  <div class="header-group">
    <div class="title-row">
      <h3 class="group-title">{m.browser_companions_title()}</h3>
      <button
        type="button"
        class="btn-refresh"
        class:spinning={isRefreshing}
        onclick={handleRefreshAll}
        disabled={isRefreshing || mutating !== null}
        title={m.browser_refresh_button()}
        aria-label={m.browser_refresh_button()}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 8A6 6 0 1 1 9.5 2.5L14 3"></path>
          <path d="M14 3V7H10"></path>
        </svg>
      </button>
    </div>
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
            {#if browser.catalog_id && iconCache[browser.catalog_id]}
              <img
                class="browser-icon"
                src={iconCache[browser.catalog_id] ?? ''}
                alt=""
                onerror={() => { if (browser.catalog_id) iconCache[browser.catalog_id] = null; }}
              />
            {:else}
              <svg class="browser-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <ellipse cx="12" cy="12" rx="4" ry="9" />
                <path d="M3 12h18" />
              </svg>
            {/if}
          </div>
          <div class="browser-text">
            <span class="browser-name">{browser.name}</span>
            <span class="browser-status">
              {#if browser.is_default}
                <span class="badge default-badge">{m.browser_is_default()}</span>
              {/if}
              {#if browser.is_installed}
                <span class="badge installed">{m.browser_status_installed()}</span>
              {:else}
                <span class="badge not-installed">{m.browser_status_not_installed()}</span>
              {/if}
              {#if isActive(browser.kind)}
                <span class="badge active"><span class="connection-dot" aria-hidden="true"></span>{m.browser_status_active()}</span>
              {/if}
            </span>
            {#if browser.kind === 'chrome' && browser.is_installed && !isActive(browser.kind)}
              <p class="chrome-unpacked-hint">{m.browser_chrome_unpacked_hint()}</p>
            {/if}
          </div>
        </div>

        {#if browser.is_extension_installed}
          <div class="browser-actions">
          <button
            type="button"
            class="btn-install"
            disabled={mutating !== null || isLocked}
            title={isLocked ? m.browser_locked_hint() : undefined}
            onclick={() => handleInstall(browser)}
          >
            {#if mutating?.kind === browser.kind && mutating?.action === 'install'}
              {m.browser_installing()}
            {:else}
              {m.browser_update_button()}
            {/if}
          </button>
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
          </div>
        {:else}
          <button
            type="button"
            class="btn-install"
            disabled={mutating !== null || isLocked}
            title={isLocked ? m.browser_locked_hint() : undefined}
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
  <p class="anti-bypass-note">{m.browser_anti_bypass_note()}</p>
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
                <label>
                  <span>{m.browser_assign_browser()}</span>
                  <select
                    value={prof.browser ?? ''}
                    disabled={isLocked}
                    onchange={(event) => {
                      const browser = event.currentTarget.value as BrowserKind;
                      if (browser) assignProfile(prof.profile_id, browser, prof.is_required);
                    }}
                  >
                    <option value="">{m.browser_choose_browser()}</option>
                    {#each installedBrowsers.filter((browser) => browser.is_installed) as browser}
                      <option value={browser.kind}>{browser.name}</option>
                    {/each}
                  </select>
                </label>
                <span class="prof-id">{prof.profile_id}</span>
                {#if prof.is_connected}
                  <span class="badge active"><span class="connection-dot" aria-hidden="true"></span>{m.browser_status_active()}</span>
                {:else}
                  <span class="badge offline">{m.browser_status_offline()}</span>
                {/if}
              </div>
              {#if !prof.browser}<p>{m.browser_assignment_hint()}</p>{/if}
              <label class="req-toggle">
                <input
                  type="checkbox"
                  checked={prof.is_required}
                  disabled={!prof.browser || (isLocked && activeSessionId === editingSessionId)}
                  onchange={() => { if (prof.browser) toggleRequireProfile(prof.profile_id, prof.browser, prof.is_required); }}
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
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .btn-refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: var(--color-background);
    border: 1px solid color-mix(in oklch, var(--color-foreground) 15%, transparent);
    border-radius: 4px;
    color: var(--color-foreground-darker);
    cursor: pointer;
    transition: background-color var(--transition-snappy), color var(--transition-snappy), border-color var(--transition-snappy);
  }

  .btn-refresh:hover:not(:disabled) {
    color: var(--color-foreground);
    border-color: color-mix(in oklch, var(--color-foreground) 30%, transparent);
    background: var(--color-background-light);
  }

  .btn-refresh:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-refresh.spinning svg {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .badge.default-badge {
    background: var(--color-background-light);
    color: var(--color-foreground);
  }

  .anti-bypass-note {
    font-size: 11px;
    color: var(--color-foreground-darker);
    line-height: 1.4;
    margin: 4px 0 0;
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
    background: var(--color-background-light);
    border: 1px solid var(--color-short-round);
    color: var(--color-foreground);
  }

  .alert.error {
    background: var(--color-background-light);
    border: 1px solid var(--color-focus-round);
    color: var(--color-foreground);
  }

  .browser-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .browser-card {
    display: flex;
    flex-wrap: wrap;
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
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-foreground);
  }

  .browser-icon {
    object-fit: contain;
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
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .chrome-unpacked-hint {
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-foreground-darker);
    margin: 4px 0 0;
    word-break: break-word;
  }


  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    font-size: 9px;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .badge.installed {
    background: var(--color-browser-installed-bg);
    color: var(--color-browser-installed-text);
  }

  .badge.not-installed {
    background: var(--color-background-light);
    color: var(--color-foreground-darker);
  }

  .badge.active {
    background: var(--color-browser-active-bg);
    color: var(--color-browser-active-text);
  }

  .connection-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  .badge.offline {
    background: var(--color-background-light);
    color: var(--color-foreground-darker);
  }

  .browser-actions { display: flex; flex-wrap: wrap; gap: 8px; }

  .btn-install {
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 600;
    background: var(--color-button);
    color: var(--color-button-text);
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
    background: var(--color-background);
    color: var(--color-foreground);
    border: 1px solid var(--color-focus-round);
  }

  .btn-install.btn-remove:hover:not(:disabled) {
    background: var(--color-background-light);
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
    .browser-actions { display: flex; flex-wrap: wrap; gap: 8px; }

  .btn-install {
      transition: none !important;
    }
  }
</style>
