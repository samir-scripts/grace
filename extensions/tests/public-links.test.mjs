import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';

const homepage = 'https://grace-focus.github.io/';
const privacy = homepage + 'privacy/';
test('Chrome and Firefox packages expose public links before consent without changing Safari', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grace-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['focus', 'companion', 'chrome', 'firefox', 'safari']) fs.cpSync(path.resolve('extensions', name), path.join(root, 'extensions', name), { recursive: true });
  const run = spawnSync(process.execPath, [path.resolve('scripts/build-browser-extensions.mjs'), '--development'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  for (const browser of ['chrome', 'firefox']) {
    const dist = path.join(root, 'extensions/dist', browser);
    const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json')));
    assert.equal(manifest.homepage_url, homepage, browser);
    const html = fs.readFileSync(path.join(dist, 'options.html'), 'utf8');
    assert.match(html, /<a[^>]+href="https:\/\/grace-focus\.github\.io\/"[^>]*>Website<\/a>/, browser);
    assert.ok(html.includes('href="' + privacy + '"'), browser);
    assert.equal(html.includes('<iframe'), false);
    assert.equal(html.includes('<link rel="prefetch"'), false);
    assert.ok(html.indexOf('>Privacy</a>') > html.indexOf('</details>'), 'links outside consent-dependent controls');
    if (browser === 'firefox') {
      const xpi = unzipSync(fs.readFileSync(path.join(dist, 'focus@pomotroid.local.xpi')));
      assert.equal(Buffer.from(xpi['options.html']).toString(), html);
    }
  }
  const safari = path.join(root, 'extensions/dist/safari');
  // Inventory and bytes of the reviewed Safari package at 04481fd.
  const safariHash = createHash('sha256');
  for (const name of fs.readdirSync(safari).sort()) {
    const bytes = fs.readFileSync(path.join(safari, name));
    safariHash.update(`${name}\0${bytes.length}\0`).update(bytes);
  }
  assert.equal(safariHash.digest('hex'), '243cbd3b95e0e7ca78ace6f1b17ee1db3000de089e4d03b624dc3d57bfd498dd');
  const release = JSON.parse(fs.readFileSync('extensions/chrome/release.json'));
  assert.equal(release.support_url, homepage);
  assert.equal(release.privacy_policy_url, privacy);
});
