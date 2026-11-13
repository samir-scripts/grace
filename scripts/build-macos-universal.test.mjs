import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
      ['lipo', ['-verify_arch', 'arm64', 'x86_64', join(universal, 'pomotroid')]],
      ['lipo', ['-verify_arch', 'arm64', 'x86_64', join(universal, 'pomotroid-native-host')]],
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
