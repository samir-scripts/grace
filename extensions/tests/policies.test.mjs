import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('Firefox manifest includes declarative_net_request with valid rule_resources', () => {
  const manifest = JSON.parse(fs.readFileSync('extensions/firefox/manifest.json', 'utf8'));
  assert.ok(manifest.declarative_net_request, 'Missing declarative_net_request in Firefox manifest');
  assert.ok(Array.isArray(manifest.declarative_net_request.rule_resources));
  assert.equal(manifest.declarative_net_request.rule_resources[0].id, 'ruleset_1');
  assert.equal(manifest.declarative_net_request.rule_resources[0].path, 'rules.json');
  assert.equal(manifest.declarative_net_request.rule_resources[0].enabled, true);
  const rulesContent = JSON.parse(fs.readFileSync('extensions/focus/rules.json', 'utf8'));
  assert.ok(Array.isArray(rulesContent), 'rules.json must be a JSON array');
  assert.equal(rulesContent.length, 0, 'Initial static ruleset must be empty');
});
