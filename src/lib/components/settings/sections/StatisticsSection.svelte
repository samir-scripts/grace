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
  import { showTimerView } from '$lib/stores/navigation';

  import DailyView from '$lib/components/stats/DailyView.svelte';
  import WeeklyView from '$lib/components/stats/WeeklyView.svelte';
  import YearlyView from '$lib/components/stats/YearlyView.svelte';

  type Tab = 'today' | 'week' | 'alltime';

  let activeTab = $state<Tab>('today');
  let detailed = $state<DetailedStats | null>(null);
  let heatmap = $state<HeatmapStats | null>(null);
  let heatmapLoaded = $state(false);

  async function switchTab(tab: Tab) {
    activeTab = tab;
    if (tab === 'alltime' && !heatmapLoaded) {
      try {
        heatmap = await statsGetHeatmap();
        heatmapLoaded = true;
      } catch (e) {
        await logError(`[stats section] failed to load heatmap: ${e}`);
      }
    }
  }

  onMount(() => {
    const cleanups: UnlistenFn[] = [];
    let mounted = true;

    (async () => {
      try {
        const res = await statsGetDetailed();
        if (mounted) detailed = res;
      } catch (e) {
        await logError(`[stats section] initialization failed: ${e}`);
      }

      const unlisteners = await Promise.all([
        onRoundChange(async () => {
          try {
            detailed = await statsGetDetailed();
            if (heatmapLoaded) heatmap = await statsGetHeatmap();
          } catch (e) {
            await logError(`[stats section] failed to refresh stats after round change: ${e}`);
          }
        }),
        onSessionsCleared(async () => {
          try {
            detailed = await statsGetDetailed();
            if (heatmapLoaded) heatmap = await statsGetHeatmap();
          } catch (e) {
            await logError(`[stats section] failed to refresh stats after session clear: ${e}`);
          }
        })
      ]);

      if (!mounted) {
        for (const fn of unlisteners) fn();
      } else {
        cleanups.push(...unlisteners);
      }
    })();

    return () => {
      mounted = false;
      for (const fn of cleanups) fn();
    };
  });
</script>

<div class="stats-section">
  <!-- Tab bar -->
  <div class="tabs">
    <button
      type="button"
      class="tab-back"
      onclick={showTimerView}
      aria-label={m.nav_back_timer()}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="10 3 5 8 10 13" />
      </svg>
      <span>{m.nav_back_timer()}</span>
    </button>
    <button
      class="tab"
      class:active={activeTab === 'today'}
      onclick={() => switchTab('today')}
    >
      {m.stats_tab_today()}
    </button>
    <button
      type="button"
      class="tab"
      class:active={activeTab === 'week'}
      onclick={() => switchTab('week')}
    >
      {m.stats_tab_week()}
    </button>
    <button
      type="button"
      class="tab"
      class:active={activeTab === 'alltime'}
      onclick={() => switchTab('alltime')}
    >
      {m.stats_tab_alltime()}
    </button>
  </div>

  <!-- Content -->
  <div class="content">
    {#if activeTab === 'today'}
      <DailyView today={detailed?.today ?? null} />
    {:else if activeTab === 'week'}
      <WeeklyView week={detailed?.week ?? null} streak={detailed?.streak ?? null} />
    {:else}
      <YearlyView {heatmap} />
    {/if}
  </div>
</div>

<style>
  .stats-section {
    display: flex;
    flex-direction: column;
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
    padding: 0 20px;
    background: var(--color-background);
  }
  .tab-back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 12px;
    margin: 8px 12px 8px 0;
    background: color-mix(in oklch, var(--color-accent) 15%, transparent);
    border: 1px solid color-mix(in oklch, var(--color-accent) 30%, transparent);
    border-radius: 4px;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--color-foreground);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    font-family: inherit;
  }
  .tab-back:hover {
    background: color-mix(in oklch, var(--color-accent) 25%, transparent);
    border-color: var(--color-accent);
  }
  .tab-back:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 10px 18px;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-foreground-darker);
    cursor: pointer;
    font-family: inherit;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .tab:hover {
    color: var(--color-foreground);
  }

  .tab.active {
    color: var(--color-focus-round);
    border-bottom-color: var(--color-focus-round);
  }

  /* ── Content ───────────────────────────────────────────── */
  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
