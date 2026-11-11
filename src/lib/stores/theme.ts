import type { Theme } from '$lib/types';
import { resolveThemeColors } from '../utils/theme.ts';

let appliedColors: Record<string, string> = {};
let publisher: ((colors: Record<string, string>) => void) | null = null;
export const getAppliedThemeColors = () => ({ ...appliedColors });
export function setThemePublisher(next: typeof publisher): void { publisher = next; }
let appliedKeys = new Set<string>();
/** Apply a complete palette, removing custom properties belonging to the previous theme. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const colors = resolveThemeColors(theme);
  for (const key of appliedKeys) if (!(key in colors)) root.style.removeProperty(key);
  for (const [key, value] of Object.entries(colors)) root.style.setProperty(key, value);
  appliedKeys = new Set(Object.keys(colors));
  appliedColors = colors;
  publisher?.(colors);
}
