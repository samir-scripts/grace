<script lang="ts">
  import { onMount } from 'svelte';
  import {
    onRoundChange,
    onSessionsCleared,
    statsGetDetailed,
    statsGetHeatmap,
  } from '$lib/ipc';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import type { DetailedStats, HeatmapStats } from '$lib/types';
  import * as m from '$paraglide/messages.js';
  import { error as logError } from '@tauri-apps/plugin-log';

  import DailyView from '$lib/components/stats/DailyView.svelte';
  import WeeklyView from '$lib/components/stats/WeeklyView.svelte';
  import YearlyView from '$lib/components/stats/YearlyView.svelte';

  type Tab = 'today' | 'week' | 'alltime';

  let activeTab = $state<Tab>('today');
  let hasSwitchedTab = $state(false);
  let detailed = $state<DetailedStats | null>(null);
  let heatmap = $state<HeatmapStats | null>(null);
  let detailedStatus = $state<'loading' | 'ready' | 'error'>('loading');
  let heatmapStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let mounted = false;
  let detailedRequest = 0;
  let heatmapRequest = 0;

  async function loadDetailed() {
    const request = ++detailedRequest;
    if (detailedStatus !== 'ready') detailedStatus = 'loading';
    try {
      const result = await statsGetDetailed();
      if (mounted && request === detailedRequest) {
        detailed = result;
        detailedStatus = 'ready';
      }
    } catch (e) {
      if (mounted && request === detailedRequest) detailedStatus = 'error';
      void logError(`[stats section] failed to load statistics: ${e}`);
    }
  }

  async function loadHeatmap() {
    const request = ++heatmapRequest;
    if (heatmapStatus !== 'ready') heatmapStatus = 'loading';
    try {
      const result = await statsGetHeatmap();
      if (mounted && request === heatmapRequest) {
        heatmap = result;
        heatmapStatus = 'ready';
      }
    } catch (e) {
      if (mounted && request === heatmapRequest) heatmapStatus = 'error';
      void logError(`[stats section] failed to load heatmap: ${e}`);
    }
  }

  function switchTab(tab: Tab) {
    if (tab !== activeTab) {
      hasSwitchedTab = true;
      activeTab = tab;
    }
    if (tab === 'alltime' && heatmapStatus === 'idle') void loadHeatmap();
  }

  onMount(() => {
    const cleanups: UnlistenFn[] = [];
    mounted = true;
    void loadDetailed();
    const refresh = () => {
      void loadDetailed();
      if (heatmapStatus !== 'idle') void loadHeatmap();
    };
    void Promise.all([onRoundChange(refresh), onSessionsCleared(refresh)])
      .then((unlisteners) => {
        if (mounted) cleanups.push(...unlisteners);
        else unlisteners.forEach((fn) => fn());
      })
      .catch((e) => void logError(`[stats section] failed to subscribe: ${e}`));
    return () => {
      mounted = false;
      detailedRequest++;
      heatmapRequest++;
      cleanups.forEach((fn) => fn());
    };
  });
</script>

<div class="stats-section">
  <!-- Tab bar -->
  <div class="tabs">
    <button
      type="button"
      class="tab"
      class:active={activeTab === 'today'}
      aria-pressed={activeTab === 'today'}
      onclick={() => switchTab('today')}
    >
      {m.stats_tab_today()}
    </button>
    <button
      type="button"
      class="tab"
      class:active={activeTab === 'week'}
      aria-pressed={activeTab === 'week'}
      onclick={() => switchTab('week')}
    >
      {m.stats_tab_week()}
    </button>
    <button
      type="button"
      class="tab"
      class:active={activeTab === 'alltime'}
      aria-pressed={activeTab === 'alltime'}
      onclick={() => switchTab('alltime')}
    >
      {m.stats_tab_alltime()}
    </button>
  </div>

  <!-- Content -->
  {#key activeTab}
    <div class="content" class:view-enter={hasSwitchedTab}>
      {#if (activeTab === 'alltime' ? heatmapStatus : detailedStatus) === 'loading' || (activeTab === 'alltime' && heatmapStatus === 'idle')}
        <div class="state" role="status">{m.stats_loading()}</div>
      {:else if (activeTab === 'alltime' ? heatmapStatus : detailedStatus) === 'error'}
        <div class="state" role="alert">
          <span>{m.stats_load_error()}</span>
          <button type="button" onclick={() => (activeTab === 'alltime' ? loadHeatmap() : loadDetailed())}
            >{m.stats_retry()}</button
          >
        </div>
      {:else if activeTab === 'today'}
        <DailyView today={detailed?.today ?? null} />
      {:else if activeTab === 'week'}
        <WeeklyView week={detailed?.week ?? null} streak={detailed?.streak ?? null} />
      {:else}
        <YearlyView {heatmap} />
      {/if}
    </div>
  {/key}
</div>

<style>
  .stats-section {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    cursor: default;
  }

  /* ── Tabs ──────────────────────────────────────────────── */
  .tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--color-separator);
    flex-shrink: 0;
    padding: 0 clamp(0px, 2vw, 20px);
    background: var(--color-background);
  }

  .tab {
    background: var(--color-background);
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    flex: 1 1 0;
    min-width: 0;
    padding: 10px 4px;
    overflow-wrap: anywhere;
    font: var(--type-control);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-foreground-darker);
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .tab:hover {
    color: var(--color-foreground);
  }

  .tab.active {
    color: var(--color-foreground);
    font-weight: 500;
    border-bottom-color: var(--color-focus-round);
  }

  .state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--color-foreground-darker);
    font: var(--type-support);
  }
  .state button {
    font: inherit;
    color: var(--color-foreground);
    background: var(--color-background-light);
    border: 1px solid var(--color-separator);
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
  }

  /* ── Content ───────────────────────────────────────────── */
  .content {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
