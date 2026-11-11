import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHexLuminance, isLightTheme, getLightThemes, getDarkThemes } from './theme.ts';

test('parseHexLuminance parses 6-digit and 3-digit hex correctly', () => {
  // White
  const lWhite = parseHexLuminance('#ffffff');
  assert.ok(lWhite !== null && lWhite > 0.99);

  // 3-digit white
  const lWhite3 = parseHexLuminance('#fff');
  assert.ok(lWhite3 !== null && lWhite3 > 0.99);

  // Black
  const lBlack = parseHexLuminance('#000000');
  assert.ok(lBlack !== null && lBlack < 0.01);

  // Invalid hex returns null
  assert.equal(parseHexLuminance('not-a-hex'), null);
  assert.equal(parseHexLuminance(''), null);
});

test('isLightTheme correctly identifies light vs dark themes', () => {
  const gruvboxLight = {
    name: 'Gruvbox Light',
    is_custom: false,
    colors: { '--color-background': '#fbf1c7' },
  };
  const catppuccinLatte = {
    name: 'Catppuccin Latte',
    is_custom: false,
    colors: { '--color-background': '#eff1f5' },
  };
  const pomotroid = {
    name: 'Pomotroid',
    is_custom: false,
    colors: { '--color-background': '#2f384b' },
  };
  const panda = {
    name: 'Panda',
    is_custom: false,
    colors: { '--color-background': '#292a2b' },
  };
  const dracula = {
    name: 'Dracula',
    is_custom: false,
    colors: { '--color-background': '#282a36' },
  };

  assert.equal(isLightTheme(gruvboxLight), true);
  assert.equal(isLightTheme(catppuccinLatte), true);
  assert.equal(isLightTheme(pomotroid), false);
  assert.equal(isLightTheme(panda), false);
  assert.equal(isLightTheme(dracula), false);
});

test('getLightThemes and getDarkThemes partition themes list cleanly', () => {
  const themes = [
    { name: 'Gruvbox Light', is_custom: false, colors: { '--color-background': '#fbf1c7' } },
    { name: 'Pomotroid', is_custom: false, colors: { '--color-background': '#2f384b' } },
    { name: 'Panda', is_custom: false, colors: { '--color-background': '#292a2b' } },
    { name: 'White Custom', is_custom: true, colors: { '--color-background': '#FFF' } },
  ];

  const light = getLightThemes(themes);
  const dark = getDarkThemes(themes);

  assert.equal(light.length, 2);
  assert.deepEqual(light.map(t => t.name), ['Gruvbox Light', 'White Custom']);

  assert.equal(dark.length, 2);
  assert.deepEqual(dark.map(t => t.name), ['Pomotroid', 'Panda']);
});


test('resolved bundled themes provide readable solid semantic roles', async () => {
  const { resolveThemeColors, contrastRatio } = await import('./theme.ts');
  const fs = await import('node:fs');
  for (const file of fs.readdirSync('static/themes').filter(f => f.endsWith('.json'))) {
    const theme = JSON.parse(fs.readFileSync(`static/themes/${file}`, 'utf8'));
    const c = resolveThemeColors(theme);
    for (const bg of ['--color-background', '--color-background-light', '--color-hover', '--color-selected']) {
      for (const fg of ['--color-foreground', '--color-foreground-darker']) {
        assert.ok(contrastRatio(c[fg], c[bg]) >= 4.5, `${file}: ${fg} on ${bg}`);
      }
      assert.ok(contrastRatio(c['--color-border'], c[bg]) >= 3, `${file}: border`);
    }
    assert.ok(contrastRatio(c['--color-button-text'], c['--color-button']) >= 4.5);
    assert.ok(contrastRatio(c['--color-button'], c['--color-background']) >= 3);
    assert.ok(contrastRatio(c['--color-browser-installed-text'], c['--color-browser-installed-bg']) >= 4.5, `${file}: installed badge`);
    assert.ok(contrastRatio(c['--color-browser-active-text'], c['--color-browser-active-bg']) >= 4.5, `${file}: active badge`);
    assert.notEqual(c['--color-browser-installed-bg'], c['--color-browser-active-bg'], `${file}: badge treatments should differ`);
    assert.ok(Math.abs(parseHexLuminance(c['--color-browser-installed-bg']) - parseHexLuminance(c['--color-browser-active-bg'])) >= 0.05, `${file}: badge fills should differ in luminance`);
  }
});

test('browser badge roles stay distinct and readable for near-identical custom palettes', async () => {
  const { resolveThemeColors, contrastRatio } = await import('./theme.ts');
  const theme = { colors: {
    '--color-background': '#808080',
    '--color-background-light': '#818181',
    '--color-foreground': '#808080',
    '--color-foreground-darker': '#818181',
    '--color-accent': '#808080',
    '--color-short-round': '#818181',
  } };
  const c = resolveThemeColors(theme);
  assert.ok(contrastRatio(c['--color-browser-installed-text'], c['--color-browser-installed-bg']) >= 4.5);
  assert.ok(contrastRatio(c['--color-browser-active-text'], c['--color-browser-active-bg']) >= 4.5);
  assert.notEqual(c['--color-browser-installed-bg'], c['--color-browser-active-bg']);
  assert.ok(Math.abs(parseHexLuminance(c['--color-browser-installed-bg']) - parseHexLuminance(c['--color-browser-active-bg'])) >= 0.05);
});

test('theme switching clears stale custom properties', async () => {
  const { applyTheme } = await import('../stores/theme.ts');
  const values = new Map();
  globalThis.document = { documentElement: { style: {
    setProperty: (k,v) => values.set(k,v), removeProperty: k => values.delete(k)
  } } };
  applyTheme({ colors: { '--custom-only': '#123456', '--color-background': '#fff' } });
  const firstInstalledBg = values.get('--color-browser-installed-bg');
  applyTheme({ colors: { '--color-background': '#222222' } });
  assert.equal(values.has('--custom-only'), false);
  assert.ok(values.has('--color-foreground'));
  assert.notEqual(values.get('--color-browser-installed-bg'), firstInstalledBg);
  delete globalThis.document;
});

test('structural separators stay quiet while controls retain contrast', async () => {
  const { resolveThemeColors, contrastRatio } = await import('./theme.ts');
  const fs = await import('node:fs');
  for (const file of ['solarized-light.json', 'solarized-dark.json', 'pomotroid.json']) {
    const c = resolveThemeColors(JSON.parse(fs.readFileSync(`static/themes/${file}`, 'utf8')));
    assert.ok(contrastRatio(c['--color-separator'], c['--color-background']) < 1.8, `${file}: decorative lines should not divide the canvas into boxes`);
    assert.ok(contrastRatio(c['--color-border'], c['--color-background']) >= 3);
    assert.ok(contrastRatio(c['--color-background-light'], c['--color-background']) < 1.5);
  }
});
