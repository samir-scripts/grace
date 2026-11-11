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
  if (!hex || typeof hex !== 'string' || !/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(hex.trim())) return null;
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

export function contrastRatio(a: string, b: string): number {
  const x = parseHexLuminance(a), y = parseHexLuminance(b);
  return x === null || y === null ? 0 : (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

const DEFAULT_COLORS: Record<string, string> = {
  '--color-background': '#2f384b', '--color-background-light': '#3e4a5d',
  '--color-foreground': '#d7e1f4', '--color-foreground-darker': '#a3aec4',
  '--color-foreground-darkest': '#a3aec4', '--color-background-lightest': '#596579',
  '--color-focus-round': '#b01c2e', '--color-short-round': '#417505',
  '--color-long-round': '#c75000', '--color-accent': '#ff6347',
};

function mix(a: string, b: string, weight: number): string {
  const rgb = (s: string) => {
    const h = s.slice(1);
    const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  };
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v * (1 - weight) + y[i] * weight).toString(16).padStart(2, '0')).join('');
}

/** Keep the supplied palette; adjust semantic foregrounds against all opaque surfaces. */
export function resolveThemeColors(theme: Pick<Theme, 'colors'>): Record<string, string> {
  const c = { ...DEFAULT_COLORS };
  for (const [key, value] of Object.entries(theme.colors)) {
    if (/^--[a-z0-9-]+$/.test(key) && /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value)) c[key] = value;
  }
  const bg = c['--color-background'];
  const ink = (parseHexLuminance(bg) ?? 0) > .179 ? '#000000' : '#ffffff';
  // Surface colors remain close enough to the canvas to support a shared text role.
  if (contrastRatio(ink, c['--color-background-light']) < 7) c['--color-background-light'] = mix(bg, ink, .04);
  // Elevation stays in the canvas family rather than forming contrasting panels.
  c['--color-background-light'] = mix(bg, c['--color-background-light'], .45);
  while (contrastRatio(bg, c['--color-background-light']) > 1.45) {
    c['--color-background-light'] = mix(c['--color-background-light'], bg, .1);
  }
  c['--color-hover'] = mix(bg, ink, .035);
  c['--color-selected'] = mix(bg, ink, .055);
  for (const key of ['--color-background-light', '--color-hover', '--color-selected']) {
    const opposite = ink === '#000000' ? '#ffffff' : '#000000';
    for (let n = 0; contrastRatio(ink, c[key]) < 4.5 && n < 100; n++) c[key] = mix(c[key], opposite, .05);
  }
  const surfaces = ['--color-background', '--color-background-light', '--color-hover', '--color-selected'].map(k => c[k]);
  const readable = (candidate: string, minimum: number) => {
    for (let step = 0; step <= 100; step++) {
      const color = mix(candidate, ink, step / 100);
      if (surfaces.every(surface => contrastRatio(color, surface) >= minimum)) return color;
    }
    return ink;
  };
  c['--color-foreground'] = readable(c['--color-foreground'], 4.5);
  c['--color-foreground-darker'] = readable(c['--color-foreground-darker'], 4.5);
  c['--color-foreground-darkest'] = c['--color-foreground-darker'];
  c['--color-border'] = readable(mix(bg, ink, .25), 3);
  // Decorative structure does not need the contrast of a control boundary.
  c['--color-separator'] = mix(bg, ink, .12);
  c['--color-button'] = readable(c['--color-accent'], 3);
  const buttonText = ink === '#000000' ? '#ffffff' : '#000000';
  const buttonTarget = buttonText === '#ffffff' ? '#000000' : '#ffffff';
  for (let n = 0; contrastRatio(buttonText, c['--color-button']) < 4.5 && n < 100; n++) {
    c['--color-button'] = mix(c['--color-button'], buttonTarget, .03);
  }
  c['--color-button-text'] = buttonText;
  c['--color-status-error'] = readable('#c53748', 4.5);
  c['--color-status-success'] = readable('#28783b', 4.5);
  c['--color-status-warning'] = readable('#946000', 4.5);

  // Installed is a quiet accent tint; active uses the short-round color as a
  // stronger fill, with both badge text colors adjusted for readable contrast.
  const installedBg = mix(bg, c['--color-button'], .08);
  let installedText = c['--color-button'];
  for (let step = 0; contrastRatio(installedText, installedBg) < 4.5 && step < 100; step++) {
    installedText = mix(installedText, ink, .05);
  }
  c['--color-browser-installed-bg'] = installedBg;
  c['--color-browser-installed-text'] = contrastRatio(installedText, installedBg) >= 4.5 ? installedText : ink;
  let activeBg = readable(c['--color-short-round'], 3);
  const activeText = c['--color-button-text'];
  const activeTarget = activeText === '#ffffff' ? '#000000' : '#ffffff';
  for (let step = 0; contrastRatio(activeText, activeBg) < 4.5 && step < 100; step++) {
    activeBg = mix(activeBg, activeTarget, .03);
  }
  c['--color-browser-active-bg'] = activeBg;
  c['--color-browser-active-text'] = activeText;
  return c;
}
