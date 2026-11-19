<script lang="ts">
  import { onMount } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';

  import { info, warn, error as logError } from '@tauri-apps/plugin-log';
  import { openLogDir, appVersion, checkUpdate, installUpdate } from '$lib/ipc';
  import { settings } from '$lib/stores/settings';
  import type { UpdateInfo } from '$lib/types';
  import * as m from '$paraglide/messages.js';

  const BASE_VERSION = '1.0.0';
  const REPO = 'https://github.com/samir-scripts/grace';
  const UPSTREAM_REPO = 'https://github.com/Splode/pomotroid';

  let version = $state('...');

  type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error';
  let updateState = $state<UpdateState>('idle');
  let availableUpdate = $state<UpdateInfo | null>(null);
  let updateError = $state('');

  // Strip pre-release and build metadata to get the bare X.Y.Z for the release tag URL.
  function baseOnly(v: string): string {
    return v.split('-')[0].split('+')[0];
  }

  let nightlyVersion = $derived(
    /^\d+\.\d+\.\d+-nightly\.\d{8}(?:\.[1-9]\d*)?$/.test(version.split('+')[0])
      ? version.split('+')[0]
      : null
  );

  let releaseUrl = $derived(
    `${REPO}/releases/tag/v${nightlyVersion ?? baseOnly(version === '...' ? BASE_VERSION : version)}`
  );

  onMount(async () => {
    try {
      version = await appVersion();
    } catch {
      version = BASE_VERSION;
    }

    if (!nightlyVersion && $settings.check_for_updates) {
      updateState = 'checking';
      await info('[about] checking for updates');
      try {
        const update = await checkUpdate();
        if (update) {
          availableUpdate = update;
          updateState = 'available';
          await info(`[about] update available: v${update.version}`);
        } else {
          updateState = 'up-to-date';
          await info('[about] already up to date');
        }
      } catch (e) {
        updateError = String(e);
        updateState = 'error';
        await warn(`[about] update check failed: ${e}`);
      }
    }
  });

  async function handleInstall() {
    updateState = 'installing';
    await info(`[about] installing update v${availableUpdate?.version}`);
    try {
      await installUpdate();
    } catch (e) {
      updateError = String(e);
      updateState = 'error';
      await logError(`[about] update install failed: ${e}`);
    }
  }
</script>

<div class="section">
  <div class="hero">
    <img src="/app-icon.png" width="64" height="64" alt="grace. logo" />
    <div>
      <h2 class="name">grace.</h2>
      <p class="version">Version {version}</p>
      <p class="credit">A fork of Pomotroid by Christopher Murphy</p>
    </div>
  </div>
  <div class="links">
    <button class="link-row" onclick={() => openUrl(releaseUrl)}>
      <span>{m.about_release_notes()}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 10L10 2M10 2H4M10 2V8"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <button class="link-row" onclick={() => openUrl(REPO)}>
      <span>{m.about_source_code()}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 10L10 2M10 2H4M10 2V8"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <button class="link-row" onclick={openLogDir}>
      <span>{m.about_open_log_folder()}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M1 3.5C1 2.67 1.67 2 2.5 2H5l1 1.5H9.5C10.33 3.5 11 4.17 11 5v4.5C11 10.33 10.33 11 9.5 11h-7C1.67 11 1 10.33 1 9.5V3.5Z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </div>

  {#if nightlyVersion || $settings.check_for_updates || updateState !== 'idle'}
    <div class="update-group">
      {#if nightlyVersion}
        <div class="update-row update-row--muted">
          <span>{m.about_update_nightly_manual()}</span>
        </div>
      {:else if updateState === 'idle' || updateState === 'checking'}
        <div class="update-row update-row--muted">
          <span>{m.about_update_checking()}</span>
        </div>
      {:else if updateState === 'up-to-date'}
        <div class="update-row update-row--muted">
          <span>{m.about_update_up_to_date()}</span>
        </div>
      {:else if updateState === 'available' && availableUpdate}
        <button class="update-row update-row--action" onclick={handleInstall}>
          <span>{m.about_update_install({ version: availableUpdate.version })}</span>
        </button>
      {:else if updateState === 'installing'}
        <div class="update-row update-row--muted">
          <span>Installing…</span>
        </div>
      {:else if updateState === 'error'}
        <div class="update-row update-row--muted">
          <span>{m.about_update_error()}</span>
        </div>
      {/if}
    </div>
  {/if}

  <p class="credit">
    Built with Tauri, Svelte, and Rust.<br />
    MIT License — Copyright &copy; 2017–2026 Christopher Murphy.
  </p>
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    padding: 32px 20px;
    gap: 24px;
  }

  .hero {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .hero img {
    flex: none;
  }

  .name {
    font-size: 1.1rem;
    font-weight: 400;
    color: var(--color-short-round);
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }

  :global(:root[data-ui-style="glass"][data-window-material="frosted"]) .name {
    color: var(--color-foreground);
  }

  .version {
    font: var(--type-code);
    color: var(--color-foreground-darker, var(--color-foreground));
    letter-spacing: 0;
  }

  .links {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    overflow: hidden;
  }

  .link-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--color-background);
    border: none;
    border-bottom: 1px solid var(--color-separator);
    cursor: pointer;
    color: var(--color-foreground);
    font: var(--type-body);
    letter-spacing: 0;
    text-align: left;
    transition: background 0.12s;
  }

  .link-row:last-child {
    border-bottom: none;
  }

  .link-row:hover {
    background: var(--color-hover);
    color: var(--color-accent);
  }

  .update-group {
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    overflow: hidden;
  }

  .update-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    font: var(--type-body);
    letter-spacing: 0;
  }

  .update-row--muted {
    color: var(--color-foreground-darker, var(--color-foreground));
    opacity: 0.65;
  }

  .update-row--action {
    width: 100%;
    background: var(--color-background);
    border: none;
    cursor: pointer;
    color: var(--color-accent);
    text-align: left;
    transition: background 0.12s;
  }

  .update-row--action:hover {
    background: var(--color-hover);
  }

  .credit {
    font: var(--type-support);
    letter-spacing: 0;
    color: var(--color-foreground-darker, var(--color-foreground));
    opacity: 0.5;
  }
</style>
