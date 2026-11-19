<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppTarget, InstalledApplication } from '$lib/types';
  import { getInstalledApplications, getInstalledApplicationIcon } from '$lib/ipc';
  import * as m from '$paraglide/messages.js';

  interface Props {
    targets: AppTarget[];
    onChange: (targets: AppTarget[]) => void;
    disabled?: boolean;
  }

  let { targets = [], onChange, disabled = false }: Props = $props();

  let isOpen = $state(false);
  let pickerButton: HTMLButtonElement;
  let searchQuery = $state('');
  let isLoading = $state(false);
  let errorMessage = $state<string | null>(null);
  let catalog = $state<InstalledApplication[]>([]);
  let warnings = $state<string[]>([]);
  let iconCache = $state<Record<string, string | null>>({});

  let filteredApps = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (app) =>
        app.name.toLowerCase().includes(q) ||
        app.identifier.toLowerCase().includes(q) ||
        app.path.toLowerCase().includes(q)
    );
  });

  async function loadApplications(force = false) {
    if (catalog.length > 0 && !force) return;
    isLoading = true;
    errorMessage = null;
    try {
      const res = await getInstalledApplications();
      catalog = res.applications;
      warnings = res.warnings;
      // Pre-fetch icons for top visible items in background
      for (const app of catalog.slice(0, 40)) {
        fetchIcon(app.id);
      }
    } catch (err: any) {
      errorMessage = err?.message || String(err) || m.apps_load_error();
    } finally {
      isLoading = false;
    }
  }

  async function fetchIcon(id: string) {
    if (id in iconCache) return;
    try {
      const icon = await getInstalledApplicationIcon(id);
      iconCache[id] = icon;
    } catch {
      iconCache[id] = null;
    }
  }

  function togglePicker() {
    if (disabled) return;
    isOpen = !isOpen;
    if (isOpen && catalog.length === 0) {
      loadApplications();
    }
  }

  function closePicker() {
    isOpen = false;
    pickerButton?.focus();
  }

  function isSelected(app: InstalledApplication): boolean {
    return targets.some((t) => t.identifier === app.identifier);
  }

  function toggleApp(app: InstalledApplication) {
    if (disabled) return;
    if (isSelected(app)) {
      onChange(targets.filter((t) => t.identifier !== app.identifier));
    } else {
      const newTarget: AppTarget = {
        id: app.id,
        name: app.name,
        identifier: app.identifier,
        platform: (app.platform as 'macos' | 'windows' | 'all') || 'all',
      };
      onChange([...targets, newTarget]);
      // Ensure icon is loaded for target chip
      fetchIcon(app.id);
    }
  }

  function removeTarget(target: AppTarget) {
    if (disabled) return;
    onChange(targets.filter((t) => t.id !== target.id && t.identifier !== target.identifier));
  }

  // Load icons for targets already blocked
  $effect(() => {
    if (catalog.length > 0) {
      for (const t of targets) {
        const found = catalog.find((c) => c.identifier === t.identifier);
        if (found) fetchIcon(found.id);
      }
    }
  });

  $effect(() => { if (disabled) isOpen = false; });

  function getTargetIcon(t: AppTarget): string | null {
    if (t.id in iconCache && iconCache[t.id]) return iconCache[t.id];
    const match = catalog.find((c) => c.identifier === t.identifier);
    if (match && match.id in iconCache) return iconCache[match.id];
    return null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      closePicker();
    }
  }

  onMount(() => {
    loadApplications();
  });
</script>

<svelte:document onkeydown={handleKeydown} />

