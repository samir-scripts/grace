<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { setWindowVisibility } from '$lib/ipc';
  import { activeView, toggleView, showTimerView } from '$lib/stores/navigation';
  import { settings } from '$lib/stores/settings';
  import { isMac } from '$lib/utils/platform';
  import Tooltip from './Tooltip.svelte';
  import * as m from '$paraglide/messages.js';
  import SessionSelector from './SessionSelector.svelte';

  interface Props {
    onEmergencyClick?: () => void;
  }

  let { onEmergencyClick }: Props = $props();

  let maximized = $state(false);
  let suppressTitlebarHover = $state(false);

  function blurTitlebarControl() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.titlebar')) active.blur();
  }

  function suppressRestoredTitlebarState() {
    suppressTitlebarHover = true;
    blurTitlebarControl();
  }

  onMount(() => {
    const win = getCurrentWebviewWindow();
    win.isMaximized().then((v) => {
      maximized = v;
    });
    const unlisten = win.onResized(async () => {
      maximized = await win.isMaximized();
    });
    const clearRestoredTitlebarFocus = () => {
      if (suppressTitlebarHover) requestAnimationFrame(blurTitlebarControl);
    };
    const clearSuppressedTitlebarHover = () => {
      suppressTitlebarHover = false;
    };
    window.addEventListener('focus', clearRestoredTitlebarFocus);
    document.addEventListener('pointermove', clearSuppressedTitlebarHover);
    return () => {
      unlisten.then((fn) => fn());
      window.removeEventListener('focus', clearRestoredTitlebarFocus);
      document.removeEventListener('pointermove', clearSuppressedTitlebarHover);
    };
  });

  function openSettings() {
    toggleView('settings');
  }

  function openStats() {
    toggleView('stats');
  }

  async function minimize() {
    suppressRestoredTitlebarState();
    if ($settings.min_to_tray) {
      await setWindowVisibility(false);
    } else {
      await getCurrentWebviewWindow().minimize();
    }
  }

  function toggleMaximize() {
    getCurrentWebviewWindow().toggleMaximize();
  }

  async function close() {
    suppressRestoredTitlebarState();
    await getCurrentWebviewWindow().close();
  }
</script>

{#snippet backBtn()}
  {#if $activeView !== 'timer'}
    <Tooltip text={m.nav_back_timer()}>
      <button
        type="button"
        class="btn-back"
        class:macos={isMac}
        onclick={showTimerView}
        aria-label={m.nav_back_timer()}
        data-tauri-drag-region="false"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="10 3 5 8 10 13" />
        </svg>
        <span class="back-text">{m.nav_back_timer()}</span>
      </button>
    </Tooltip>
  {/if}
{/snippet}

{#snippet settingsBtn()}
  <Tooltip text={m.tooltip_settings()}>
    <button
      class="btn-icon"
      class:active={$activeView === 'settings'}
      onclick={openSettings}
      aria-label="Settings"
      aria-pressed={$activeView === 'settings'}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <line
          x1="2"
          y1="4"
          x2="14"
          y2="4"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
        <circle
          cx="5"
          cy="4"
          r="1.8"
          fill="var(--color-background)"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <line
          x1="2"
          y1="8"
          x2="14"
          y2="8"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
        <circle
          cx="11"
          cy="8"
          r="1.8"
          fill="var(--color-background)"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <line
          x1="2"
          y1="12"
          x2="14"
          y2="12"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
        <circle
          cx="7"
          cy="12"
          r="1.8"
          fill="var(--color-background)"
          stroke="currentColor"
          stroke-width="1.3"
        />
      </svg>
    </button>
  </Tooltip>
{/snippet}

{#snippet statsBtn()}
  <Tooltip text={m.tooltip_statistics()}>
    <button
      class="btn-icon"
      class:active={$activeView === 'stats'}
      onclick={openStats}
      aria-label="Statistics"
      aria-pressed={$activeView === 'stats'}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="9" width="3" height="5" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="6.5" y="5" width="3" height="9" rx="0.5" fill="currentColor" opacity="0.8" />
        <rect x="11" y="2" width="3" height="12" rx="0.5" fill="currentColor" />
      </svg>
    </button>
  </Tooltip>
{/snippet}

<nav class="titlebar" class:suppress-hover={suppressTitlebarHover} data-tauri-drag-region>
  <!-- Left controls: on macOS, back button appears after the traffic lights (at 68px);
       on Windows/Linux, back button is first, followed by settings + stats. -->
  {#if isMac}
    {@render backBtn()}
  {:else}
    <div class="left-controls">
      {@render backBtn()}
      {@render settingsBtn()}
      {@render statsBtn()}
    </div>
  {/if}

  <div class="center-selector" data-tauri-drag-region="false">
    <SessionSelector {onEmergencyClick} />
  </div>

  <!-- Right: settings + stats buttons on macOS, window controls on Linux/Windows. -->
  <div class="controls">
    {#if isMac}
      {@render statsBtn()}
      {@render settingsBtn()}
    {:else}
      <button class="btn-icon" onclick={minimize} aria-label="Minimize">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line
            x1="1"
            y1="6"
            x2="11"
            y2="6"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button
        class="btn-icon"
        onclick={toggleMaximize}
        aria-label={maximized ? 'Restore' : 'Maximize'}
      >
        {#if maximized}
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect
              x="3"
              y="1"
              width="8"
              height="8"
              rx="1"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path
              d="M1 4 L1 11 L8 11"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        {:else}
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect
              x="1"
              y="1"
              width="10"
              height="10"
              rx="1"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </svg>
        {/if}
      </button>
      <button
        class="btn-icon close"
        onclick={close}
        aria-label="Close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <line
            x1="1"
            y1="1"
            x2="11"
            y2="11"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
          <line
            x1="11"
            y1="1"
            x2="1"
            y2="11"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </button>
    {/if}
  </div>
</nav>

<style>
  .titlebar {
    height: 40px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    position: relative;
    z-index: 20;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-separator);
  }

  .left-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .btn-back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-foreground);
    background: color-mix(in oklch, var(--color-accent) 18%, transparent);
    border: 1px solid color-mix(in oklch, var(--color-accent) 35%, transparent);
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s, border-color 0.12s;
    white-space: nowrap;
  }

  .btn-back.macos {
    margin-left: 68px;
  }

  .btn-back:hover {
    background: color-mix(in oklch, var(--color-accent) 28%, transparent);
    border-color: var(--color-accent);
  }

  .btn-back:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }

  .back-text {
    line-height: 1;
  }

  .controls {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }

  .center-selector {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 25;
  }

  .btn-icon {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-foreground-darker, var(--color-foreground));
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 4px;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .btn-icon.active {
    color: var(--color-foreground);
    background: color-mix(in oklch, var(--color-accent) 22%, transparent);
  }
  .btn-icon:focus {
    outline: none;
  }

  .btn-icon:focus-visible {
    outline: 2px solid color-mix(in oklch, var(--color-foreground) 45%, transparent);
    outline-offset: 2px;
  }

  .titlebar:not(.suppress-hover) .btn-icon:hover {
    color: var(--color-foreground);
    background: var(--color-hover);
  }

  .titlebar:not(.suppress-hover) .btn-icon.close:hover {
    color: var(--color-background);
    background: var(--color-focus-round);
  }
</style>
