import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const builder = path.resolve('scripts/build-browser-extensions.mjs');
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const id = [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)].map(n => String.fromCharCode(97 + parseInt(n, 16))).join('');
const config = { extension_id: id, public_key: key, privacy_policy_url: 'https://github.com/samir-scripts/grace/privacy', support_url: 'https://github.com/samir-scripts/grace/issues' };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grace-chrome-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['focus', 'chrome']) fs.cpSync(path.resolve('extensions', dir), path.join(root, 'extensions', dir), { recursive: true });
  return { root, run: (...args) => spawnSync(process.execPath, [builder, ...args], { cwd: root, encoding: 'utf8' }), configure: value => fs.writeFileSync(path.join(root, 'extensions/chrome/release.json'), JSON.stringify(value)) };
}
test('Chrome release rejects unconfigured identity before replacing output', t => {
  const f = fixture(t);
  const zip = path.join(f.root, 'extensions/dist/chrome.zip');
  fs.mkdirSync(path.dirname(zip), { recursive: true }); fs.writeFileSync(zip, 'previous');
  f.configure({ ...config, extension_id: null });
  const result = f.run('--chrome-release');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Chrome release/);
  assert.equal(fs.readFileSync(zip, 'utf8'), 'previous');
});
test('Chrome release validates the key ID, excludes config, and packages loadable resources', t => {
  const f = fixture(t); f.configure(config);
  const result = f.run('--chrome-release');
  assert.equal(result.status, 0, result.stderr);
  const entries = unzipSync(fs.readFileSync(path.join(f.root, 'extensions/dist/chrome.zip')));
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString());
  assert.equal(manifest.key, key); assert.equal(manifest.minimum_chrome_version, '116');
  assert.equal(entries['release.json'], undefined);
  assert.ok(entries[manifest.background.service_worker]);
  assert.ok(manifest.action); assert.equal(manifest.action.default_popup, undefined);
  for (const size of [16, 32, 48, 128]) {
    const icon = Buffer.from(entries[manifest.icons[size]]);
    assert.equal(icon.readUInt32BE(16), size); assert.equal(icon.readUInt32BE(20), size);
  }
});
for (const [name, changes] of [
  ['mismatched ID', { extension_id: 'a'.repeat(32) }],
  ['malformed public key', { public_key: 'placeholder' }],
  ['insecure privacy URL', { privacy_policy_url: 'http://github.com/privacy' }],
  ['placeholder support URL', { support_url: 'https://example.com/support' }],
]) test(`Chrome release rejects ${name}`, t => {
  const f = fixture(t); f.configure({ ...config, ...changes });
  const result = f.run('--chrome-release'); assert.notEqual(result.status, 0); assert.match(result.stderr, /Chrome release/);
});
test('draft bootstrap ZIP needs no store identity and is separate from release output', t => {
  const f = fixture(t);
  const result = f.run('--chrome-draft'); assert.equal(result.status, 0, result.stderr);
  const entries = unzipSync(fs.readFileSync(path.join(f.root, 'extensions/dist/chrome-draft.zip')));
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString());
  assert.equal(manifest.key, undefined);
  assert.equal(fs.existsSync(path.join(f.root, 'extensions/dist/chrome.zip')), false);
});
