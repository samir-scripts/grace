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
  for (const dir of ['focus', 'companion', 'firefox', 'chrome', 'safari']) {
    fs.cpSync(path.resolve('extensions', dir), path.join(root, 'extensions', dir), { recursive: true });
  }
  return root;
}

function build(root, ...args) {
  return spawnSync(process.execPath, [builder, ...args], { cwd: root, encoding: 'utf8' });
}

function filesIn(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(full, relative) : [relative];
  }).sort();
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
  assert.equal(id, 'cgibenlmgmblmalggjalnoaikjkdnoid');
  assert.equal(Object.keys(entries).some(name => /\.(?:zip|xpi)$/.test(name)), false);
  assert.ok(fs.existsSync(path.join(root, 'extensions/dist/chrome', manifest.background.service_worker)));
  const unpacked = path.join(root, 'extensions/dist/chrome');
  assert.deepEqual(Object.keys(entries).sort(), filesIn(unpacked), 'ZIP and unpacked output contain the same files');
  for (const filename of filesIn(unpacked)) {
    assert.deepEqual(Buffer.from(entries[filename]), fs.readFileSync(path.join(unpacked, filename)), filename);
  }
});

test('companion overlay rejects unexpected files before replacing output', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'extensions/companion/extra.js'), 'unexpected');
  const result = build(root, '--development');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected companion payload override/);
});

test('Chrome rejects a symlink at the companion overlay root', t => {
  const root = fixture(t);
  const overlay = path.join(root, 'extensions/companion');
  const outside = path.join(root, 'outside-source');
  fs.renameSync(overlay, outside);
  try {
    fs.symlinkSync(outside, overlay, 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error.code)) return t.skip(`symlink creation is unavailable: ${error.code}`);
    throw error;
  }
  const result = build(root, '--chrome-release');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected companion payload override/);
});

test('Chrome rejects a missing declared icon before replacing output', t => {
  const root = fixture(t);
  const manifestPath = path.join(root, 'extensions/chrome/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  delete manifest.icons[16];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = build(root, '--chrome-release');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required companion icon/);
});

test('Chrome rejects incorrect declared icon dimensions before replacing output', t => {
  const root = fixture(t);
  fs.copyFileSync(path.join(root, 'extensions/companion/icon-32.png'), path.join(root, 'extensions/companion/icon-16.png'));
  const result = build(root, '--development');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid companion icon dimensions/);
});

test('Chrome 1.1.4 release entries match the submitted archive byte for byte', t => {
  const root = fixture(t);
  const result = build(root, '--chrome-release');
  assert.equal(result.status, 0, result.stderr);
  const entries = unzipSync(fs.readFileSync(path.join(root, 'extensions/dist/chrome.zip')));
  const hash = createHash('sha256');
  for (const name of Object.keys(entries).sort()) {
    hash.update(name + '\0');
    hash.update(createHash('sha256').update(entries[name]).digest());
  }
  assert.equal(hash.digest('hex'), 'e4fecd44e637f7815c87b18388f9f7967b2a27a4dd87d543c67b56e377e1ecb7');
});

for (const filename of ['.env.local', '.env.amo.local', 'nested/owner.pem']) {
  test(`Chrome packaging rejects ${filename} before changing existing output`, t => {
    const root = fixture(t);
    const source = path.join(root, 'extensions/chrome', filename);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'test-only forbidden fixture');
    const dist = path.join(root, 'extensions/dist/chrome');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'previous-build'), 'preserve');
    const zip = path.join(root, 'extensions/dist/chrome.zip');
    const previousZip = Buffer.from('previous chrome archive');
    fs.writeFileSync(zip, previousZip);
    const result = build(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Credential file is not allowed/);
    assert.equal(fs.readFileSync(path.join(dist, 'previous-build'), 'utf8'), 'preserve');
    assert.deepEqual(fs.readFileSync(zip), previousZip);
  });
}

test('Chrome packaging rejects symlinks before changing existing output', t => {
  const root = fixture(t);
  const target = path.join(root, 'outside-source');
  fs.writeFileSync(target, 'test-only symlink fixture');
  const link = path.join(root, 'extensions/chrome/linked-resource');
  try {
    fs.symlinkSync(target, link);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error.code)) {
      t.skip(`symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const dist = path.join(root, 'extensions/dist/chrome');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'previous-build'), 'preserve');
  const zip = path.join(root, 'extensions/dist/chrome.zip');
  const previousZip = Buffer.from('previous chrome archive');
  fs.writeFileSync(zip, previousZip);
  const result = build(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported entry in extension source/);
  assert.equal(fs.readFileSync(path.join(dist, 'previous-build'), 'utf8'), 'preserve');
  assert.deepEqual(fs.readFileSync(zip), previousZip);
});
