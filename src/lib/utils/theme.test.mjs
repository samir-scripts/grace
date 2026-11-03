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
