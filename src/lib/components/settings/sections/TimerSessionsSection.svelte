<script lang="ts">
  import TimerSection from './TimerSection.svelte';
  import SessionsSection from './SessionsSection.svelte';
  import * as m from '$paraglide/messages.js';

  interface Props {
    activeTab?: 'defaults' | 'sessions';
    onTabChange?: (tab: 'defaults' | 'sessions') => void;
  }

  let { activeTab = $bindable('defaults'), onTabChange }: Props = $props();

  let tabButtons: HTMLButtonElement[] = [];

  function setTab(tab: 'defaults' | 'sessions') {
    activeTab = tab;
    if (onTabChange) onTabChange(tab);
  }

  function handleKeydown(e: KeyboardEvent, index: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const next = (index + 1) % 2;
      tabButtons[next]?.focus();
      setTab(next === 0 ? 'defaults' : 'sessions');
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const prev = (index - 1 + 2) % 2;
      tabButtons[prev]?.focus();
      setTab(prev === 0 ? 'defaults' : 'sessions');
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      tabButtons[0]?.focus();
      setTab('defaults');
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      tabButtons[1]?.focus();
      setTab('sessions');
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      setTab(index === 0 ? 'defaults' : 'sessions');
    }
  }
</script>

<div class="timer-sessions-wrapper">
  <div class="tabs-header" role="tablist" aria-label={m.nav_timer_sessions()}>
    <button
      bind:this={tabButtons[0]}
      role="tab"
      id="tab-defaults"
      aria-controls="panel-defaults"
      aria-selected={activeTab === 'defaults'}
      tabindex={activeTab === 'defaults' ? 0 : -1}
      class="tab-btn"
      class:active={activeTab === 'defaults'}
      onclick={() => setTab('defaults')}
      onkeydown={(e) => handleKeydown(e, 0)}
    >
      {m.timer_sessions_tab_defaults()}
    </button>
    <button
      bind:this={tabButtons[1]}
      role="tab"
      id="tab-saved"
      aria-controls="panel-saved"
      aria-selected={activeTab === 'sessions'}
      tabindex={activeTab === 'sessions' ? 0 : -1}
      class="tab-btn"
      class:active={activeTab === 'sessions'}
      onclick={() => setTab('sessions')}
      onkeydown={(e) => handleKeydown(e, 1)}
    >
      {m.timer_sessions_tab_saved()}
    </button>
  </div>

  <div class="tab-panels">
    <div
      role="tabpanel"
      id="panel-defaults"
      aria-labelledby="tab-defaults"
      class="tab-panel scrollable-panel"
      class:hidden={activeTab !== 'defaults'}
    >
      <TimerSection />
    </div>

    <div
      role="tabpanel"
      id="panel-saved"
      aria-labelledby="tab-saved"
      class="tab-panel layout-panel"
      class:hidden={activeTab !== 'sessions'}
    >
      <SessionsSection />
    </div>
  </div>
</div>

<style>
  .timer-sessions-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .tabs-header {
    display: flex;
    gap: 8px;
    padding: 12px 20px 8px;
    border-bottom: 1px solid var(--color-separator);
    flex-shrink: 0;
    background: var(--color-background);
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 6px 12px;
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--color-foreground-darker, var(--color-foreground));
    cursor: pointer;
    transition:
      color var(--transition-snappy),
      border-color var(--transition-snappy);
    outline: none;
  }

  .tab-btn:hover {
    color: var(--color-foreground);
  }

  .tab-btn.active {
    color: var(--color-accent);
    border-bottom-color: var(--color-accent);
    font-weight: 600;
  }

  .tab-btn:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .tab-panels {
    flex: 1;
    min-height: 0;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .tab-panel {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .tab-panel.hidden {
    display: none !important;
  }

  .scrollable-panel {
    overflow-y: auto;
    overflow-x: hidden;
  }

  .layout-panel {
    overflow: hidden;
  }
</style>
