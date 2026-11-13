import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Unzip, unzipSync } from 'fflate';

const builder = path.resolve('scripts/build-browser-extensions.mjs');

test('unsigned Gecko package contains exactly the current source and declaration', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pomotroid-unsigned-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['focus', 'firefox', 'chrome', 'safari']) {
    fs.cpSync(path.resolve('extensions', dir), path.join(root, 'extensions', dir), { recursive: true });
  }
  const result = spawnSync(process.execPath, [builder], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const xpi = fs.readFileSync(path.join(root, 'extensions/dist/firefox/focus@pomotroid.local.xpi'));
  const archive = unzipSync(xpi);
  const localNames = [];
  const stream = new Unzip(file => localNames.push(file.name));
  stream.push(xpi, true);
  const files = fs.readdirSync(path.join(root, 'extensions/focus'));
  assert.deepEqual(Object.keys(archive).sort(), [...files, 'manifest.json'].sort());
  assert.deepEqual(localNames.sort(), Object.keys(archive).sort());
  assert.equal(Object.keys(archive).some(name => name.startsWith('META-INF/')), false);
  const manifest = JSON.parse(Buffer.from(archive['manifest.json']).toString());
  assert.equal(manifest.browser_specific_settings.gecko.id, 'focus@pomotroid.local');
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '115.0');
  assert.equal(manifest.version, '1.1.1');
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ['authenticationInfo', 'personallyIdentifyingInfo'] });
  assert.equal(manifest.permissions.includes('management'), false);
  const matchesSource = () => files.every(file => fs.existsSync(path.join(root, 'extensions/focus', file)) &&
    Buffer.from(archive[file]).equals(fs.readFileSync(path.join(root, file === 'options.html' ? 'extensions/firefox/payload' : 'extensions/focus', file)))) &&
    Buffer.from(archive['manifest.json']).equals(fs.readFileSync(path.join(root, 'extensions/firefox/manifest.json')));
  assert.equal(matchesSource(), true);
  const source = path.join(root, 'extensions/focus/consent.js');
  const original = fs.readFileSync(source);
  fs.appendFileSync(source, '\n// changed');
  assert.equal(matchesSource(), false, 'modified source cannot match the archived payload');
  fs.writeFileSync(source, original);
  fs.unlinkSync(source);
  assert.equal(matchesSource(), false, 'missing consent source cannot match the archive');
});
