import type { Settings, Theme } from '$lib/types';
/**
 * Resolve the active theme name from settings and the current OS color scheme.
 *
 * - `auto`  → use `theme_dark` when OS is dark, `theme_light` otherwise
 * - `light` → always `theme_light`
 * - `dark`  → always `theme_dark`
 */
export function resolveThemeName(settings: Settings, osDark: boolean): string {
  switch (settings.theme_mode) {
    case 'light':
      return settings.theme_light;
    case 'dark':
      return settings.theme_dark;
    default: // 'auto'
      return osDark ? settings.theme_dark : settings.theme_light;
  }
}

/**
 * Compute relative luminance from an sRGB hex color string (#rgb or #rrggbb).
 * Returns a value between 0.0 (pitch black) and 1.0 (pure white), or null if invalid.
 */
export function parseHexLuminance(hex: string): number | null {
  if (!hex || typeof hex !== 'string') return null;
  const clean = hex.trim().replace(/^#/, '');

  let r = 0, g = 0, b = 0;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  } else {
    return null;
  }

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }

  // Standard sRGB to linear transformation
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };

  // Rec. 709 relative luminance
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Determine if a theme is a light theme based on its background color luminance.
 * Themes with relative luminance >= 0.45 are classified as light themes.
 */
export function isLightTheme(theme: Theme): boolean {
  const bg = theme.colors?.['--color-background'];
  if (!bg) return false;
  const lum = parseHexLuminance(bg);
  return lum !== null && lum >= 0.45;
}

/**
 * Returns all themes classified as light themes.
 */
export function getLightThemes(themes: Theme[]): Theme[] {
  return themes.filter(isLightTheme);
}

/**
 * Returns all themes classified as dark themes.
 */
export function getDarkThemes(themes: Theme[]): Theme[] {
  return themes.filter((t) => !isLightTheme(t));
}
