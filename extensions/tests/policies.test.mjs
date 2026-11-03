import test from 'node:test';
import assert from 'node:assert/strict';
import { generateChromePolicy, generateFirefoxPolicy } from '../../scripts/build-browser-policies.mjs';

test('generateChromePolicy produces valid ExtensionSettings structure with force_installed', () => {
  const extensionId = 'abcdefghijklmnopqrstuvwxyzabcdef';
  const updateUrl = 'https://clients2.google.com/service/update2/crx';
  const policy = generateChromePolicy(extensionId, updateUrl);

  assert.ok(policy.ExtensionSettings);
  assert.equal(policy.ExtensionSettings[extensionId].installation_mode, 'force_installed');
  assert.equal(policy.ExtensionSettings[extensionId].update_url, updateUrl);
});

test('generateChromePolicy validates 32-char extension ID', () => {
  assert.throws(() => generateChromePolicy('too-short', 'https://example.com'), /32-character/);
});

test('generateFirefoxPolicy produces valid policies.json with force_installed', () => {
  const extensionId = 'focus@pomotroid.local';
  const installUrl = 'file:///opt/pomotroid/extensions/firefox.xpi';
  const policy = generateFirefoxPolicy(extensionId, installUrl);

  assert.ok(policy.policies);
  assert.ok(policy.policies.ExtensionSettings);
  assert.equal(policy.policies.ExtensionSettings[extensionId].installation_mode, 'force_installed');
  assert.equal(policy.policies.ExtensionSettings[extensionId].install_url, installUrl);
});
