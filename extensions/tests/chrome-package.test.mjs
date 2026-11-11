import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const builder = path.resolve('scripts/build-browser-extensions.mjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grace-chrome-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['focus', 'firefox', 'chrome', 'safari']) {
    fs.cpSync(path.resolve('extensions', dir), path.join(root, 'extensions', dir), { recursive: true });
  }
  return root;
}

function build(root, ...args) {
  return spawnSync(process.execPath, [builder, ...args], { cwd: root, encoding: 'utf8' });
}

test('Chrome ZIP exposes loadable entry points and the native-host-authorized identity', t => {
  const root = fixture(t);
  const result = build(root, '--development');
  assert.equal(result.status, 0, result.stderr);
  const entries = unzipSync(fs.readFileSync(path.join(root, 'extensions/dist/chrome.zip')));
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
  assert.equal(manifest.manifest_version, 3);
  for (const name of [manifest.background.service_worker, manifest.options_ui.page,
    'policy.js', 'bridge-auth.js', 'native-pairing.js', 'consent.js', 'appearance.js',
    'options.js', 'options.css', 'MonaSansVF.woff2', 'blocked.html', 'blocked.js']) {
    assert.ok(Object.hasOwn(entries, name), `Missing packaged resource: ${name}`);
  }
  const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...hash].map(nibble => String.fromCharCode(97 + parseInt(nibble, 16))).join('');
  assert.equal(id, 'ddiojihepmbimcfoefnebpolgaljlcfn');
  assert.equal(Object.keys(entries).some(name => /\.(?:zip|xpi)$/.test(name)), false);
  assert.ok(fs.existsSync(path.join(root, 'extensions/dist/chrome', manifest.background.service_worker)));
});

for (const filename of ['.env.local', 'nested/owner.pem']) {
  test(`Chrome packaging rejects ${filename} before changing existing output`, t => {
    const root = fixture(t);
    const source = path.join(root, 'extensions/chrome', filename);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'test-only forbidden fixture');
    const dist = path.join(root, 'extensions/dist/chrome');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'previous-build'), 'preserve');
    const result = build(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Credential file is not allowed/);
    assert.equal(fs.readFileSync(path.join(dist, 'previous-build'), 'utf8'), 'preserve');
    assert.equal(fs.existsSync(path.join(root, 'extensions/dist/chrome.zip')), false);
  });
}
