<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { FontPack, ImportedFont, UiStyle } from '$lib/types';
  import { settings } from '$lib/stores/settings';
  import { applyAppearance, fontLoadFailed, forgetFont, loadFontPack } from '$lib/stores/appearance';
  import { importFont, listFonts, openFontFilePicker, removeFont, setSetting } from '$lib/ipc';
  import ThemedSelect from '$lib/components/ThemedSelect.svelte';
  import { previewGlassTransparency } from '$lib/stores/theme';
  import * as m from '$paraglide/messages.js';

  let fonts = $state<ImportedFont[]>([]);
  let busy = $state(false);
  let error = $state('');
  let mounted = true;
  let transparency = $state($settings.glass_transparency);
  let previewing = $state(false);
  $effect(() => {
    const saved = $settings.glass_transparency;
    if (!previewing) transparency = saved;
  });
  $effect(() => {
    if ($settings.ui_style !== 'glass') {
      previewing = false;
      previewGlassTransparency(null);
    }
  });
  const builtins = [
    { value: 'mona-sans', label: 'Mona Sans' },
    { value: 'inter', label: 'Inter' },
    { value: 'roboto', label: 'Roboto' },
    { value: 'jetbrains-mono', label: 'JetBrains Mono' },
  ];
  const fontOptions = $derived([
    ...builtins,
    ...fonts.map((font) => ({
      value: `custom:${font.id}`,
      label: fonts.filter((other) => other.display_name === font.display_name).length > 1
        ? `${font.display_name} (${font.id.slice(0, 8)})` : font.display_name,
    })),
  ]);
  const styles = $derived([
    { value: 'pomotroid', label: m.appearance_style_pomotroid() },
    { value: 'blocky', label: m.appearance_style_blocky() },
    { value: 'glass', label: m.appearance_style_glass() },
  ]);
  onMount(() => {
    listFonts().then((result) => { if (mounted) fonts = result; }).catch(() => {
      if (mounted) error = m.appearance_font_import_error();
    });
    return () => { mounted = false; previewGlassTransparency(null); };
  });

  async function save(key: 'ui_style' | 'font_pack' | 'glass_transparency', value: string) {
    if (busy) return;
    const focused = document.activeElement;
    busy = true;
    error = '';
    try {
      if (key === 'font_pack') await loadFontPack(value as FontPack);
      if (!mounted) return;
      const updated = await setSetting(key, value);
      if (!mounted) return;
      settings.set(updated);
      await applyAppearance(updated);
    } catch {
      error = m.appearance_customization_error();
    } finally {
      if (mounted && key === 'glass_transparency') {
        previewing = false;
        previewGlassTransparency(null);
      }
      busy = false;
      await tick();
      if (mounted && focused instanceof HTMLElement && focused.isConnected && document.activeElement === document.body) {
        focused.focus();
      }
    }
  }

  function previewTransparency(event: Event) {
    if (busy) return;
    transparency = Number((event.currentTarget as HTMLInputElement).value);
    previewing = true;
    previewGlassTransparency(transparency);
  }

  async function importLocalFont() {
    if (busy) return;
    busy = true;
    error = '';
    let imported: ImportedFont | undefined;
    let decoded = false;
    try {
      const path = await openFontFilePicker();
      if (!path || !mounted) return;
      imported = await importFont(path);
      const pack: FontPack = `custom:${imported.id}`;
      await loadFontPack(pack);
      decoded = true;
      fonts = await listFonts();
      if (!mounted) return;
      const updated = await setSetting('font_pack', pack);
      if (!mounted) return;
      settings.set(updated);
      await applyAppearance(updated);
    } catch {
      // Roll back only a new, undecodable import; a save error keeps the usable catalog entry.
      if (imported && !decoded) {
        try { await removeFont(imported.id); forgetFont(imported.id); }
        catch { error = m.appearance_font_remove_error(); }
        fonts = await listFonts().catch(() => fonts);
      }
      error ||= decoded ? m.appearance_customization_error() : m.appearance_font_import_error();
    } finally { busy = false; }
  }

  async function removeImportedFont(id: string) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const updated = await removeFont(id);
      forgetFont(id);
      settings.set(updated);
      await applyAppearance(updated);
      fonts = await listFonts();
    } catch { error = m.appearance_font_remove_error(); }
    finally { busy = false; }
  }
