<script lang="ts">
  // Records a single key (no modifiers) as a KeyboardEvent.key string.
  // Used for local (focus-scoped) shortcut bindings.

  import { formatLocalKey } from '$lib/utils/localShortcuts';

  interface Props {
    value?: string;
    onchange?: (value: string) => void;
  }

  let { value = '', onchange }: Props = $props();

  let listening = $state(false);

  const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock']);

  function onKeydown(e: KeyboardEvent) {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();

    if (MODIFIER_KEYS.has(e.key)) return;

    onchange?.(e.key);
    listening = false;
  }

  function onFocus() {
    listening = true;
  }
  function onBlur() {
    listening = false;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<input
  class="shortcut-input"
  class:listening
  readonly
  value={formatLocalKey(value)}
  placeholder="Click and press a key…"
  onfocus={onFocus}
  onblur={onBlur}
  onkeydown={onKeydown}
  role="textbox"
  tabindex="0"
/>

<style>
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

  .shortcut-input::placeholder {
    color: var(--color-foreground-darker, var(--color-foreground));
    font: var(--type-support);
    letter-spacing: 0;
  }
</style>
