import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUniversal } from './build-macos-universal.mjs';

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'universal build '));
  const target = join(cwd, 'custom target');
  for (const arch of ['aarch64-apple-darwin', 'x86_64-apple-darwin']) {
    const dir = join(target, arch, 'release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pomotroid-native-host'), 'host');
  }
  return { cwd, target };
}

test('builds, joins and verifies both binaries before bundling with updater config', () => {
  const { cwd, target } = fixture();
  const oldTarget = process.env.CARGO_TARGET_DIR;
  process.env.CARGO_TARGET_DIR = target;
  const calls = [];
  try {
    buildUniversal({ cwd, updater: true, run: (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; } });
    const config = ['--config', '{"bundle":{"createUpdaterArtifacts":true}}'];
    const universal = join(target, 'universal-apple-darwin', 'release');
    assert.deepEqual(calls, [
      ['npm', ['run', 'tauri', '--', 'build', '--no-bundle', '--target', 'universal-apple-darwin', ...config]],
      ['lipo', ['-create', join(target, 'aarch64-apple-darwin', 'release', 'pomotroid-native-host'), join(target, 'x86_64-apple-darwin', 'release', 'pomotroid-native-host'), '-output', join(universal, 'pomotroid-native-host')]],
      ['lipo', [join(universal, 'pomotroid'), '-verify_arch', 'arm64', 'x86_64']],
      ['lipo', [join(universal, 'pomotroid-native-host'), '-verify_arch', 'arm64', 'x86_64']],
      ['npm', ['run', 'tauri', '--', 'bundle', '--target', 'universal-apple-darwin', '--bundles', 'app,dmg', ...config]],
    ]);
  } finally {
    if (oldTarget === undefined) delete process.env.CARGO_TARGET_DIR; else process.env.CARGO_TARGET_DIR = oldTarget;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('stops before bundling when build or architecture verification fails', () => {
  for (const failedCall of [0, 2, 3]) {
    const { cwd, target } = fixture();
    const oldTarget = process.env.CARGO_TARGET_DIR;
    process.env.CARGO_TARGET_DIR = target;
    const calls = [];
    try {
      assert.throws(() => buildUniversal({ cwd, run: (cmd, args) => { calls.push([cmd, args]); return { status: calls.length - 1 === failedCall ? 1 : 0 }; } }));
      assert.equal(calls.length, failedCall + 1);
    } finally {
      if (oldTarget === undefined) delete process.env.CARGO_TARGET_DIR; else process.env.CARGO_TARGET_DIR = oldTarget;
      rmSync(cwd, { recursive: true, force: true });
    }
  }
});

test('uses the default target directory and rejects a missing native host', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'universal default '));
  const oldTarget = process.env.CARGO_TARGET_DIR;
  delete process.env.CARGO_TARGET_DIR;
  const calls = [];
  try {
    assert.throws(() => buildUniversal({ cwd, run: (cmd, args) => { calls.push([cmd, args]); return { status: 0 }; } }), /Native host missing/);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0][1].includes('--config'));
  } finally {
    if (oldTarget !== undefined) process.env.CARGO_TARGET_DIR = oldTarget;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('propagates command execution errors', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'universal error '));
  try {
    assert.throws(() => buildUniversal({ cwd, run: () => ({ error: new Error('spawn failed') }) }), /spawn failed/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('resolves a relative Cargo target from src-tauri and passes it to every command', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'universal relative '));
  const oldTarget = process.env.CARGO_TARGET_DIR;
  const target = join(cwd, 'src-tauri', 'relative target');
  process.env.CARGO_TARGET_DIR = 'relative target';
  for (const arch of ['aarch64-apple-darwin', 'x86_64-apple-darwin']) {
    const dir = join(target, arch, 'release');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pomotroid-native-host'), 'host');
  }
  const calls = [];
  try {
    buildUniversal({ cwd, run: (cmd, args, options) => { calls.push({ cmd, args, options }); return { status: 0 }; } });
    assert.equal(calls.length, 5);
    assert.ok(calls.every(({ options }) => options.env.CARGO_TARGET_DIR === target));
    assert.deepEqual(calls[1].args, ['-create', join(target, 'aarch64-apple-darwin', 'release', 'pomotroid-native-host'), join(target, 'x86_64-apple-darwin', 'release', 'pomotroid-native-host'), '-output', join(target, 'universal-apple-darwin', 'release', 'pomotroid-native-host')]);
    assert.deepEqual(calls.map(({ cmd }) => cmd), ['npm', 'lipo', 'lipo', 'lipo', 'npm']);
  } finally {
    if (oldTarget === undefined) delete process.env.CARGO_TARGET_DIR; else process.env.CARGO_TARGET_DIR = oldTarget;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('real lipo accepts universal binaries and rejects a thin main binary', { skip: process.platform !== 'darwin' }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'universal real '));
  const target = join(cwd, 'target');
  const oldTarget = process.env.CARGO_TARGET_DIR;
  process.env.CARGO_TARGET_DIR = target;
  const source = join(cwd, 'sample.c');
  writeFileSync(source, 'int sample(void) { return 0; }\n');
  const runReal = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, `${command} failed: ${result.stderr}`);
  };
  try {
    const hosts = ['aarch64-apple-darwin', 'x86_64-apple-darwin'].map((triple, i) => {
      const dir = join(target, triple, 'release');
      mkdirSync(dir, { recursive: true });
      const host = join(dir, 'pomotroid-native-host');
      runReal('clang', ['-arch', ['arm64', 'x86_64'][i], '-c', source, '-o', host]);
      return host;
    });
    const release = join(target, 'universal-apple-darwin', 'release');
    mkdirSync(release, { recursive: true });
    const main = join(release, 'pomotroid');
    runReal('lipo', ['-create', ...hosts, '-output', main]);
    let bundled = false;
    const run = (command, args, options) => {
      if (command === 'npm') {
        if (args.includes('bundle')) bundled = true;
        return { status: 0 };
      }
      return spawnSync(command, args, options);
    };
    buildUniversal({ cwd, run });
    assert.equal(bundled, true);
    writeFileSync(main, readFileSync(hosts[0]));
    bundled = false;
    assert.throws(() => buildUniversal({ cwd, run }));
    assert.equal(bundled, false);
  } finally {
    if (oldTarget === undefined) delete process.env.CARGO_TARGET_DIR; else process.env.CARGO_TARGET_DIR = oldTarget;
    rmSync(cwd, { recursive: true, force: true });
  }
});
