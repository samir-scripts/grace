import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const canonicalRunId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export function validateBridgeFixtureBinary(binaryPath, runId, { guestRoot = '/Users/admin/grace-acceptance', fsApi = fs, pathApi = path, uid = typeof process.getuid === 'function' ? process.getuid() : null } = {}) {
  if (!canonicalRunId(runId) || typeof binaryPath !== 'string' || !pathApi.isAbsolute(binaryPath) || uid == null) {
    throw new Error('invalid prebuilt bridge fixture path or run ID');
  }
  try {
    const expectedRunDir = pathApi.join(fsApi.realpathSync(guestRoot), runId);
    const actualRunDir = fsApi.realpathSync(expectedRunDir);
    const actualBinary = fsApi.realpathSync(binaryPath);
    const stat = fsApi.lstatSync(binaryPath);
    const relative = pathApi.relative(actualRunDir, actualBinary);
    if (actualRunDir !== expectedRunDir || actualBinary !== binaryPath || stat.isSymbolicLink() || !stat.isFile() || stat.uid !== uid || !relative || relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
      throw new Error('unsafe prebuilt bridge fixture');
    }
    fsApi.accessSync(actualBinary, fsApi.constants.X_OK);
    return actualBinary;
  } catch {
    throw new Error('prebuilt bridge fixture must be an executable regular file inside the current owned run directory');
  }
}

export function isOwnedDisposableGuest({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
  markerPath = '/Users/admin/.grace-disposable-guest.json',
  fsApi = fs,
} = {}) {
  if (env.POMOTROID_DISPOSABLE_GUEST !== '1' || platform !== 'darwin' || home !== '/Users/admin' || uid == null || uid === 0) return false;
  const runId = env.POMOTROID_DISPOSABLE_RUN_ID;
  if (typeof runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId)) return false;
  try {
    const stat = fsApi.lstatSync(markerPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid) return false;
    const marker = JSON.parse(fsApi.readFileSync(markerPath, 'utf8'));
    return canonicalRunId(runId) && marker.run_id === runId && marker.vm_name === `grace-acceptance-${runId}`;
  } catch {
    return false;
  }
}

test('guest guard requires explicit opt-in, admin macOS context, and matching owned marker', () => {
  const runId = '4c83a270-5a5e-48fc-a6d1-35328fedf802';
  const marker = { run_id: runId, vm_name: `grace-acceptance-${runId}` };
  const stat = { uid: 501, isFile: () => true, isSymbolicLink: () => false };
  const fsApi = { lstatSync: () => stat, readFileSync: () => JSON.stringify(marker) };
  const valid = { env: { POMOTROID_DISPOSABLE_GUEST: '1', POMOTROID_DISPOSABLE_RUN_ID: runId }, platform: 'darwin', home: '/Users/admin', uid: 501, markerPath: '/marker', fsApi };
  assert.equal(isOwnedDisposableGuest(valid), true);
  assert.equal(isOwnedDisposableGuest({ ...valid, env: { ...valid.env, POMOTROID_DISPOSABLE_GUEST: undefined } }), false);
  assert.equal(isOwnedDisposableGuest({ ...valid, platform: 'linux' }), false);
  assert.equal(isOwnedDisposableGuest({ ...valid, home: '/Users/other' }), false);
  assert.equal(isOwnedDisposableGuest({ ...valid, uid: 0 }), false);
  assert.equal(isOwnedDisposableGuest({ ...valid, env: { ...valid.env, POMOTROID_DISPOSABLE_RUN_ID: 'not-a-uuid' } }), false);
  assert.equal(isOwnedDisposableGuest({ ...valid, fsApi: { ...fsApi, readFileSync: () => JSON.stringify({ ...marker, vm_name: 'foreign-vm' }) } }), false);
  assert.equal(isOwnedDisposableGuest({ ...valid, fsApi: { ...fsApi, lstatSync: () => ({ ...stat, isSymbolicLink: () => true }) } }), false);
});

