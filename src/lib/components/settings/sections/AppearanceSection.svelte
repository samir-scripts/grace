<script lang="ts">
  import { onMount } from 'svelte';
  import type { Theme } from '$lib/types';
  import { settings } from '$lib/stores/settings';
  import { applyTheme } from '$lib/stores/theme';
  import { getThemes, setSetting, onThemesChanged } from '$lib/ipc';
  import { resolveThemeName, getLightThemes, getDarkThemes } from '$lib/utils/theme';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import * as m from '$paraglide/messages.js';
  import SettingsToggle from '$lib/components/settings/SettingsToggle.svelte';
  import AppearanceCustomization from '$lib/components/settings/AppearanceCustomization.svelte';

  let themes = $state<Theme[]>([]);
  let osDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);
  // Accordion: at most one picker open at a time.
  let openPicker = $state<'light' | 'dark' | null>(null);

  // Light picker is active when mode='light', or mode='auto' and OS is light.
  let lightIsActive = $derived(
    $settings.theme_mode === 'light' || ($settings.theme_mode === 'auto' && !osDark)
  );
  // Dark picker is active when mode='dark', or mode='auto' and OS is dark.
  let darkIsActive = $derived(
    $settings.theme_mode === 'dark' || ($settings.theme_mode === 'auto' && osDark)
  );

  let selectedLightTheme = $derived(themes.find((t) => t.name === $settings.theme_light));
  let selectedDarkTheme = $derived(themes.find((t) => t.name === $settings.theme_dark));

  let lightThemes = $derived(getLightThemes(themes));
  let darkThemes = $derived(getDarkThemes(themes));
  function togglePicker(picker: 'light' | 'dark') {
    openPicker = openPicker === picker ? null : picker;
  }

  onMount(() => {
    const cleanups: UnlistenFn[] = [];

    // Track live OS color scheme changes to update picker highlights.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const mqListener = (e: MediaQueryListEvent) => {
      osDark = e.matches;
    };
    mq.addEventListener('change', mqListener);
    cleanups.push(() => mq.removeEventListener('change', mqListener));

    (async () => {
      themes = await getThemes();
      cleanups.push(
        await onThemesChanged((updated) => {
          themes = updated;
        })
      );
    })();

    return () => {
      for (const fn of cleanups) fn();
    };
  });

  type PaletteKey = 'theme_mode' | 'theme_light' | 'theme_dark';
  let savingPalette = $state(false);
  let paletteError = $state<PaletteKey | null>(null);

  function applyPalette(preferences: typeof $settings) {
    const name = resolveThemeName(preferences, osDark);
    const theme = themes.find((candidate) => candidate.name === name);
    if (theme) applyTheme(theme);
  }

  async function savePalette(key: PaletteKey, value: string) {
    if (savingPalette || value === $settings[key]) return;
    savingPalette = true;
    paletteError = null;
    applyPalette({ ...$settings, [key]: value });
    try {
      const updated = await setSetting(key, value);
      settings.set(updated);
      applyPalette(updated);
    } catch {
      applyPalette($settings);
      paletteError = key;
    } finally {
      savingPalette = false;
    }
  }

  let savingAnimations = $state(false);
  let animationsSaveError = $state<string | null>(null);

  async function toggleAnimations() {
    if (savingAnimations) return;
    savingAnimations = true;
    animationsSaveError = null;
    const target = !$settings.animations_enabled;
    try {
      const updated = await setSetting('animations_enabled', String(target));
      settings.set(updated);
    } catch {
      animationsSaveError = m.appearance_animations_save_error();
    } finally {
      savingAnimations = false;
    }
  }
</script>

