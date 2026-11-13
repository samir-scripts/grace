import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifyTag, validateVersions, validateAcceptance } from './release-policy.mjs';

const sha = 'a'.repeat(40);
const hashes = { 'windows-x64': 'b'.repeat(64), 'ubuntu-x64': 'c'.repeat(64) };
const cases = Object.fromEntries(['installation', 'automatic_pairing', 'profile_assignment', 'policy_ack', 'existing_tabs', 'fresh_http', 'fresh_https', 'subdomains', 'allowed_control', 'browser_restart', 'app_restart', 'crash_recovery', 'disconnect_withdrawal', 'natural_completion', 'emergency_release', 'restored_access'].map((name) => [name, 'passed']));
const reports = () => Object.keys(hashes).map((platform) => ({ platform, source_revision: sha, package_sha256: hashes[platform], os_version: 'test', chrome_version: 'test', architecture: 'x86_64', review: { pr_url: 'https://github.com/samir-scripts/grace/pull/42', reviewer: 'reviewer', approved: true }, cases: { ...cases } }));
const versions = () => ({ package: '1.7.2-beta.1', lock: '1.7.2-beta.1', lockRoot: '1.7.2-beta.1', tauri: '1.7.2-beta.1', cargo: '1.7.2-beta.1', cargoLock: '1.7.2-beta.1' });

test('classifies only stable and beta semver tags', () => {
  assert.deepEqual(classifyTag('v1.7.2-beta.1'), { version: '1.7.2-beta.1', prerelease: 'true' });
  assert.deepEqual(classifyTag('v1.7.2'), { version: '1.7.2', prerelease: 'false' });
  for (const tag of ['1.7.2', 'refs/tags/v1.7.2', 'v1.7', 'v01.7.2', 'v1.7.2-beta.01', 'v1.7.2-rc.1', 'v1.7.2+build', '']) assert.throws(() => classifyTag(tag));
});

test('requires every manifest version to match the tag', () => {
  assert.doesNotThrow(() => validateVersions('1.7.2-beta.1', versions()));
  for (const key of Object.keys(versions())) assert.throws(() => validateVersions('1.7.2-beta.1', { ...versions(), [key]: '1.7.1' }));
});

test('accepts complete reviewed reports bound to source and artifacts', () => {
  assert.doesNotThrow(() => validateAcceptance(reports(), { sourceRevision: sha, artifactHashes: hashes }));
});

test('rejects missing, stale, unreviewed, failed and mismatched reports', () => {
  const options = { sourceRevision: sha, artifactHashes: hashes };
  assert.throws(() => validateAcceptance([], options));
  assert.throws(() => validateAcceptance(reports().slice(0, 1), options));
  for (const mutate of [
    (r) => r.source_revision = 'd'.repeat(40),
    (r) => r.package_sha256 = 'd'.repeat(64),
    (r) => r.review.approved = false,
    (r) => r.review.reviewer = ' ',
    (r) => r.review.pr_url = 'https://example.com/pull/1',
    (r) => r.cases.fresh_http = 'failed',
    (r) => r.cases.fresh_https = 'skipped',
    (r) => delete r.cases.installation,
    (r) => r.architecture = 'arm64',
    (r) => r.chrome_version = '',
  ]) { const input = reports(); mutate(input[0]); assert.throws(() => validateAcceptance(input, options)); }
  assert.throws(() => validateAcceptance(reports(), { ...options, sourceRevision: 'bad' }));
  assert.throws(() => validateAcceptance(reports(), { ...options, artifactHashes: {} }));
});

test('CLI allows beta without reports and stable fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'grace-policy-'));
  try {
    mkdirSync(join(dir, 'src-tauri'));
    const v = '1.7.2-beta.1';
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: v }));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ version: v, packages: { '': { version: v } } }));
    writeFileSync(join(dir, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: v }));
    writeFileSync(join(dir, 'src-tauri/Cargo.toml'), `[package]\nname = "pomotroid"\nversion = "${v}"\n`);
    writeFileSync(join(dir, 'src-tauri/Cargo.lock'), `version = 4\n[[package]]\nname = "pomotroid"\nversion = "${v}"\n`);
    const script = resolve('scripts/release-policy.mjs');
    const output = join(dir, 'output');
    assert.equal(execFileSync(process.execPath, [script, '--tag', `v${v}`], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' }), `version=${v}\nprerelease=true\n`);
    assert.equal(readFileSync(output, 'utf8'), `version=${v}\nprerelease=true\n`);
    const stableVersion = '1.7.2';
    for (const file of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
      const path = join(dir, file);
      writeFileSync(path, readFileSync(path, 'utf8').replaceAll(v, stableVersion));
    }
    const stable = spawnSync(process.execPath, [script, '--tag', `v${stableVersion}`], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(stable.status, 0);
    assert.match(stable.stderr, /require reports/);
    const reportPath = join(dir, 'reports.json');
    const artifactPath = join(dir, 'artifacts.json');
    writeFileSync(reportPath, JSON.stringify(reports()));
    writeFileSync(artifactPath, JSON.stringify(hashes));
    assert.equal(execFileSync(process.execPath, [script, '--tag', `v${stableVersion}`, '--reports', reportPath, '--artifacts', artifactPath, '--source-revision', sha], { cwd: dir, encoding: 'utf8' }), `version=${stableVersion}\nprerelease=false\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
