<script lang="ts">
  // A labelled toggle-switch row with an independent help control.
  import TooltipInfo from '$lib/components/TooltipInfo.svelte';

  interface Props {
    label: string;
    checked: boolean;
    description?: string;
    tooltip?: string;
    disabled?: boolean;
    onclick: () => void;
  }

  let { label, checked, description, tooltip, disabled = false, onclick }: Props = $props();

</script>

<div class="settings-toggle" class:has-help={!!tooltip}>
  <button
    type="button"
    class="switch-content"
    {onclick}
    {disabled}
    role="switch"
    aria-checked={checked}
    aria-label={label}
  >
    <span class="text">
      <span class="label">{label}</span>
      {#if description}
        <span class="desc">{description}</span>
      {/if}
    </span>
    <span class="toggle" class:on={checked} aria-hidden="true"></span>
  </button>
  {#if tooltip}
    <span class="switch-help"><TooltipInfo text={tooltip} /></span>
  {/if}
</div>

<style>
  .settings-toggle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: var(--color-background);
    border: none;
    border-bottom: 1px solid var(--color-separator);
    cursor: pointer;
    text-align: left;
    gap: 16px;
    transition: background-color var(--transition-control);
  }

  .switch-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex: 1;
    min-width: 0;
    padding: 10px 20px;
    background: transparent;
    border: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .has-help .text {
    padding-inline-end: 26px;
  }

  .switch-help {
    position: absolute;
    inset-inline-end: 61px;
    inset-block: 0;
    display: flex;
    align-items: center;
    pointer-events: none;
  }

  .switch-help :global(.info-icon) {
    pointer-events: auto;
  }

  .switch-content:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .settings-toggle:hover {
    background: var(--color-hover);
  }
  .switch-content:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font: var(--type-control);
    color: var(--color-foreground);
    letter-spacing: 0;
  }

  .desc {
    font: var(--type-support);
    color: var(--color-foreground-darker, var(--color-foreground));
    letter-spacing: 0;
  }

  /* Pill toggle */
  .toggle {
    position: relative;
    width: 34px;
    height: 18px;
    border-radius: 9px;
    /* Use a foreground-tinted track so it's visible on both dark and light themes
       (rgba(255,255,255,0.15) vanishes on light backgrounds). */
    background: var(--color-background-light);
    border: 1px solid var(--color-border);
    flex-shrink: 0;
    transition: background-color var(--transition-control);
  }

  .toggle::after {
    content: '';
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    /* OFF state: use a muted foreground tone so the thumb is visible against
       the subtle foreground-tinted track without being overly bright. */
    background: var(--color-foreground-darker, var(--color-foreground));
    top: 3px;
    left: 3px;
    transition:
      transform var(--transition-toggle),
      background-color var(--transition-control);
  }

  .toggle.on {
    background: var(--color-button);
  }

  .toggle.on::after {
    transform: translateX(16px);
    /* ON state: the background color is always chosen by the theme designer to
       contrast with the accent, so it reads cleanly and stays within the palette.
       e.g. dark navy on teal (Pomotroid), dark charcoal on yellow (Gruvbox). */
    background: var(--color-button-text);
  }
</style>
