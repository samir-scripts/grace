import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';

const builder = path.resolve('scripts/build-browser-extensions.mjs');
const source = path.resolve('extensions');
const id = 'focus@pomotroid.local';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pomotroid signed gecko '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['focus', 'firefox', 'chrome', 'safari']) {
    fs.cpSync(path.join(source, dir), path.join(root, 'extensions', dir), { recursive: true });
  }
  const signed = path.join(root, 'extensions/signed/firefox');
  const input = path.join(signed, `${id}.xpi`);
  const provenance = path.join(signed, 'provenance.json');
  const output = path.join(root, 'extensions/dist/firefox', `${id}.xpi`);
  const run = (...args) => spawnSync(process.execPath, [builder, ...args], { cwd: root, encoding: 'utf8' });
  const payload = () => {
    const files = {};
    for (const name of fs.readdirSync(path.join(root, 'extensions/focus'))) {
      files[name] = new Uint8Array(fs.readFileSync(path.join(root, 'extensions/focus', name)));
    }
    files['manifest.json'] = new Uint8Array(fs.readFileSync(path.join(root, 'extensions/firefox/manifest.json')));
    files['META-INF/mozilla.rsa'] = new Uint8Array([1, 2, 3]); // Synthetic: not Mozilla signed.
    return files;
  };
  const stage = (files, override = {}) => {
    fs.mkdirSync(signed, { recursive: true });
    const bytes = Buffer.from(zipSync(files));
    fs.writeFileSync(input, bytes);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extensions/firefox/manifest.json')));
    fs.writeFileSync(provenance, JSON.stringify({ id, version: manifest.version, channel: 'unlisted', sha256: createHash('sha256').update(bytes).digest('hex'), amo_submission_url: 'https://addons.mozilla.org/developers/addon/example/', ...override }));
    return bytes;
  };
  return { root, input, provenance, output, run, payload, stage };
}

test('release build refuses a missing signed artifact', t => {
  const f = fixture(t), result = f.run('--require-signed');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Signed Gecko artifact required/);
  assert.equal(fs.existsSync(f.output), false);
});

test('release build refuses unsigned or corrupt archives', t => {
  for (const corrupt of [false, true]) {
    const f = fixture(t), files = f.payload();
    delete files['META-INF/mozilla.rsa'];
    f.stage(files);
    if (corrupt) {
      const bytes = Buffer.from('not a zip');
      fs.writeFileSync(f.input, bytes);
      const p = JSON.parse(fs.readFileSync(f.provenance));
      p.sha256 = createHash('sha256').update(bytes).digest('hex');
      fs.writeFileSync(f.provenance, JSON.stringify(p));
    }
    assert.notEqual(f.run('--require-signed').status, 0);
    assert.equal(fs.existsSync(f.output), false);
  }
});

test('release build rejects a damaged local ZIP header', t => {
  const f = fixture(t);
  const bytes = f.stage(f.payload());
  bytes[0] = 0;
  fs.writeFileSync(f.input, bytes);
  const provenance = JSON.parse(fs.readFileSync(f.provenance));
  provenance.sha256 = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(f.provenance, JSON.stringify(provenance));
  assert.notEqual(f.run('--require-signed').status, 0);
  assert.equal(fs.existsSync(f.output), false);
});

test('release build refuses wrong identity, version, or stale payload', t => {
  for (const mutation of ['id', 'version', 'changed', 'missing', 'extra']) {
    const f = fixture(t), files = f.payload();
    const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
    if (mutation === 'id') manifest.browser_specific_settings.gecko.id = 'other@example.com';
    if (mutation === 'version') manifest.version = '9.9.9';
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    if (mutation === 'changed') files['bridge-auth.js'] = new Uint8Array([1]);
    if (mutation === 'missing') delete files['bridge-auth.js'];
    if (mutation === 'extra') files['extra.js'] = new Uint8Array([1]);
    f.stage(files);
    assert.notEqual(f.run('--require-signed').status, 0, mutation);
    assert.equal(fs.existsSync(f.output), false);
  }
});

test('release build refuses a hash mismatch without replacing previous output', t => {
  const f = fixture(t);
  f.stage(f.payload());
  fs.appendFileSync(f.input, 'changed');
  fs.mkdirSync(path.dirname(f.output), { recursive: true });
  fs.writeFileSync(f.output, 'previous output');
  assert.notEqual(f.run('--require-signed').status, 0);
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'previous output');
});

test('repeated builds preserve artifact bytes and remove stale output files', t => {
  const f = fixture(t), bytes = f.stage(f.payload());
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(f.output), bytes);
  const stale = path.join(path.dirname(f.output), 'stale.js');
  fs.writeFileSync(stale, 'old');
  result = f.run('--require-signed');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(f.output), bytes);
  assert.equal(fs.existsSync(stale), false);
});

test('development fallback cannot mask an invalid signed artifact', t => {
  const f = fixture(t);
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Unsigned Gecko development package/);
  f.stage(f.payload());
  fs.unlinkSync(f.provenance);
  result = f.run();
  assert.notEqual(result.status, 0);
});


test('explicit development build uses current unsigned source without changing a stale signed artifact', t => {
  const f = fixture(t), stale = f.payload();
  stale['manifest.json'] = new TextEncoder().encode('{"stale":true}');
  const signedBytes = f.stage(stale);
  const provenanceBytes = fs.readFileSync(f.provenance);
  assert.notEqual(f.run().status, 0, 'default build rejects stale signed artifact');
  const result = f.run('--development');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Unsigned Gecko development package/);
  const archive = unzipSync(fs.readFileSync(f.output));
  assert.equal(Object.keys(archive).some(name => name.startsWith('META-INF/')), false);
  for (const [name, bytes] of Object.entries(f.payload())) {
    if (!name.startsWith('META-INF/')) assert.deepEqual(Buffer.from(archive[name]), Buffer.from(bytes), name);
  }
  assert.deepEqual(fs.readFileSync(f.input), signedBytes);
  assert.deepEqual(fs.readFileSync(f.provenance), provenanceBytes);
});

test('development and signed release options cannot be combined', t => {
  const f = fixture(t);
  const result = f.run('--development', '--require-signed');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mutually exclusive/);
  assert.equal(fs.existsSync(f.output), false);
});

test('development packaging refuses nested credential files', t => {
  const f = fixture(t);
  const nested = path.join(f.root, 'extensions/focus/nested');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, '.env.amo.local'), 'synthetic-private-value');
  const result = f.run('--development');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /synthetic-private-value/);
  assert.equal(fs.existsSync(f.output), false);
});

test('signed artifact verification rejects credential filenames inside archive', t => {
  const f = fixture(t), files = f.payload();
  files['META-INF/nested/private.key'] = new TextEncoder().encode('synthetic-private-value');
  f.stage(files);
  const result = f.run('--require-signed');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Credential file/);
  assert.doesNotMatch(result.stderr, /synthetic-private-value/);
});