test('prebuilt bridge fixture must be canonical, executable, owned, and inside the run directory', t => {
  const runId = '4c83a270-5a5e-48fc-a6d1-35328fedf802';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grace-bridge-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runDir = path.join(fs.realpathSync(root), runId);
  fs.mkdirSync(path.join(runDir, 'bin'), { recursive: true });
  const binary = path.join(runDir, 'bin/focus_bridge_fixture');
  fs.writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const uid = fs.statSync(binary).uid;
  assert.equal(validateBridgeFixtureBinary(binary, runId, { guestRoot: root, uid }), binary);
  assert.throws(() => validateBridgeFixtureBinary(binary, runId, { guestRoot: root, uid: uid + 1 }));
  assert.throws(() => validateBridgeFixtureBinary(path.join(root, 'outside'), runId, { guestRoot: root, uid }));
  assert.throws(() => validateBridgeFixtureBinary(binary, 'bad-run-id', { guestRoot: root, uid }));
  const link = path.join(runDir, 'bin/fixture-link');
  fs.symlinkSync(binary, link);
  assert.throws(() => validateBridgeFixtureBinary(link, runId, { guestRoot: root, uid }));
});

const disposableGuest = isOwnedDisposableGuest();

test('installed extension applies and releases policies from the Rust desktop bridge', { timeout: 90000, skip: disposableGuest ? false : 'requires runner-managed opt-in and matching disposable guest marker' }, async () => {
  const runId = process.env.POMOTROID_DISPOSABLE_RUN_ID;
  const fixtureBinary = process.env.POMOTROID_BRIDGE_FIXTURE_BINARY
    ? validateBridgeFixtureBinary(process.env.POMOTROID_BRIDGE_FIXTURE_BINARY, runId)
    : null;
  const build = spawnSync(process.execPath, [path.resolve('scripts/build-browser-extensions.mjs'), '--development'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr || build.error?.message || 'Chrome extension development build failed');
  const portServer = net.createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const server = http.createServer((req, res) => res.end('<h1>fixture content</h1>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const child = fixtureBinary
    ? spawn(fixtureBinary, [String(port)], { stdio: ['pipe', 'pipe', 'inherit'] })
    : spawn('cargo', ['run', '--quiet', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'focus_bridge_fixture', '--', String(port)], { stdio: ['pipe', 'pipe', 'inherit'] });
  const spawned = new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', error => reject(new Error(`Unable to start bridge fixture (${error.code || 'spawn error'})`)));
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => {
    let timeout;
    try {
      const result = await Promise.race([lines.next(), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('bridge response timeout')), 15000);
      })]);
      assert.equal(result.done, false, 'bridge exited unexpectedly');
      return result.value;
    } finally {
      clearTimeout(timeout);
    }
  };
  const command = async text => { child.stdin.write(text + '\n'); return next(); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomotroid-bridge-'));
  let context;
  try {
    await spawned;
    assert.equal(await next(), 'ready');
    const ext = path.resolve('extensions/dist/chrome');
    context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    assert.equal(id, 'ddiojihepmbimcfoefnebpolgaljlcfn');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.evaluate(port => chrome.storage.local.set({ port }), port);
    await options.click('#consentAccept');
    await options.locator('#advanced summary').click();
    await options.fill('#token', 'fixture-token');
    await options.fill('#profileId', 'fixture-profile');
    await options.click('#save');
    await options.close();
    const deadline = Date.now() + 10000;
    while (await command('status') !== 'true') {
      if (Date.now() > deadline) throw new Error('extension did not connect to Rust bridge');
      await delay(100);
    }
    const page = await context.newPage();
    await page.goto(url);
    assert.match(await page.content(), /fixture content/);
    assert.equal(await command('apply'), 'applied');
    await page.waitForURL(`chrome-extension://${id}/blocked.html**`, { timeout: 5000 });
    const nextPage = await context.newPage();
    await assert.rejects(nextPage.goto(url), /ERR_BLOCKED_BY_CLIENT/);
    const cdp = await context.newCDPSession(nextPage);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    const stoppedDeadline = Date.now() + 5000;
    while (await command('status') !== 'false') {
      if (Date.now() > stoppedDeadline) throw new Error('extension worker did not disconnect');
      await delay(100);
    }
    await page.bringToFront();
    const reconnectDeadline = Date.now() + 10000;
    while (await command('status') !== 'true') {
      if (Date.now() > reconnectDeadline) throw new Error('extension did not reconnect after worker stop');
      await delay(100);
    }
    await assert.rejects(nextPage.goto(url), /ERR_BLOCKED_BY_CLIENT/);
    await cdp.detach();
    assert.equal(await command('release'), 'released');
    await nextPage.goto(url);
    assert.match(await nextPage.content(), /fixture content/);
  } finally {
    if (context) await context.close();
    child.stdin?.end('quit\n');
    if (child.pid) child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  }
});
