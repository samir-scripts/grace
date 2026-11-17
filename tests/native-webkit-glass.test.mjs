import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Chromium supports prefers-reduced-transparency; system WebKit can evaluate both
// the feature and its negation as false. Exercise the actual desktop engine.
test('native WebKit exposes acknowledged Glass and keeps fallback styles opaque', {
  skip: process.platform !== 'darwin',
}, () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const scratch = mkdtempSync(path.join(tmpdir(), 'grace-webkit-glass-'));
  try {
    const executable = path.join(scratch, 'glass-probe');
    execFileSync('/usr/bin/xcrun', [
      'swiftc', '-module-cache-path', path.join(scratch, 'module-cache'),
      path.join(root, 'tests/fixtures/native-webkit-glass.swift'), '-o', executable,
    ], { timeout: 60_000, stdio: 'pipe' });
    const output = execFileSync(executable, [path.join(root, 'src/app.css')], {
      timeout: 30_000, encoding: 'utf8',
    });
    const line = output.split('\n').find(line => line.startsWith('GLASS_PROBE:'));
    assert.ok(line, 'native engine returned composition evidence');
    const result = JSON.parse(line.slice('GLASS_PROBE:'.length));
    assert.deepEqual(result.frosted, {
      html: 'rgba(0, 0, 0, 0)', body: 'rgba(24, 26, 27, 0.6)',
    }, JSON.stringify(result));
    for (const state of [result.opaque, result.otherStyle]) {
      assert.deepEqual(state, { html: 'rgb(47, 56, 75)', body: 'rgb(47, 56, 75)' });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
