<script lang="ts">
  import { tick } from 'svelte';

  interface Option { value: string; label: string; disabled?: boolean }
  interface Props {
    id: string;
    label: string;
    value: string;
    options: Option[];
    disabled?: boolean;
    onchange: (value: string) => void;
  }

  let { id, label, value, options, disabled = false, onchange }: Props = $props();
  let trigger: HTMLButtonElement;
  let popup = $state<HTMLDivElement>();
  let open = $state(false);
  let active = $state(-1);
  let position = $state('');
  let search = '';
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let selected = $derived(options.find((option) => option.value === value));

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  function place() {
    if (!trigger || !popup) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const margin = 4;
    const availableBelow = Math.max(0, topEdge + height - rect.bottom - margin);
    const availableAbove = Math.max(0, rect.top - topEdge - margin);
    const desiredHeight = Math.min(popup.scrollHeight, 240);
    const above = availableBelow < desiredHeight && availableAbove > availableBelow;
    const maxHeight = Math.min(240, above ? availableAbove : availableBelow);
    const popupWidth = Math.min(Math.max(rect.width, 120), Math.max(0, width - margin * 2));
    const left = Math.max(leftEdge + margin, Math.min(rect.left, leftEdge + width - popupWidth - margin));
    const top = above ? Math.max(topEdge + margin, rect.top - Math.min(desiredHeight, maxHeight)) : rect.bottom;
    position = `left:${left}px;top:${top}px;width:${popupWidth}px;max-height:${maxHeight}px`;
  }

  async function show() {
    if (disabled) return;
    active = options.findIndex((option) => option.value === value && !option.disabled);
    if (active < 0) active = options.findIndex((option) => !option.disabled);
    open = true;
    await tick();
    place();
    scrollActive();
  }

  function close(commit = false) {
    if (commit && active >= 0 && options[active] && !options[active].disabled && options[active].value !== value) {
      onchange(options[active].value);
    }
    open = false;
    search = '';
    clearTimeout(searchTimer);
  }

  function scrollActive() {
    void tick().then(() => {
      if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  function move(direction: number, steps = 1) {
    if (!options.some((option) => !option.disabled)) return;
    let index = active;
    for (let count = 0; count < steps; count++) {
      let next = index;
      do { next += direction; } while (next >= 0 && next < options.length && options[next].disabled);
      if (next < 0 || next >= options.length) break;
      index = next;
    }
    active = index;
    scrollActive();
  }

  function typeahead(key: string) {
    search += key.toLocaleLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { search = ''; }, 700);
    const query = [...search].every((char) => char === search[0]) ? search[0] : search;
    const start = query.length === 1 ? active + 1 : Math.max(active, 0);
    for (let i = 0; i < options.length; i++) {
      const index = (start + i) % options.length;
      if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(query)) {
        active = index;
        scrollActive();
        break;
      }
    }
  }

  function keydown(event: KeyboardEvent) {
    if (disabled) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (event.key === 'Tab') { if (open) close(true); return; }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (open) close(true); else void show();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        void show().then(() => {
          if (event.key === 'Home' || event.key === 'End') {
            active = event.key === 'Home'
              ? options.findIndex((option) => !option.disabled)
              : options.findLastIndex((option) => !option.disabled);
            scrollActive();
          }
        });
      } else if (event.key === 'Home' || event.key === 'End') {
        active = event.key === 'Home'
          ? options.findIndex((option) => !option.disabled)
          : options.findLastIndex((option) => !option.disabled);
        scrollActive();
      } else move(event.key === 'ArrowDown' || event.key === 'PageDown' ? 1 : -1, event.key.startsWith('Page') ? 10 : 1);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        void show().then(() => typeahead(event.key));
      } else typeahead(event.key);
    }
  }

  $effect(() => {
    if (disabled && open) close();
  });

  $effect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!trigger.contains(target) && !popup?.contains(target)) close();
    }
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      clearTimeout(searchTimer);
    };
  });
</script>

<button
  bind:this={trigger}
  {id}
  type="button"
  class="themed-select"
  role="combobox"
  aria-label={label}
  aria-expanded={open}
  aria-controls={open ? `${id}-listbox` : undefined}
  aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
  aria-haspopup="listbox"
  {disabled}
  onkeydown={keydown}
  onclick={() => open ? close() : void show()}
><span class="selected-label">{selected?.label ?? ''}</span><span aria-hidden="true">▾</span></button>

{#if open}
  <div use:portal bind:this={popup} id={`${id}-listbox`} role="listbox" aria-label={label} class="themed-options" style={position}>
    {#each options as option, index}
      <div
        id={`${id}-option-${index}`}
        role="option"
        tabindex="-1"
        onkeydown={keydown}
        aria-selected={option.value === value}
        aria-disabled={option.disabled || undefined}
        class:active={index === active}
        class:disabled={option.disabled}
        onpointerdown={(event) => event.preventDefault()}
        onclick={() => { if (!option.disabled) { active = index; close(true); trigger.focus(); } }}
      >{option.label}</div>
    {/each}
  </div>
{/if}

<style>
  .themed-select {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    width: 100%; min-width: 0; padding: 6px 10px;
    background: var(--color-background); color: var(--color-foreground);
    border: 1px solid var(--color-border); border-radius: var(--radius-control, 6px);
    font: inherit; font-size: 12px; text-align: left; cursor: pointer;
    transition: background-color var(--transition-control), border-color var(--transition-control);
  }
  .themed-select:hover:not(:disabled) { background: var(--color-hover); }
  .themed-select:focus-visible { outline: 2px solid var(--color-border); outline-offset: 2px; }
  .themed-select:disabled { opacity: 0.5; cursor: not-allowed; }
  .selected-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .themed-options {
    position: fixed; z-index: 10000; box-sizing: border-box; overflow-y: auto;
    background: var(--color-background-light); color: var(--color-foreground);
    border: 1px solid var(--color-border); border-radius: var(--radius-control, 6px);
    font-size: 12px;
  }
  .themed-options [role='option'] {
    padding: 7px 10px; cursor: pointer; overflow-wrap: anywhere;
    transition: background-color var(--transition-control), color var(--transition-control);
  }
  .themed-options [role='option'].active { background: var(--color-hover); }
  .themed-options [role='option'].disabled { opacity: 0.5; cursor: not-allowed; }
</style>
