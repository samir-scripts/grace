import type { Theme } from '$lib/types';
import { resolveGlassColors, resolveThemeColors } from '../utils/theme.ts';

let appliedColors: Record<string, string> = {};
let glassTransparency = 100;
let glassPreview: number | null = null;
let publisher: ((colors: Record<string, string>) => void) | null = null;
export const getAppliedThemeColors = () => ({ ...appliedColors });
export function setThemePublisher(next: typeof publisher): void { publisher = next; }
let appliedKeys = new Set<string>();

function applyGlassColors(): void {
  if (Object.keys(appliedColors).length === 0) return;
  const colors = resolveGlassColors(appliedColors, glassPreview ?? glassTransparency);
  for (const [key, value] of Object.entries(colors)) document.documentElement.style.setProperty(key, value);
}

export function setGlassTransparency(value: number): void {
  glassTransparency = value;
  applyGlassColors();
}

/** Keep a drag/pending save visible across unrelated settings or theme events. */
export function previewGlassTransparency(value: number | null): void {
  glassPreview = value;
  applyGlassColors();
}
/** Apply a complete palette, removing custom properties belonging to the previous theme. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const colors = resolveThemeColors(theme);
  for (const key of appliedKeys) if (!(key in colors)) root.style.removeProperty(key);
  for (const [key, value] of Object.entries(colors)) root.style.setProperty(key, value);
  appliedKeys = new Set(Object.keys(colors));
  appliedColors = colors;
  applyGlassColors();
  publisher?.(colors);
}
