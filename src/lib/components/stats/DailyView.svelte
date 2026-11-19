<script lang="ts">
  import type { DailyStats } from '$lib/types';
  import * as m from '$paraglide/messages.js';
  import { getLocale } from '$paraglide/runtime.js';

  let { today }: { today: DailyStats | null } = $props();

  const CHART_H = 80; // px, max bar height in the hourly chart
  const CHART_W = 744; // px, total SVG width for 24 bars
  const BAR_W = 22; // px per bar
  const BAR_GAP = 9; // px between bars

  function fmtTime(mins: number): string {
    const unit = (value: number, name: 'hour' | 'minute') =>
      new Intl.NumberFormat(getLocale(), { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    return hours
      ? [unit(hours, 'hour'), ...(minutes ? [unit(minutes, 'minute')] : [])].join(' ')
      : unit(minutes, 'minute');
  }

  function fmtHour(hour: number): string {
    return new Intl.DateTimeFormat(getLocale(), { hour: 'numeric' }).format(new Date(2000, 0, 1, hour));
  }

  function fmtRate(rate: number | null): string {
    if (rate === null) return '—';
    return `${Math.round(rate * 100)}%`;
  }

  const byHour = $derived(today?.by_hour ?? Array(24).fill(0));
  const maxHour = $derived(Math.max(1, ...byHour));
  const hasData = $derived(today !== null && today.rounds > 0);

  // Hour labels: show every 6 hours
  const hourLabels = [0, 6, 12, 18];
</script>

<div class="view">
  <!-- Stat cards -->
  <div class="cards">
    <div class="card" style="--delay: 0ms">
      <span class="card-label">{m.stats_rounds()}</span>
      <span class="card-value">{today?.rounds ?? '—'}</span>
    </div>
    <div class="card-divider"></div>
    <div class="card" style="--delay: 60ms">
      <span class="card-label">{m.stats_focus_time()}</span>
      <span class="card-value">{today ? fmtTime(today.focus_mins) : '—'}</span>
    </div>
    <div class="card-divider"></div>
    <div class="card" style="--delay: 120ms">
      <span class="card-label">{m.stats_completion()}</span>
      <span class="card-value">{today ? fmtRate(today.completion_rate) : '—'}</span>
    </div>
  </div>

  <!-- Hourly breakdown -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">{m.stats_sessions_by_hour()}</span>
      {#if !hasData}
        <span class="empty-hint">{m.stats_no_sessions_today()}</span>
      {/if}
    </div>

    <div class="chart-wrap">
      <svg
        width={CHART_W}
        height={CHART_H + 28}
        viewBox="0 0 {CHART_W} {CHART_H + 28}"
        class="chart"
      >
        {#each byHour as count, h}
          {@const barH = Math.max(2, Math.round((count / maxHour) * CHART_H))}
          {@const x = h * (BAR_W + BAR_GAP)}
          {@const y = CHART_H - barH}

          <!-- Bar -->
          <rect
            {x}
            {y}
            width={BAR_W}
            height={barH}
            rx="2"
            class="bar"
            class:bar-empty={count === 0}
            style="--bar-scale: {barH / CHART_H}; --bar-delay: {h * 18}ms"
          />

          <!-- Hour label (every 6 hours) -->
          {#if hourLabels.includes(h)}
            <text x={x + BAR_W / 2} y={CHART_H + 18} text-anchor={h === 0 ? 'start' : 'middle'} class="hour-label"
              >{fmtHour(h)}</text
            >
          {/if}
        {/each}

        <!-- Baseline -->
        <line x1="0" y1={CHART_H} x2={CHART_W} y2={CHART_H} class="baseline" />
      </svg>
    </div>
  </div>
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 100%;
    min-width: 0;
    padding: 0;
  }

  /* ── Stat cards ──────────────────────────────────────────── */
  .cards {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--color-separator);
  }

  .card {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: clamp(14px, 3vh, 28px) clamp(8px, 2vw, 24px);
    animation: card-rise 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: var(--delay, 0ms);
  }

  @keyframes card-rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .card-label {
    text-align: center;
    overflow-wrap: anywhere;
    font: var(--type-eyebrow);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-foreground-darker);
  }

  .card-value {
    overflow-wrap: anywhere;
    text-align: center;
    font-size: clamp(1.4rem, 6vw, 2.4rem);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: normal;
    color: var(--color-foreground);
    line-height: 1.15;
  }

  .card-divider {
    width: 1px;
    background: var(--color-separator);
    align-self: stretch;
    margin: 12px 0;
  }

  /* ── Section ─────────────────────────────────────────────── */
  .section {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px 24px 16px;
    gap: 12px;
    min-width: 0;
    flex-shrink: 0;
  }

  .section-header {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 12px;
  }

  .section-title {
    font: var(--type-eyebrow);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-foreground-darker);
  }

  .empty-hint {
    font: var(--type-support);
    letter-spacing: normal;
    color: var(--color-foreground-darker);
    font-style: italic;
  }

  /* ── Hourly chart ────────────────────────────────────────── */
  .chart-wrap {
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .chart {
    display: block;
    flex: none;
    width: 744px;
    max-width: none;
    height: auto;
  }

  .bar {
    fill: var(--color-focus-round);
    opacity: 0.85;
    transform-origin: bottom;
    transform-box: fill-box;
    animation: bar-rise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: var(--bar-delay, 0ms);
  }

  @keyframes bar-rise {
    from {
      transform: scaleY(0.05);
      opacity: 0;
    }
    to {
      transform: scaleY(1);
      opacity: 0.85;
    }
  }

  .bar-empty {
    fill: color-mix(in oklch, var(--color-foreground) 8%, transparent);
    animation: none;
  }

  .hour-label {
    fill: var(--color-foreground-darker);
    font-size: 12px;
    font-weight: 400;
    letter-spacing: normal;
    font-variant-numeric: tabular-nums;
    cursor: default;
  }

  @media (max-width: 320px) {
    .cards { flex-direction: column; }
    .card-divider { width: auto; height: 1px; margin: 0 12px; }
  }

  .baseline {
    stroke: var(--color-separator);
    stroke-width: 1;
  }
</style>