<div class="app-picker-container">
  <!-- Action toolbar to open dropdown -->
  <div class="picker-toolbar">
    <button
      bind:this={pickerButton}
      type="button"
      class="btn-select-apps"
      class:active={isOpen}
      {disabled}
      onclick={togglePicker}
      aria-expanded={isOpen}
      aria-controls={isOpen ? "installed-app-panel" : undefined}
    >
      <span class="btn-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="5" height="5" rx="1"></rect>
          <rect x="9" y="2" width="5" height="5" rx="1"></rect>
          <rect x="2" y="9" width="5" height="5" rx="1"></rect>
          <rect x="9" y="9" width="5" height="5" rx="1"></rect>
        </svg>
      </span>
      <span>{m.apps_select()}</span>
      <span class="chevron" class:rotated={isOpen}>▾</span>
    </button>

    {#if isOpen}
      <button
        type="button"
        class="btn-refresh"
        onclick={() => loadApplications(true)}
        title={m.apps_refresh()}
        aria-label={m.apps_refresh()}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 8A6 6 0 1 1 9.5 2.5L14 3"></path>
          <path d="M14 3V7H10"></path>
        </svg>
      </button>
    {/if}
  </div>

  <!-- Dropdown Panel -->
  {#if isOpen}
    <div id="installed-app-panel" class="picker-panel" role="region" aria-label={m.apps_select()}>
      <div class="search-box">
        <svg class="search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="7" cy="7" r="5"></circle>
          <line x1="11" y1="11" x2="15" y2="15"></line>
        </svg>
        <input
          type="text"
          class="search-input"
          bind:value={searchQuery}
          placeholder={m.apps_search()}
          aria-label={m.apps_search()}
        />
        {#if searchQuery}
          <button class="clear-search" onclick={() => (searchQuery = '')} aria-label={m.apps_clear_search()}>×</button>
        {/if}
      </div>

      {#if warnings.length > 0}
        <div class="partial-warning" title={warnings.join('\n')}>
          <svg
            class="warning-icon"
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2L1.5 13.5h13L8 2z" />
            <line x1="8" y1="6.5" x2="8" y2="9.5" />
            <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
          </svg>
          <span>{m.apps_partial()}</span>
        </div>
      {/if}

      <div class="apps-list">
        {#if isLoading && catalog.length === 0}
          <div class="loading-state">
            <span class="spinner"></span>
            <span>{m.apps_loading()}</span>
          </div>
        {:else if errorMessage}
          <div class="error-state">
            <span>{errorMessage}</span>
            <button type="button" class="btn-retry" onclick={() => loadApplications(true)}>
              {m.apps_retry()}
            </button>
          </div>
        {:else if filteredApps.length === 0}
          <div class="empty-state">
            <span>{catalog.length === 0 ? m.apps_empty() : m.apps_no_results()}</span>
          </div>
        {:else}
          {#each filteredApps as app (app.id)}
            {@const checked = isSelected(app)}
            {@const icon = iconCache[app.id]}
            <button
              type="button"
              class="app-row"
              class:checked
              aria-pressed={checked}
              onclick={() => toggleApp(app)}
              onmouseenter={() => fetchIcon(app.id)}
            >
              <span class="app-checkbox" aria-hidden="true">{checked ? '✓' : ''}</span>
              <div class="app-icon-slot">
                {#if icon}
                  <img src={icon} alt="" class="app-logo" />
                {:else}
                  <div class="app-fallback-icon">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 1v8h10V4H3z"/>
                    </svg>
                  </div>
                {/if}
              </div>
              <div class="app-details">
                <span class="app-title">{app.name}</span>
                <span class="app-meta">{app.identifier}</span>
              </div>
            </button>
          {/each}
        {/if}
      </div>

      <div class="picker-footer">
        <span class="selection-count">
          {m.apps_selected_count({ count: String(targets.length) })}
        </span>
        <button type="button" class="btn-done" onclick={closePicker}>
          {m.apps_close()}
        </button>
      </div>
    </div>
  {/if}

  <!-- Target chips row showing currently blocked applications -->
  <div class="chip-container">
    {#each targets as target (target.id || target.identifier)}
      {@const icon = getTargetIcon(target)}
      <div class="app-chip">
        {#if icon}
          <img src={icon} alt="" class="chip-logo" />
        {:else}
          <span class="chip-default-icon">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 1v8h10V4H3z"/>
            </svg>
          </span>
        {/if}
        <span class="chip-name">{target.name}</span>
        <button
          type="button"
          class="chip-remove"
          {disabled}
          onclick={() => removeTarget(target)}
          title={m.apps_remove({ name: target.name })}
          aria-label={m.apps_remove({ name: target.name })}
        >
          ×
        </button>
      </div>
    {/each}
    {#if targets.length === 0}
      <span class="empty-hint">{m.apps_none_selected()}</span>
    {/if}
  </div>
</div>

<style>
  .app-picker-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }

  .picker-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .btn-select-apps {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: var(--color-background-light);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    padding: 6px 12px;
    color: var(--color-foreground);
    font: var(--type-control);
    font-weight: 500;
    letter-spacing: 0;
    cursor: pointer;
    transition: background 140ms ease-out, border-color 140ms ease-out, transform 100ms ease-out;
  }

  @media (hover: hover) {
    .btn-select-apps:hover:not(:disabled) {
      background: var(--color-hover);
      border-color: color-mix(in oklch, var(--color-foreground) 20%, transparent);
    }
  }

  .btn-select-apps:active:not(:disabled) {
    transform: scale(0.98);
  }

  .btn-select-apps:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-select-apps.active {
    border-color: var(--color-accent);
    background: color-mix(in oklch, var(--color-accent) 12%, var(--color-background));
  }

  .btn-icon {
    display: flex;
    align-items: center;
    color: var(--color-foreground-darker);
  }

  .chevron {
    font-size: 9px;
    margin-left: 2px;
    transition: transform 140ms ease-out;
    color: var(--color-foreground-darker);
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  .btn-refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: var(--color-background);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    color: var(--color-foreground-darker);
    cursor: pointer;
    transition: background 140ms ease-out, color 140ms ease-out, transform 100ms ease-out;
  }

  @media (hover: hover) {
    .btn-refresh:hover {
      background: var(--color-hover);
      color: var(--color-foreground);
    }
  }

  .btn-refresh:active {
    transform: scale(0.96);
  }

  /* Dropdown Panel */
  .picker-panel {
    display: flex;
    flex-direction: column;
    background: var(--color-background-light);
    border: 1px solid var(--color-separator);
    border-radius: 8px;
    box-shadow: 0 10px 28px color-mix(in oklch, black 25%, transparent);
    padding: 8px;
    gap: 8px;
    width: 100%;
    max-height: 320px;
    overflow: auto;
  }

  .search-box {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
  }

  .search-icon {
    position: absolute;
    left: 9px;
    color: var(--color-foreground-darker);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    background: var(--color-background);
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    padding: 6px 26px 6px 28px;
    font: var(--type-control);
    letter-spacing: 0;
    color: var(--color-foreground);
    outline: none;
    transition: border-color 140ms ease-out;
  }

  .search-input:focus {
    border-color: var(--color-accent);
  }

  .clear-search {
    position: absolute;
    right: 6px;
    background: var(--color-background);
    border: none;
    color: var(--color-foreground-darker);
    font-size: 14px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .partial-warning {
    font: var(--type-body);
    letter-spacing: 0;
    color: var(--color-foreground);
    padding: 2px 4px;
  }

  .apps-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 200px;
    padding-right: 2px;
  }

  .app-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    background: var(--color-background);
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: background 140ms ease-out, border-color 140ms ease-out;
    user-select: none;
  }

  @media (hover: hover) {
    .app-row:hover {
      background: var(--color-hover);
    }
  }

  .app-row.checked {
    background: var(--color-background-light);
    border-color: color-mix(in oklch, var(--color-accent) 25%, transparent);
  }

  .app-checkbox {
    width: 13px;
    height: 13px;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    color: var(--color-accent);
    font: var(--type-control);
    line-height: 11px;
    text-align: center;
  }

  .app-icon-slot {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .app-logo {
    width: 20px;
    height: 20px;
    object-fit: contain;
    border-radius: 4px;
  }

  .app-fallback-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-foreground-darker);
    background: var(--color-background-light);
    border-radius: 4px;
  }

  .app-details {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .app-title {
    font: var(--type-control);
    font-weight: 500;
    letter-spacing: 0;
    color: var(--color-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .app-meta {
    font: var(--type-support);
    letter-spacing: 0;
    color: var(--color-foreground-darker);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .loading-state,
  .empty-state,
  .error-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 6px;
    padding: 24px 12px;
    font: var(--type-support);
    letter-spacing: 0;
    color: var(--color-foreground-darker);
    text-align: center;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--color-separator);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .btn-retry {
    background: var(--color-hover);
    border: 1px solid var(--color-separator);
    color: var(--color-foreground);
    border-radius: 4px;
    padding: 3px 8px;
    font: var(--type-control);
    letter-spacing: 0;
    cursor: pointer;
  }

  .picker-footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: space-between;
    padding-top: 4px;
    border-top: 1px solid var(--color-separator);
    font: var(--type-support);
    letter-spacing: 0;
    color: var(--color-foreground-darker);
  }

  .btn-done {
    background: var(--color-button);
    color: var(--color-button-text);
    border: none;
    border-radius: 4px;
    padding: 3px 10px;
    font: var(--type-control);
    font-weight: 500;
    letter-spacing: 0;
    cursor: pointer;
    transition: transform 100ms ease-out;
  }

  .btn-done:active {
    transform: scale(0.96);
  }

  /* Selected Chips */
  .chip-container {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 32px;
    padding: 8px;
    background: color-mix(in oklch, var(--color-background-light) 60%, var(--color-background));
    border: 1px solid var(--color-separator);
    border-radius: 6px;
    align-items: center;
  }

  .app-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 7px 3px 5px;
    background: var(--color-background-light);
    border-radius: 5px;
    font: var(--type-control);
    letter-spacing: 0;
    color: var(--color-foreground);
    max-width: 100%;
    min-width: 0;
    transition: background 140ms ease-out;
  }

  .chip-logo {
    width: 16px;
    height: 16px;
    object-fit: contain;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .chip-default-icon {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-foreground-darker);
    flex-shrink: 0;
  }

  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .chip-remove {
    background: var(--color-background);
    border: none;
    color: var(--color-foreground-darker);
    cursor: pointer;
    font-size: 13px;
    padding: 0 1px;
    line-height: 1;
    display: flex;
    align-items: center;
    transition: color 140ms ease-out;
  }

  @media (hover: hover) {
    .chip-remove:hover {
      color: var(--color-foreground);
    }
  }

  .empty-hint {
    font: var(--type-support);
    letter-spacing: 0;
    color: var(--color-foreground-darker);
  }

  @media (prefers-reduced-motion: reduce) {
    .btn-select-apps,
    .btn-refresh,
    .btn-done,
    .chevron,
    .spinner {
      transition: none !important;
      transform: none !important;
      animation: none !important;
    }
  }
</style>