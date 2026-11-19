<script lang="ts">
  import Tooltip from './Tooltip.svelte';
  import * as m from '$paraglide/messages.js';

  interface Props {
    text: string;
    label?: string;
  }

  let { text, label }: Props = $props();
</script>

<Tooltip {text} delay={0}>
  <button type="button" class="info-icon" aria-label={label ?? m.tooltip_more_information()}>
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="5.75" stroke="currentColor" stroke-width="1.5" />
      <circle cx="6.5" cy="4" r="0.9" fill="currentColor" />
      <line
        x1="6.5"
        y1="6"
        x2="6.5"
        y2="10"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  </button>
</Tooltip>

<style>
  .info-icon {
    display: inline-flex;
    background: transparent;
    border: 0;
    padding: 0;
    align-items: center;
    justify-content: center;
    color: var(--color-foreground);
    cursor: default;
    margin-left: 5px;
    transition: opacity 0.15s;
    user-select: none;
    flex-shrink: 0;
  }

  .info-icon:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .info-icon:hover {
    opacity: 1;
  }
</style>