<div class="section">
  <AppearanceCustomization />
  <!-- Mode selector -->
  <div class="group-label">{m.appearance_group_mode()}</div>
  <div class="mode-selector" role="group" aria-label={m.appearance_group_mode()}>
    <button
      type="button"
      class="mode-btn"
      aria-disabled={savingPalette}
      class:active={$settings.theme_mode === 'auto'}
      aria-pressed={$settings.theme_mode === 'auto'}
      onclick={() => savePalette('theme_mode', 'auto')}
      aria-label={m.appearance_mode_auto()}
      title={m.appearance_mode_auto()}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </svg>
    </button>
    <button
      type="button"
      class="mode-btn"
      aria-disabled={savingPalette}
      class:active={$settings.theme_mode === 'light'}
      aria-pressed={$settings.theme_mode === 'light'}
      onclick={() => savePalette('theme_mode', 'light')}
      aria-label={m.appearance_mode_light()}
      title={m.appearance_mode_light()}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="5" fill="currentColor" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    </button>
    <button
      type="button"
      class="mode-btn"
      aria-disabled={savingPalette}
      class:active={$settings.theme_mode === 'dark'}
      aria-pressed={$settings.theme_mode === 'dark'}
      onclick={() => savePalette('theme_mode', 'dark')}
      aria-label={m.appearance_mode_dark()}
      title={m.appearance_mode_dark()}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" />
      </svg>
    </button>
  </div>

  {#if paletteError === 'theme_mode'}
    <p class="palette-error" role="alert">{m.appearance_customization_error()}</p>
  {/if}

  <!-- Light theme picker -->
  <div class="picker-group">
    <button
      class="picker-trigger"
      class:open={openPicker === 'light'}
      aria-expanded={openPicker === 'light'}
      aria-controls="light-theme-choices"
      onclick={() => togglePicker('light')}
    >
      <span class="trigger-label">
        {m.appearance_group_light_theme()}
      </span>
      <span class="trigger-preview">
        <span class="preview-name">{$settings.theme_light}</span>
        {#if selectedLightTheme}
          {@const bg = selectedLightTheme.colors['--color-background'] ?? '#2f384b'}
          {@const focusRound = selectedLightTheme.colors['--color-focus-round'] ?? '#e25d60'}
          {@const shortRound = selectedLightTheme.colors['--color-short-round'] ?? '#3baf82'}
          {@const longRound = selectedLightTheme.colors['--color-long-round'] ?? '#3d85c8'}
          <span class="preview-swatches" style="background:{bg}">
            <span class="swatch" style="background:{focusRound}"></span>
            <span class="swatch" style="background:{shortRound}"></span>
            <span class="swatch" style="background:{longRound}"></span>
          </span>
        {/if}
      </span>
      <svg
        class="chevron"
        class:rotated={openPicker === 'light'}
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M7 10l5 5 5-5z" />
      </svg>
    </button>
    {#if paletteError === 'theme_light'}
      <p class="palette-error" role="alert">{m.appearance_customization_error()}</p>
    {/if}
    <div id="light-theme-choices" class="theme-list" hidden={openPicker !== 'light'}>
        {#each lightThemes as theme (theme.name)}
          {@const bg = theme.colors['--color-background'] ?? '#2f384b'}
          {@const fg = theme.colors['--color-foreground'] ?? '#d7e1f4'}
          {@const accent = theme.colors['--color-accent'] ?? '#e25d60'}
          {@const focusRound = theme.colors['--color-focus-round'] ?? '#e25d60'}
          {@const shortRound = theme.colors['--color-short-round'] ?? '#3baf82'}
          {@const longRound = theme.colors['--color-long-round'] ?? '#3d85c8'}
          {@const isSelected = theme.name === $settings.theme_light}
          <button
            class="card"
            class:selected={isSelected}
            class:highlighted={isSelected && lightIsActive}
            style="--card-bg:{bg}; --card-fg:{fg}; --card-accent:{accent};"
            aria-pressed={isSelected}
            aria-disabled={savingPalette}
            onclick={() => savePalette('theme_light', theme.name)}
          >
            <span class="swatches">
              <span class="swatch" style="background:{focusRound}"></span>
              <span class="swatch" style="background:{shortRound}"></span>
              <span class="swatch" style="background:{longRound}"></span>
            </span>
            <span class="card-name" style="color:{fg}">{theme.name}</span>
            <span class="card-right">
              {#if theme.is_custom}
                <span class="badge" style="color:{accent}">{m.appearance_badge_custom()}</span>
              {/if}
              {#if isSelected}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  style="fill:{accent}; flex-shrink:0;"
                >
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                </svg>
              {/if}
            </span>
          </button>
        {/each}
    </div>
  </div>

  <!-- Dark theme picker -->
  <div class="picker-group">
    <button
      class="picker-trigger"
      class:open={openPicker === 'dark'}
      aria-expanded={openPicker === 'dark'}
      aria-controls="dark-theme-choices"
      onclick={() => togglePicker('dark')}
    >
      <span class="trigger-label">
        {m.appearance_group_dark_theme()}
      </span>
      <span class="trigger-preview">
        <span class="preview-name">{$settings.theme_dark}</span>
        {#if selectedDarkTheme}
          {@const bg = selectedDarkTheme.colors['--color-background'] ?? '#2f384b'}
          {@const focusRound = selectedDarkTheme.colors['--color-focus-round'] ?? '#e25d60'}
          {@const shortRound = selectedDarkTheme.colors['--color-short-round'] ?? '#3baf82'}
          {@const longRound = selectedDarkTheme.colors['--color-long-round'] ?? '#3d85c8'}
          <span class="preview-swatches" style="background:{bg}">
            <span class="swatch" style="background:{focusRound}"></span>
            <span class="swatch" style="background:{shortRound}"></span>
            <span class="swatch" style="background:{longRound}"></span>
          </span>
        {/if}
      </span>
      <svg
        class="chevron"
        class:rotated={openPicker === 'dark'}
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M7 10l5 5 5-5z" />
      </svg>
    </button>
    {#if paletteError === 'theme_dark'}
      <p class="palette-error" role="alert">{m.appearance_customization_error()}</p>
    {/if}
    <div id="dark-theme-choices" class="theme-list" hidden={openPicker !== 'dark'}>
        {#each darkThemes as theme (theme.name)}
          {@const bg = theme.colors['--color-background'] ?? '#2f384b'}
          {@const fg = theme.colors['--color-foreground'] ?? '#d7e1f4'}
          {@const accent = theme.colors['--color-accent'] ?? '#e25d60'}
          {@const focusRound = theme.colors['--color-focus-round'] ?? '#e25d60'}
          {@const shortRound = theme.colors['--color-short-round'] ?? '#3baf82'}
          {@const longRound = theme.colors['--color-long-round'] ?? '#3d85c8'}
          {@const isSelected = theme.name === $settings.theme_dark}
          <button
            class="card"
            class:selected={isSelected}
            class:highlighted={isSelected && darkIsActive}
            style="--card-bg:{bg}; --card-fg:{fg}; --card-accent:{accent};"
            aria-pressed={isSelected}
            aria-disabled={savingPalette}
            onclick={() => savePalette('theme_dark', theme.name)}
          >
            <span class="swatches">
              <span class="swatch" style="background:{focusRound}"></span>
              <span class="swatch" style="background:{shortRound}"></span>
              <span class="swatch" style="background:{longRound}"></span>
            </span>
            <span class="card-name" style="color:{fg}">{theme.name}</span>
            <span class="card-right">
              {#if theme.is_custom}
                <span class="badge" style="color:{accent}">{m.appearance_badge_custom()}</span>
              {/if}
              {#if isSelected}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  style="fill:{accent}; flex-shrink:0;"
                >
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                </svg>
              {/if}
            </span>
          </button>
        {/each}
    </div>
  </div>

  <SettingsToggle
    label={m.appearance_animations()}
    description={m.appearance_animations_desc()}
    checked={$settings.animations_enabled}
    disabled={savingAnimations}
    onclick={toggleAnimations}
  />
  {#if animationsSaveError}
    <div class="alert error" role="alert">{animationsSaveError}</div>
  {/if}
</div>

<style>
  .theme-list[hidden] { display: none; }
  .palette-error { margin: 4px 12px; font: var(--type-support); color: var(--color-status-error); }

  .section {
    display: flex;
    flex-direction: column;
  }

  .alert.error {
    margin: 8px 20px;
    padding: 8px 12px;
    font: var(--type-support);
    letter-spacing: 0;
    border-radius: 4px;
    background: var(--color-background-light);
    border: 1px solid var(--color-focus-round);
    color: var(--color-foreground);
  }

  .group-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font: var(--type-eyebrow);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-foreground-darker, var(--color-foreground));
    margin: 0;
    padding: 16px 20px 6px;
  }


  /* Mode selector */
  .mode-selector {
    display: flex;
    margin: 0 20px 4px;
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    overflow: hidden;
  }

  .mode-btn {
    flex: 1;
    padding: 6px 0;
    background: var(--color-background);
    border: none;
    border-right: 1px solid var(--color-separator);
    font: var(--type-control);
    letter-spacing: 0;
    color: var(--color-foreground-darker, var(--color-foreground));
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .mode-btn:last-child {
    border-right: none;
  }

  .mode-btn:hover {
    background: color-mix(in oklch, var(--color-background) 88%, var(--color-foreground) 12%);
  }

  .mode-btn.active {
    background: var(--color-background-light);
    color: var(--color-foreground);
    font-weight: 500;
  }

  /* Collapsible picker groups */
  .picker-group {
    margin: 8px 20px 0;
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    overflow: hidden;
  }

  .picker-group:last-child {
    margin-bottom: 12px;
  }

  .picker-trigger {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 9px 12px;
    background: var(--color-background);
    border: none;
    cursor: pointer;
    gap: 8px;
    transition: background 0.12s;
  }

  .picker-trigger:hover {
    background: color-mix(in oklch, var(--color-background) 88%, var(--color-foreground) 12%);
  }

  .picker-trigger.open {
    border-bottom: 1px solid var(--color-separator);
  }

  .trigger-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font: var(--type-eyebrow);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-foreground-darker, var(--color-foreground));
    flex-shrink: 0;
  }

  .trigger-preview {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    justify-content: flex-end;
    min-width: 0;
  }

  .preview-swatches {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
    padding: 4px 6px;
    border-radius: 4px;
  }

  .preview-name {
    font: var(--type-support);
    letter-spacing: 0;
    color: var(--color-foreground-darker, var(--color-foreground));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .chevron {
    flex-shrink: 0;
    color: var(--color-foreground-darker, var(--color-foreground));
    transition: transform 0.15s;
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  /* Theme list */
  .theme-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px 10px;
  }

  .card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: var(--card-bg);
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .card:hover {
    background: color-mix(in srgb, var(--card-bg) 88%, white 12%);
  }

  /* selected but NOT the active picker: dimmed border */
  .card.selected {
    border-color: color-mix(in oklch, var(--card-accent) 40%, transparent);
  }

  /* selected AND the active picker: full accent border + checkmark shown */
  .card.highlighted {
    border-color: var(--card-accent);
  }

  .swatches {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid color-mix(in oklch, var(--color-foreground) 14%, transparent);
  }

  .card-name {
    font: var(--type-control);
    letter-spacing: 0;
    flex: 1;
  }

  .card-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .badge {
    font: var(--type-eyebrow);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.8;
  }
</style>
