<script lang="ts">
  // Orchestrator component. Subscribes to timer events, owns keyboard listener,
  // and renders TimerDial + TimerDisplay + TimerFooter.
  import { timerToggle, timerRestartRound, timerSkip } from '$lib/ipc';
  import { timerState } from '$lib/stores/timer';
  import { settings } from '$lib/stores/settings';
  import { fade } from 'svelte/transition';
  import TimerDial from './TimerDial.svelte';
  import TimerDisplay from './TimerDisplay.svelte';
  import TimerFooter from './TimerFooter.svelte';
  import MiniControls from './MiniControls.svelte';
  import Tooltip from './Tooltip.svelte';
  import FocusEnforcementNotice from './FocusEnforcementNotice.svelte';
  import * as m from '$paraglide/messages.js';
  interface Props {
    isCompact?: boolean;
    uiScale?: number;
  }

  let { isCompact = false, uiScale = 1 }: Props = $props();

  let state = $derived($timerState);

  function roundColor(rt: string): string {
    if (rt === 'work') return 'var(--color-focus-round)';
    if (rt === 'short-break') return 'var(--color-short-round)';
    return 'var(--color-long-round)';
  }

  function roundLabel(rt: string): string {
    if (rt === 'work') return m.round_label_work();
    if (rt === 'short-break') return m.round_label_short_break();
    return m.round_label_long_break();
  }

</script>

<div class="timer-outer" class:compact={isCompact}>
  <div class="timer" style="zoom: {uiScale}">
    <!-- Dial + display stacked (display centered over dial) -->
    <div class="dial-stack">
      <TimerDial snap={state} countdown={$settings.dial_countdown} />
      <TimerDisplay {state} />
    </div>

    {#if !isCompact}
      <!-- Round type label sits below the dial as a normal flex child so it
           does not affect the dial-stack height used to centre TimerDisplay. -->
      <div class="round-label" style="color: {roundColor(state.round_type)}">
        {roundLabel(state.round_type)}
      </div>

      <FocusEnforcementNotice />

      <div class="controls-wrapper">
        <!-- Back: restart current round -->
        <Tooltip text={m.tooltip_restart_round()}>
          <button class="btn-side" onclick={timerRestartRound} aria-label="Restart round">
            <svg width="18" height="18" viewBox="0 0 16 16">
              <polygon points="15,1 6,8 15,15" fill="currentColor" />
              <rect x="1" y="1" width="3" height="14" rx="1" fill="currentColor" />
            </svg>
          </button>
        </Tooltip>

        <!-- Play / Pause — icon fades when state changes -->
        <button
          class="play-pause"
          onclick={timerToggle}
          aria-label={state.is_running ? 'Pause' : 'Play'}
        >
          {#key state.is_running}
            <span class="icon" in:fade={{ duration: 120 }}>
              {#if state.is_running}
                <svg width="24" height="24" viewBox="0 0 24 24">
                  <rect x="5" y="3" width="5" height="18" rx="1.5" fill="currentColor" />
                  <rect x="14" y="3" width="5" height="18" rx="1.5" fill="currentColor" />
                </svg>
              {:else}
                <svg width="18" height="18" viewBox="0 0 24 24" style="overflow: visible;">
                  <polygon points="4,0 28,12 4,24" fill="currentColor" />
                </svg>
              {/if}
            </span>
          {/key}
        </button>

        <!-- Skip: advance to next round -->
        <Tooltip text={m.tooltip_skip()}>
          <button class="btn-side" onclick={timerSkip} aria-label="Skip round">
            <svg width="18" height="18" viewBox="0 0 16 16">
              <polygon points="1,1 10,8 1,15" fill="currentColor" />
              <rect x="12" y="1" width="3" height="14" rx="1" fill="currentColor" />
            </svg>
          </button>
        </Tooltip>

        <TimerFooter snap={state} />
      </div>
    {/if}
  </div>

  {#if isCompact}
    <MiniControls />
  {/if}
</div>

<style>
  .timer-outer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .timer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .dial-stack {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .controls-wrapper {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px 12px;
  }
  .controls-wrapper > :global(*) {
    aspect-ratio: 1;
  }

  .btn-side {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-foreground-darker, var(--color-foreground));
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    transition:
      color var(--transition-default),
      background var(--transition-default);
  }

  .btn-side:hover {
    color: var(--color-foreground);
    background: var(--color-hover);
  }

  .play-pause {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-foreground);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 2px solid var(--color-foreground-darker, var(--color-foreground));
    transition:
      color var(--transition-default),
      border-color var(--transition-default),
      background var(--transition-default);
    overflow: hidden; /* clip the fading icon within the circle */
  }

  .play-pause:hover {
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: var(--color-hover);
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .round-label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    /* Collapse the gap above: the flex gap already provides spacing from the dial. */
    margin-top: -8px;
  }
</style>
