import { writable } from 'svelte/store';
import type { FontPack, Settings } from '$lib/types';
import { readFont } from '$lib/ipc';
import { setGlassTransparency } from '$lib/stores/theme';

export const fontLoadFailed = writable(false);
const sans = "'Mona Sans', system-ui, sans-serif";
const mono = "'Mona Sans Mono', monospace";
const builtins: Record<string, [string, string]> = {
  'mona-sans': [sans, mono],
  inter: ["'Inter', " + sans, mono],
  roboto: ["'Roboto', " + sans, mono],
  'jetbrains-mono': ["'JetBrains Mono', " + mono, "'JetBrains Mono', " + mono],
};
const customLoads = new Map<string, Promise<string>>();
const customFaces = new Map<string, FontFace>();

export function forgetFont(id: string): void {
  const face = customFaces.get(id);
  if (face) document.fonts.delete(face);
  customFaces.delete(id);
  customLoads.delete(id);
}
let generation = 0;

const circularDial = { width: 220, height: 220 };
const blockyDial = { width: 280, height: 280 * 180 / 230 };
export function getTimerDialDimensions(style: Settings['ui_style']): Readonly<{ width: number; height: number }> {
  return style === 'blocky' ? blockyDial : circularDial;
}

/** Decode once before selection; bytes never need a filesystem URL or a CSP exception. */
export async function loadFontPack(pack: FontPack): Promise<[string, string]> {
  if (builtins[pack]) {
    const pair = builtins[pack];
    await document.fonts.load(`16px ${pair[0].split(',')[0]}`);
    return pair;
  }
  const id = pack.slice('custom:'.length);
  if (!/^custom:[0-9a-f-]{36}$/.test(pack)) throw new Error('Invalid font');
  let loading = customLoads.get(id);
  if (!loading) {
    loading = (async () => {
      const face = new FontFace(`GraceCustom-${id}`, await readFont(id));
      await face.load();
      if (customLoads.get(id) !== loading) throw new Error('Font removed');
      document.fonts.add(face);
      customFaces.set(id, face);
      return face.family;
    })();
    customLoads.set(id, loading);
    loading.catch(() => { if (customLoads.get(id) === loading) customLoads.delete(id); });
  }
  const family = await loading;
  return [`'${family}', ${sans}`, `'${family}', ${mono}`];
}

export async function applyAppearance(settings: Pick<Settings, 'ui_style' | 'font_pack' | 'glass_transparency'>): Promise<void> {
  const current = ++generation;
  document.documentElement.dataset.uiStyle = settings.ui_style;
  setGlassTransparency(settings.glass_transparency);
  const dimensions = getTimerDialDimensions(settings.ui_style);
  document.documentElement.style.setProperty('--timer-dial-width', `${dimensions.width}px`);
  document.documentElement.style.setProperty('--timer-dial-height', `${dimensions.height}px`);
  let pair: [string, string];
  let failed = false;
  try {
    pair = await loadFontPack(settings.font_pack);
  } catch {
    pair = builtins['mona-sans'];
    failed = true;
  }
  if (current !== generation) return;
  const root = document.documentElement;
  root.style.setProperty('--font-ui', pair[0]);
  root.style.setProperty('--font-mono', pair[1]);
  fontLoadFailed.set(failed);
}
