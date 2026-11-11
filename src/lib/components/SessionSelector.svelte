<script lang="ts">
  import { onMount } from 'svelte';
  import { focusSnapshot, focusProfiles } from '$lib/stores/focus';
  import { selectFocusProfile } from '$lib/ipc';
  import { openSettingsSection, showTimerView } from '$lib/stores/navigation';
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

  async function handleSelect(id: string) {
    try {
      await selectFocusProfile(id);
      isOpen = false;
      showTimerView();
    } catch (err) {
      console.error('[SessionSelector] failed to select profile:', err);
    }
  }

  function openSettingsSessions() {
    isOpen = false;
    openSettingsSection('timer');
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
      <svg
        class="lock-indicator"
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="7" width="10" height="7" rx="1.5" />
        <path d="M5 7V5a3 3 0 0 1 6 0v2" />
      </svg>
    {/if}
    <span class="session-name">
      {activeProfile ? activeProfile.name : 'Pomodoro'}
    </span>
    {#if !isLocked}
      <span class="chevron" class:rotated={isOpen} aria-hidden="true">▾</span>
    {/if}
  </button>

  {#if isOpen && !isLocked}
    <div class="dropdown-menu" role="listbox">
      {#if profiles.length > 0}
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
              <svg
                class="checkmark"
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
              </svg>
            {/if}
          </button>
        {/each}
      {/if}

      <div class="menu-divider"></div>
      <button class="dropdown-item manage-link" onclick={openSettingsSessions}>
        <svg
          class="manage-icon"
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line x1="2" y1="4" x2="14" y2="4" />
          <circle cx="5" cy="4" r="1.8" />
          <line x1="2" y1="8" x2="14" y2="8" />
          <circle cx="11" cy="8" r="1.8" />
          <line x1="2" y1="12" x2="14" y2="12" />
          <circle cx="7" cy="12" r="1.8" />
        </svg>
        <span>{m.session_manage()}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .session-selector-container {
    position: relative;
    min-width: 0;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    z-index: 50;
    pointer-events: auto;
  }

  .session-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: var(--color-background);
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--color-foreground-darker);
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-snappy), color var(--transition-snappy), border-color var(--transition-snappy), transform 100ms ease-out;
    min-width: 0;
    max-width: min(140px, 100%);
  }

  .session-btn:active:not(.locked) {
    transform: scale(0.97);
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
    color: var(--color-foreground);
    border-color: var(--color-border);
    background: var(--color-background-light);
  }

  .session-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lock-indicator {
    display: block;
    flex-shrink: 0;
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
    background: var(--color-background);
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
  }

  .checkmark {
    display: block;
    flex-shrink: 0;
    color: var(--color-accent, var(--color-foreground));
    margin-left: 6px;
  }

  .menu-divider {
    height: 1px;
    background: var(--color-separator);
    margin: 2px 0;
  }

  .manage-link {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-foreground-darker);
    font-size: 10px;
  }

  .manage-icon {
    display: block;
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .session-btn,
    .chevron,
    .dropdown-item {
      transition: none !important;
      transform: none !important;
    }
  }
</style>
