<script lang="ts">
  import { onMount } from 'svelte';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { isMac } from '$lib/utils/platform';
  import { focusSnapshot, focusProfiles } from '$lib/stores/focus';
  import { selectFocusProfile, navigateSettings } from '$lib/ipc';
  import * as m from '$paraglide/messages.js';

  interface Props {
    onEmergencyClick?: () => void;
  }

  let { onEmergencyClick }: Props = $props();

  let isOpen = $state(false);
  let isLocked = $derived($focusSnapshot.is_locked);
  let activeProfile = $derived($focusSnapshot.active_profile);
  let profiles = $derived($focusProfiles);

  function toggleDropdown(e: MouseEvent) {
    e.stopPropagation();
    if (isLocked) {
      if (onEmergencyClick) onEmergencyClick();
      return;
    }
    isOpen = !isOpen;
  }

  async function handleSelect(id: string | null) {
    try {
      await selectFocusProfile(id);
      isOpen = false;
    } catch (err) {
      console.error('[SessionSelector] failed to select profile:', err);
    }
  }

  async function openSettingsSessions() {
    isOpen = false;
    const existing = await WebviewWindow.getByLabel('settings');
    if (existing) {
      await navigateSettings('timer', 'sessions');
      await existing.show();
      await existing.setFocus();
      return;
    }
    new WebviewWindow('settings', {
      url: '/settings?tab=sessions',
      title: 'Pomotroid — Settings',
      width: 720,
      height: 520,
      decorations: isMac,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      titleBarStyle: isMac ? ('Overlay' as any) : undefined,
      hiddenTitle: isMac ? true : undefined,
      resizable: false,
      visible: false,
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      isOpen = false;
      const btn = document.querySelector('.session-btn') as HTMLElement | null;
      btn?.focus();
    }
  }

  onMount(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('.session-selector-container')) {
        isOpen = false;
      }
    }
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<div class="session-selector-container" data-tauri-drag-region="false">
  <button
    class="session-btn"
    class:locked={isLocked}
    class:active={isOpen}
    onclick={toggleDropdown}
    title={isLocked ? m.session_locked() : m.session_select()}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
  >
    {#if isLocked}
      <span class="lock-indicator" aria-hidden="true">🔒</span>
    {/if}
    <span class="session-name">
      {activeProfile ? activeProfile.name : m.session_none()}
    </span>
    {#if !isLocked}
      <span class="chevron" class:rotated={isOpen} aria-hidden="true">▾</span>
    {/if}
  </button>

  {#if isOpen && !isLocked}
    <div class="dropdown-menu" role="listbox">
      <button
        class="dropdown-item"
        class:selected={!activeProfile}
        role="option"
        aria-selected={!activeProfile}
        onclick={() => handleSelect(null)}
      >
        <span class="item-name">{m.session_none()}</span>
        {#if !activeProfile}
          <span class="checkmark">✓</span>
        {/if}
      </button>

      {#if profiles.length > 0}
        <div class="menu-divider"></div>
        {#each profiles as profile (profile.id)}
          {@const isSelected = activeProfile?.id === profile.id}
          <button
            class="dropdown-item"
            class:selected={isSelected}
            role="option"
            aria-selected={isSelected}
            onclick={() => handleSelect(profile.id)}
          >
            <div class="profile-info">
              <span class="item-name">{profile.name}</span>
              <span class="item-meta">
                {Math.round(profile.work_secs / 60)}m • {profile.work_rounds} {m.timer_slider_rounds().toLowerCase()}
              </span>
            </div>
            {#if isSelected}
              <span class="checkmark">✓</span>
            {/if}
          </button>
        {/each}
      {/if}

      <div class="menu-divider"></div>
      <button class="dropdown-item manage-link" onclick={openSettingsSessions}>
        <span>⚙️ {m.session_manage()}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .session-selector-container {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    z-index: 50;
  }

  .session-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--color-foreground-darker);
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-snappy), color var(--transition-snappy), border-color var(--transition-snappy);
    max-width: 140px;
  }

  .session-btn:hover {
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  .session-btn.active {
    background: var(--color-hover);
    color: var(--color-foreground);
    border-color: var(--color-separator);
  }

  .session-btn.locked {
    color: var(--color-focus-round);
    border-color: color-mix(in oklch, var(--color-focus-round) 30%, transparent);
    background: color-mix(in oklch, var(--color-focus-round) 10%, transparent);
  }

  .session-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lock-indicator {
    font-size: 10px;
    line-height: 1;
  }

  .chevron {
    font-size: 9px;
    transition: transform var(--transition-snappy);
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    min-width: 180px;
    max-width: 240px;
    max-height: calc(100vh - 56px);
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--color-background-light);
    border: 1px solid var(--color-separator);
    border-radius: 8px;
    box-shadow: 0 8px 24px color-mix(in oklch, black 25%, transparent);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 100;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--color-foreground-darker);
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background var(--transition-snappy), color var(--transition-snappy);
  }

  .dropdown-item:hover {
    background: var(--color-hover);
    color: var(--color-foreground);
  }

  .dropdown-item.selected {
    color: var(--color-foreground);
    font-weight: 600;
  }

  .profile-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
  }

  .item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-meta {
    font-size: 9px;
    color: var(--color-foreground-darker);
    opacity: 0.7;
  }

  .checkmark {
    font-size: 11px;
    color: var(--color-accent, var(--color-foreground));
    margin-left: 6px;
  }

  .menu-divider {
    height: 1px;
    background: var(--color-separator);
    margin: 2px 0;
  }

  .manage-link {
    color: var(--color-foreground-darker);
    font-size: 10px;
    opacity: 0.9;
  }
</style>
