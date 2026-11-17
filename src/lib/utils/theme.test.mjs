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
    assert.ok(contrastRatio(c['--color-danger-button-text'], c['--color-status-error']) >= 4.5, `${file}: destructive hover`);
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

test('Glass control text remains readable over desktop extremes and solid controls', async () => {
  const { resolveThemeColors, resolveGlassColors, contrastRatio } = await import('./theme.ts');
  const fs = await import('node:fs');
  const themes = fs.readdirSync('static/themes').filter(f => f.endsWith('.json'))
    .map(file => [file, JSON.parse(fs.readFileSync(`static/themes/${file}`, 'utf8'))]);
  themes.push(['gray custom', { colors: {
    '--color-background': '#808080', '--color-background-light': '#818181',
    '--color-foreground': '#808080', '--color-foreground-darker': '#818181',
    '--color-accent': '#808080', '--color-short-round': '#818181',
  } }]);
  for (const [name, theme] of themes) {
    const base = resolveThemeColors(theme);
    const original = { ...base };
    const glass = resolveGlassColors(base);
    assert.deepEqual(base, original, `${name}: input remains unchanged`);
    const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(glass['--glass-canvas']);
    assert.ok(match, `${name}: canvas is rgba`);
    const channels = match.slice(1, 4).map(Number);
    const alpha = Number(match[4]);
    assert.ok(alpha > 0 && alpha <= 1, `${name}: canvas alpha`);
    const composite = back => '#' + channels.map(channel =>
      Math.round(channel * alpha + back * (1 - alpha)).toString(16).padStart(2, '0')).join('');
    const layer = (rgba, canvas) => {
      const values = rgba.match(/[\d.]+/g).map(Number);
      return '#' + values.slice(0, 3).map((channel, i) => Math.round(channel * values[3] + parseInt(canvas.slice(1 + i * 2, 3 + i * 2), 16) * (1 - values[3])).toString(16).padStart(2, '0')).join('');
    };
    const protectedSurfaces = [0, 255].flatMap(back => ['--glass-control-surface', '--glass-selected-surface', '--glass-chrome-surface'].map(role => layer(glass[role], composite(back))));
    const surfaces = [...protectedSurfaces, ...[
      '--color-background', '--color-background-light', '--color-hover', '--color-selected',
    ].map(key => base[key])];
    for (const surface of surfaces) {
      for (const role of ['--glass-foreground', '--glass-foreground-darker', '--glass-status-error',
        '--glass-status-success', '--glass-status-warning']) {
        assert.ok(contrastRatio(glass[role], surface) >= 4.5, `${name}: ${role} on ${surface}`);
      }
      assert.ok(contrastRatio(glass['--glass-border'], surface) >= 3, `${name}: border on ${surface}`);
    }
    assert.ok(contrastRatio(glass['--glass-danger-button-text'], glass['--glass-status-error']) >= 4.5);
  }
});

test('Glass content protects light and dark text across the complete transparency range', async () => {
  const { resolveThemeColors, resolveGlassColors, contrastRatio } = await import('./theme.ts');
  const fs = await import('node:fs');
  const themes = fs.readdirSync('static/themes').filter(f => f.endsWith('.json'))
    .map(file => [file, JSON.parse(fs.readFileSync(`static/themes/${file}`, 'utf8'))]);
  themes.push(['gray custom', { colors: {
    '--color-background': '#808080', '--color-background-light': '#818181',
    '--color-foreground': '#808080', '--color-foreground-darker': '#818181',
  } }]);
  const layer = (paint, back) => {
    assert.match(paint ?? '', /^rgba\(/, 'content has a protected material');
    const values = paint.match(/[\d.]+/g).map(Number);
    return '#' + values.slice(0, 3).map((v, i) => Math.round(v * values[3]
      + parseInt(back.slice(1 + i * 2, 3 + i * 2), 16) * (1 - values[3]))
      .toString(16).padStart(2, '0')).join('');
  };
  for (const [name, theme] of themes) {
    const base = resolveThemeColors(theme);
    for (let transparency = 0; transparency <= 100; transparency++) {
      const glass = resolveGlassColors(base, transparency);
      for (const back of ['#000000', '#ffffff', '#385c81']) {
        const canvas = layer(glass['--glass-canvas'], back);
        const content = layer(glass['--glass-content-surface'], canvas);
        const surfaces = [content, ...['--glass-control-surface', '--glass-selected-surface', '--glass-chrome-surface']
          .map(key => layer(glass[key], content))];
        for (const surface of surfaces) {
          for (const role of ['--glass-foreground', '--glass-foreground-darker', '--glass-status-error', '--glass-status-success', '--glass-status-warning']) {
            assert.ok(contrastRatio(glass[role], surface) >= 4.5, `${name} ${transparency}%: ${role} on ${surface}`);
          }
          assert.ok(contrastRatio(glass['--glass-border'], surface) >= 3, `${name} ${transparency}%: border on ${surface}`);
        }
        if (transparency === 0) assert.equal(contrastRatio(content, base['--color-background']), 1, `${name}: solid endpoint`);
      }
    }
  }
});

test('theme application updates glass colors without publishing them', async () => {
  const { applyTheme, getAppliedThemeColors, setThemePublisher } = await import('../stores/theme.ts');
  const values = new Map();
  let published;
  globalThis.document = { documentElement: { style: {
    setProperty: (k, v) => values.set(k, v), removeProperty: k => values.delete(k)
  } } };
  setThemePublisher(colors => { published = { ...colors }; });
  try {
    const theme = { colors: { '--color-background': '#ffffff' } };
    const input = structuredClone(theme);
    applyTheme(theme);
    const firstCanvas = values.get('--glass-canvas');
    assert.deepEqual(theme, input);
    assert.deepEqual(published, getAppliedThemeColors());
    assert.ok(!Object.keys(published).some(key => key.startsWith('--glass-')));
    applyTheme({ colors: { '--color-background': '#222222' } });
    assert.notEqual(values.get('--glass-canvas'), firstCanvas);
    assert.ok(values.has('--glass-foreground'));
    assert.deepEqual(published, getAppliedThemeColors());
    assert.ok(!Object.keys(published).some(key => key.startsWith('--glass-')));
  } finally {
    setThemePublisher(null);
    delete globalThis.document;
  }
});

// A fixed tint floor hides native material even when contrast permits more glass.
test('Glass retains a light tint at maximum transparency for light and dark canvases', async () => {
  const { resolveThemeColors, resolveGlassColors } = await import('./theme.ts');
  for (const [background, expectedAlpha] of [['#000000', .25], ['#ffffff', .25]]) {
    const colors = resolveThemeColors({ colors: { '--color-background': background } });
    const glass = resolveGlassColors(colors);
    assert.equal(Number(glass['--glass-canvas'].match(/, ([\d.]+)\)$/)[1]), expectedAlpha);
  }
});

test('Glass transparency ranges from solid to a light tint without changing palettes', async () => {
  const { resolveThemeColors, resolveGlassColors } = await import('./theme.ts');
  const colors = resolveThemeColors({ colors: { '--color-background': '#000000' } });
  const alpha = value => Number(resolveGlassColors(colors, value)['--glass-canvas'].match(/, ([\d.]+)\)$/)[1]);
  assert.equal(alpha(0), 1);
  assert.equal(alpha(50), .625);
  assert.equal(alpha(100), .25);
  assert.equal(alpha(-20), 1);
  assert.equal(alpha(120), .25);
});
