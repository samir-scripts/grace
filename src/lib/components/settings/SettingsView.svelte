<script lang="ts">
  import SessionsSection from '$lib/components/settings/sections/SessionsSection.svelte';
  import AppearanceSection from '$lib/components/settings/sections/AppearanceSection.svelte';
  import NotificationsSection from '$lib/components/settings/sections/NotificationsSection.svelte';
  import ShortcutsSection from '$lib/components/settings/sections/ShortcutsSection.svelte';
  import SystemSection from '$lib/components/settings/sections/SystemSection.svelte';
  import AboutSection from '$lib/components/settings/sections/AboutSection.svelte';
  import { activeSettingsSection, type SettingsSectionId } from '$lib/stores/navigation';
  import * as m from '$paraglide/messages.js';

  const SECTIONS: { id: SettingsSectionId; label: () => string }[] = [
    { id: 'timer', label: m.nav_timer_sessions },
    { id: 'appearance', label: m.nav_appearance },
    { id: 'notifications', label: m.nav_notifications },
    { id: 'shortcuts', label: m.nav_shortcuts },
    { id: 'system', label: m.nav_system },
    { id: 'about', label: m.nav_about },
  ];
</script>

<div class="settings-view">
  <!-- Navigation: responsive top bar (<560px) or left sidebar (>=560px) -->
  <aside class="sidebar">
    <div class="nav-list" role="tablist">
      {#each SECTIONS as section (section.id)}
        <button
          type="button"
          role="tab"
          class="nav-item"
          class:active={$activeSettingsSection === section.id}
          aria-selected={$activeSettingsSection === section.id}
          onclick={() => activeSettingsSection.set(section.id)}
        >
          {section.label()}
        </button>
      {/each}
    </div>
  </aside>

  <!-- Section content -->
  <main class="content" class:no-scroll={$activeSettingsSection === 'timer'}>
    {#if $activeSettingsSection === 'timer'}
      <SessionsSection />
    {:else if $activeSettingsSection === 'appearance'}
      <AppearanceSection />
    {:else if $activeSettingsSection === 'notifications'}
      <NotificationsSection />
    {:else if $activeSettingsSection === 'shortcuts'}
      <ShortcutsSection />
    {:else if $activeSettingsSection === 'system'}
      <SystemSection />
    {:else if $activeSettingsSection === 'about'}
      <AboutSection />
    {/if}
  </main>
</div>

<style>
  .settings-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--color-background);
  }

  /* Responsive navigation */
  .sidebar {
    flex-shrink: 0;
    background: var(--color-background);
    border-bottom: 1px solid var(--color-separator);
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0;
  }

  .nav-list {
    display: flex;
    flex-direction: row;
    gap: 0;
    width: max-content;
    min-width: 100%;
  }

  .nav-item {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 9px 14px;
    background: var(--color-background);
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 0.78rem;
    font-weight: 500;
    letter-spacing: 0.03em;
    color: var(--color-foreground-darker, var(--color-foreground));
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
    transition:
      color 0.12s,
      background 0.12s,
      border-color 0.12s;
  }

  .nav-item:hover {
    color: var(--color-foreground);
    background: var(--color-hover);
  }

  .nav-item.active {
    color: var(--color-foreground);
    border-bottom-color: var(--color-accent);
    background: var(--color-hover);
    font-weight: 600;
  }

  /* Content pane */
  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
  }

  .content.no-scroll {
    overflow: hidden;
  }

  /* Wider window layout: sidebar on the left */
  @media (min-width: 560px) {
    .settings-view {
      flex-direction: row;
    }

    .sidebar {
      width: 165px;
      border-bottom: none;
      border-right: 1px solid var(--color-separator);
      overflow-x: hidden;
      overflow-y: auto;
      padding: 8px 0;
    }

    .nav-list {
      flex-direction: column;
      width: 100%;
      min-width: 0;
    }

    .nav-item {
      justify-content: flex-start;
      border-bottom: none;
      border-left: 3px solid transparent;
      padding: 9px 16px;
      font-size: 0.85rem;
    }

    .nav-item.active {
      border-left-color: var(--color-accent);
      border-bottom-color: transparent;
    }
  }
</style>
