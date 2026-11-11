// Run only inside a disposable macOS guest. This test does not install extensions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const enabled = process.env.POMOTROID_DISPOSABLE_GUEST === '1';
const extensionId = 'focus@pomotroid.local';

async function inventory(profile, version) {
  const json = JSON.parse(await readFile(path.join(profile, 'extensions.json'), 'utf8'));
  const addon = json.addons.find(item => item.id === extensionId);
  assert.ok(addon, 'persistent companion missing from browser inventory');
  assert.equal(addon.version, version, 'installed companion version differs');
  assert.equal(addon.active, true, 'companion is inactive');
  assert.equal(addon.userDisabled, false, 'companion disabled by user');
  assert.equal(addon.appDisabled, false, 'companion disabled by browser');
  assert.ok([1, 2].includes(addon.signedState), 'companion has no accepted Mozilla signature');
  assert.ok(addon.location && addon.location !== 'app-temporary' && addon.location !== 'temporary', 'temporary or unknown extension location is not persistent');
  assert.equal(typeof addon.rootURI, 'string', 'browser inventory has no installed extension URI');
  assert.match(addon.rootURI, /^jar:file:.*!\/$/, 'browser inventory does not identify an installed XPI');
  return fileURLToPath(addon.rootURI.slice(4, -2));
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    delay(10000).then(() => false),
  ]);
  if (!stopped) {
    child.kill('SIGKILL');
    await new Promise(resolve => child.once('exit', resolve));
    assert.fail('browser did not exit after SIGTERM');
  }
}

test('installed Gecko companion persists and authenticates after two browser restarts', { skip: !enabled, timeout: 150000 }, async () => {
  const { GECKO_BINARY, GECKO_KIND, GECKO_PROFILE, GECKO_LOG, GECKO_SIGNED_XPI, GECKO_EXPECTED_VERSION } = process.env;
  assert.ok(GECKO_BINARY && GECKO_PROFILE && GECKO_LOG && GECKO_SIGNED_XPI && GECKO_EXPECTED_VERSION && ['Firefox', 'Zen'].includes(GECKO_KIND), 'set all GECKO_* variables and use Firefox or Zen');
  for (const binary of new Set([GECKO_BINARY, '/Applications/Firefox.app/Contents/MacOS/firefox', '/Applications/Zen.app/Contents/MacOS/zen'])) {
    const pattern = `^${binary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`;
    const check = spawnSync('/usr/bin/pgrep', ['-f', pattern], { stdio: 'ignore' });
    assert.equal(check.status, 1, 'close all Gecko browsers in the disposable guest');
  }
  // Check inventory before accessing a signed artifact or starting a browser.
  await inventory(GECKO_PROFILE, GECKO_EXPECTED_VERSION);
  const expectedHash = hash(await readFile(GECKO_SIGNED_XPI));
  for (let cycle = 0; cycle < 2; cycle++) {
    const offset = (await stat(GECKO_LOG)).size;
    const child = spawn(GECKO_BINARY, ['--no-remote', '--profile', GECKO_PROFILE], { stdio: 'ignore' });
    let launchError;
    child.once('error', error => { launchError = error; });
    try {
      const deadline = Date.now() + 60000;
      let matched = false;
      while (Date.now() < deadline) {
        if (launchError) throw launchError;
        assert.equal(child.exitCode, null, 'browser exited before acknowledgement');
        assert.equal(child.signalCode, null, 'browser terminated before acknowledgement');
        const lines = (await readFile(GECKO_LOG)).subarray(offset).toString('utf8');
        for (const hello of lines.matchAll(/hello_accepted connection=([0-9a-f-]+) version=3\b/g)) {
          const id = hello[1];
          const policy = lines.match(new RegExp(`policy_sent connection=${id} revision=(\\d+) active=false`));
          if (policy && new RegExp(`ack_received connection=${id} revision=${policy[1]}(?:\\s|$)`).test(lines)) {
            matched = true;
            break;
          }
        }
        if (matched) break;
        await delay(250);
      }
      assert.ok(matched, 'no fresh authenticated connection and matching policy ACK');
    } finally {
      await stopChild(child);
    }
    const installedPath = await inventory(GECKO_PROFILE, GECKO_EXPECTED_VERSION);
    assert.equal(hash(await readFile(installedPath)), expectedHash, 'installed XPI differs from signed artifact');
  }
});