</script>

<div class="customization">
  <label for="ui-style">{m.appearance_ui_style()}</label>
  <ThemedSelect id="ui-style" label={m.appearance_ui_style()} value={$settings.ui_style}
    options={styles} disabled={busy} onchange={(value) => save('ui_style', value as UiStyle)} />
  {#if $settings.ui_style === 'glass'}
    <div class="transparency-control">
      <div class="transparency-label">
        <label for="glass-transparency">{m.appearance_glass_transparency()}</label>
        <span>{transparency}%</span>
      </div>
      <div class="transparency-track">
        <input id="glass-transparency" type="range" min="0" max="100" step="1"
          value={transparency} disabled={busy} aria-describedby="glass-transparency-hint"
          oninput={previewTransparency} onchange={() => save('glass_transparency', String(transparency))} />
        <div class="transparency-fill" style={`width: calc(${transparency / 100} * (100% - 14px) + 7px)`}></div>
      </div>
      <p class="hint" id="glass-transparency-hint">{m.appearance_glass_transparency_hint()}</p>
    </div>
  {/if}
  <label for="font-pack">{m.appearance_font_pack()}</label>
  <ThemedSelect id="font-pack" label={m.appearance_font_pack()} value={$settings.font_pack}
    options={fontOptions} disabled={busy} onchange={(value) => save('font_pack', value)} />
  <button class="import-font" disabled={busy} onclick={importLocalFont}>{m.appearance_import_font()}</button>
  <p class="hint">{m.appearance_customization_hint()}</p>
  {#each fonts as font (font.id)}
    <div class="imported-font">
      <span>{font.display_name}</span>
      <button class="remove-font" disabled={busy} onclick={() => removeImportedFont(font.id)}>
        {m.appearance_remove_font({ name: font.display_name })}
      </button>
    </div>
  {/each}
  {#if $fontLoadFailed}<p class="error" role="status">{m.appearance_font_missing()}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .customization { display: flex; flex-direction: column; gap: 14px; padding: 20px; border-bottom: 1px solid var(--color-separator); }
  label { font-size: 0.75rem; font-weight: 600; color: var(--color-foreground); margin-bottom: -8px; }
  .hint, .error { font-size: 0.75rem; line-height: 1.5; color: var(--color-foreground-darker); }
  .error { color: var(--color-status-error); }
  button { font: inherit; cursor: pointer; border: 1px solid var(--color-border); border-radius: 6px; padding: 7px 10px; font-size: 0.75rem; }
  .import-font { align-self: flex-start; background: var(--color-button); color: var(--color-button-text); }
  .imported-font { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.75rem; overflow-wrap: anywhere; }
  .remove-font { background: var(--color-background-light); color: var(--color-foreground); }
  button:disabled { opacity: 0.5; }
  .transparency-control { display: flex; flex-direction: column; gap: 8px; }
  .transparency-label { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.75rem; }
  .transparency-label label { margin: 0; }
  .transparency-label span { color: var(--color-foreground-darker); font-family: var(--font-mono); }
  .transparency-track { position: relative; display: flex; align-items: center; height: 24px; }
  .transparency-track::before { content: ''; position: absolute; width: 100%; height: 4px; background: var(--color-background-light); border-radius: 2px; }
  .transparency-track input { appearance: none; -webkit-appearance: none; width: 100%; height: 4px; position: relative; z-index: 2; background: transparent; cursor: pointer; }
  .transparency-track input:focus-visible { outline: 2px solid var(--color-border); outline-offset: 5px; }
  .transparency-track input:disabled { cursor: not-allowed; }
  .transparency-track input::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--color-foreground); }
  .transparency-track input::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 50%; background: var(--color-foreground); }
  .transparency-fill { position: absolute; height: 4px; border-radius: 2px; background: var(--color-button); pointer-events: none; z-index: 1; }
</style>
