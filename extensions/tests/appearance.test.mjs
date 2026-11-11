import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAppearance, applyAppearance, fetchAppearance } from '../focus/appearance.js';

const roles = ['background', 'background-light', 'foreground', 'foreground-darker', 'hover', 'selected', 'border', 'separator', 'button', 'button-text', 'status-error', 'status-success', 'status-warning'];
const appearance = () => ({ type: 'appearance', version: 1, colors: Object.fromEntries(roles.map(role => [`--color-${role}`, '#abcdef'])), animations_enabled: false });
test('only accepts complete, opaque semantic colors and ignores extra properties', () => {
  const value = appearance();
  value.colors.extra = 'url(evil)';
  assert.equal(validateAppearance(value).colors.extra, undefined);
  value.colors['--color-background'] = 'url(evil)';
  assert.equal(validateAppearance(value), null);
  value.colors['--color-background'] = '#ffffff80';
  assert.equal(validateAppearance(value), null);
});
test('applies only validated colors and motion setting', () => {
  const properties = {};
  const document = { documentElement: { style: { setProperty: (key, value) => { properties[key] = value; } }, dataset: {} } };
  assert.equal(applyAppearance(document, appearance()), true);
  assert.equal(properties['--background'], '#abcdef');
  assert.equal(document.documentElement.dataset.animations, 'disabled');
  assert.equal(applyAppearance(document, {}), false);
});
test('uses an isolated native request and disconnects after response or timeout', async () => {
  let message, disconnected = 0, listener;
  const port = { onMessage: { addListener: fn => { listener = fn; } }, onDisconnect: { addListener() {} }, postMessage: value => { message = value; }, disconnect: () => { disconnected++; } };
  const pending = fetchAppearance(name => { assert.equal(name, 'com.splode.pomotroid'); return port; });
  assert.deepEqual(message, { type: 'appearance_get' });
  listener(appearance());
  assert.deepEqual(await pending, appearance());
  assert.equal(disconnected, 1);
  assert.equal(await fetchAppearance(() => port, 1), null);
  assert.equal(disconnected, 2);
});
