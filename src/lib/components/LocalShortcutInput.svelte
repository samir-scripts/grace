<script lang="ts">
  // Records a single key (no modifiers) as a KeyboardEvent.key string.
  // Used for local (focus-scoped) shortcut bindings.

  import { formatLocalKey } from '$lib/utils/localShortcuts';

  import * as m from '$paraglide/messages.js';

  interface Props {
    label: string;
    disabled?: boolean;
    value?: string;
    onchange?: (value: string) => void;
  }

  let { label, value = '', onchange, disabled = false }: Props = $props();

  let listening = $state(false);
  let recorder: HTMLButtonElement;

  const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock']);

  function onKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (!listening || e.key === 'Tab') return;
    e.preventDefault();

    if (MODIFIER_KEYS.has(e.key)) return;

    onchange?.(e.key);
    listening = false;
  }

</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span class="shortcut-recorder" onfocusout={(event) => {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) listening = false;
}}>
  <button bind:this={recorder} type="button" class="shortcut-input" class:listening {disabled}
    aria-label={label} aria-pressed={listening}
    onclick={() => { listening = true; }}
    onkeydown={onKeydown}>
    {listening ? m.shortcut_recording() : (formatLocalKey(value) || m.shortcut_record())}
  </button>
  {#if listening}
    <button type="button" class="cancel-recording"
      onclick={() => { recorder.focus(); listening = false; }}>{m.shortcut_cancel()}</button>
  {/if}
</span>

<style>
  .shortcut-recorder { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 4px; }
  .cancel-recording { font: inherit; color: var(--color-foreground); background: var(--color-background); border: 1px solid var(--color-border); border-radius: 4px; cursor: pointer; }
  .shortcut-input:focus-visible, .cancel-recording:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
  .shortcut-input {
    background: var(--color-background);
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--color-foreground);
    cursor: pointer;
    font: var(--type-code);
    letter-spacing: 0;
    padding: 4px 8px;
    text-align: center;
    outline: none;
    width: 140px;
    transition: border-color 0.15s;
  }

  .shortcut-input.listening {
    border-color: var(--color-accent);
    cursor: text;
  }

</style>
