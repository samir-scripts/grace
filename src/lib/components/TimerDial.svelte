<script lang="ts">
  // SVG arc dial showing timer progress.
  // Replicates the original Pomotroid dial: fills from 0% to 100% as time elapses.
  // Uses Svelte tweened store for smooth animation.
  import { tweened, prefersReducedMotion } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { settings } from '$lib/stores/settings';
  import type { TimerState } from '$lib/types';

  interface Props {
    snap: TimerState;
    countdown?: boolean;
  }

  let { snap, countdown = false }: Props = $props();

  // SVG constants (matching original Pomotroid geometry)
  const CIRCUMFERENCE = 691.15; // 2π × 110 ≈ 691.15
  const BLOCK_RING = 'M18 1H29V6H32V11H35V14H32V19H29V24H7V19H4V14H1V11H4V6H7V1Z';

  // Tweened offset: starts at full circumference (invisible), animates toward 0 (full arc).
  const dashOffset = tweened(CIRCUMFERENCE, { duration: 800, easing: cubicOut });

  // Round-type → CSS custom property for stroke color.
  function strokeColor(rt: string): string {
    if (rt === 'work') return 'var(--color-focus-round)';
    if (rt === 'short-break') return 'var(--color-short-round)';
    return 'var(--color-long-round)';
  }

  // Track previous round to detect round changes and snap the animation.
  // Not reactive — only used for comparison inside $effect.
  let prevRound = $state<string>('');

  $effect(() => {
    const rt = snap.round_type;
    const progress = snap.total_secs > 0 ? snap.elapsed_secs / snap.total_secs : 0;
    const target = countdown ? CIRCUMFERENCE * progress : CIRCUMFERENCE * (1 - progress);
    const motionEnabled = $settings.animations_enabled && !prefersReducedMotion.current;

    if (rt !== prevRound) {
      dashOffset.set(target, { duration: 0 });
      prevRound = rt;
    } else {
      dashOffset.set(target, { duration: motionEnabled ? 800 : 0 });
    }
  });
</script>

<svg class="dial" viewBox={$settings.ui_style === 'blocky' ? '0 25 230 180' : '0 0 230 230'} aria-hidden="true">
  {#if $settings.ui_style === 'blocky'}
    <!-- Logo-inspired stepped centerline; keep the time aperture open. -->
    <g transform="translate(16 46.25) scale(5.5)">
      <path class="block-track" d={BLOCK_RING} fill="none"
        stroke="var(--color-background-light)" stroke-width="2" stroke-linejoin="miter" />
      <path class="block-progress" d={BLOCK_RING} fill="none"
        stroke={strokeColor(snap.round_type)} stroke-width="2"
        stroke-linecap="butt" stroke-linejoin="miter" pathLength="100"
        stroke-dasharray="100" stroke-dashoffset={$dashOffset / CIRCUMFERENCE * 100} />
    </g>
  {:else}
  <!-- Background track -->
  <path
    class="track"
    d="M115,5c60.8,0,110,49.2,110,110s-49.2,110-110,110S5,175.8,5,115S54.2,5,115,5"
    fill="none"
    stroke="var(--color-background-light)"
    stroke-width="2"
  />
  <!-- Progress arc -->
  <path
    class="progress"
    d="M115,5c60.8,0,110,49.2,110,110s-49.2,110-110,110S5,175.8,5,115S54.2,5,115,5"
    fill="none"
    stroke={strokeColor(snap.round_type)}
    stroke-width="10"
    stroke-linecap="round"
    stroke-dasharray={CIRCUMFERENCE}
    stroke-dashoffset={$dashOffset}
  />
  {/if}
</svg>

<style>
  .dial {
    width: var(--timer-dial-width, 220px);
    height: var(--timer-dial-height, 220px);
    display: block;
  }
</style>
