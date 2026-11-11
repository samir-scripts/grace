// Run only in a disposable macOS guest with the real desktop app and native host running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const enabled = process.env.POMOTROID_DISPOSABLE_GUEST === '1';

test('Gecko companion authenticates and acknowledges the desktop policy', { skip: !enabled, timeout: 60000 }, async () => {
  const { GECKO_BINARY, GECKO_KIND, GECKO_SOURCE, GECKO_LOG, GECKO_CONFIG, WEB_EXT, GECKO_PORT } = process.env;
  assert.ok(GECKO_BINARY && GECKO_KIND && GECKO_SOURCE && GECKO_LOG && GECKO_CONFIG && WEB_EXT && GECKO_PORT,
    'Set GECKO_BINARY, GECKO_KIND, GECKO_SOURCE, GECKO_LOG, GECKO_CONFIG, WEB_EXT and GECKO_PORT');
  const config = JSON.parse(await readFile(GECKO_CONFIG, 'utf8'));
  assert.equal(config.port, Number(GECKO_PORT), 'desktop bridge must use the requested port');
  for (const binary of [GECKO_BINARY, '/Applications/Firefox.app/Contents/MacOS/firefox', '/Applications/Zen.app/Contents/MacOS/zen']) {
    const pattern = `^${binary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`;
    const check = spawnSync('/usr/bin/pgrep', ['-f', pattern], { stdio: 'ignore' });
    assert.equal(check.status, 1, 'close all Gecko browsers in the disposable guest before testing');
  }
  const offset = (await stat(GECKO_LOG)).size;
  const child = spawn(WEB_EXT, ['run', '--source-dir', GECKO_SOURCE, '--firefox', GECKO_BINARY, '--no-reload'], { stdio: 'ignore', detached: true });
  try {
    const deadline = Date.now() + 45000;
    let matched = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) assert.fail(`web-ext exited before acknowledgement: ${child.exitCode}`);
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
    assert.ok(matched, 'no authenticated Gecko connection and matching policy ACK');
  } finally {
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
});
