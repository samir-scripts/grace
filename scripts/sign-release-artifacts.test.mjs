import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signReleaseArtifacts } from './sign-release-artifacts.mjs';

const encode = (text) => Buffer.from(text).toString('base64');
const binary = (length, prefix) => { const b = Buffer.alloc(length, 1); b.write(prefix); return b.toString('base64'); };
const publicKey = encode(`untrusted comment: minisign public key\n${binary(42, 'Ed')}\n`);
const signature = encode(`untrusted comment: signature\n${binary(74, 'ED')}\ntrusted comment: test\n${binary(64, 'xx')}\n`);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sign-gate-'));
  mkdirSync(join(root, 'src-tauri'), { recursive: true });
  mkdirSync(join(root, 'dist', 'nested'), { recursive: true });
  writeFileSync(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ plugins: { updater: { pubkey: publicKey } } }));
  return root;
}
const options = (root, executor, env = {}) => ({ root, artifactDir: 'dist', executor, env });

test('verifies every existing package signature without signing', () => {
  const root = fixture();
  try {
    const names = ['nested/a.deb','nested/b.dmg','nested/c.AppImage','d.rpm','e-setup.exe','f.app.tar.gz'];
    for (const name of names) { writeFileSync(join(root, 'dist', name), name); writeFileSync(join(root, 'dist', `${name}.sig`), signature); }
    const paths = [];
    const result = signReleaseArtifacts(options(root, (cmd, args) => {
      assert.equal(cmd, 'minisign');
      assert.equal(args[0], '-Vm');
      assert.equal(statSync(args[3]).mode & 0o777, 0o600);
      assert.equal(statSync(args[5]).mode & 0o777, 0o600);
      assert.match(readFileSync(args[3], 'utf8'), /^untrusted comment:/);
      paths.push(args[3], args[5]);
      return { status: 0 };
    }));
    assert.equal(result.length, 6);
    for (const p of paths) assert.equal(existsSync(p), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('signs a missing signature without passing credentials in arguments, then verifies', () => {
  const root = fixture();
  try {
    const file = join(root, 'dist', 'a.deb');
    writeFileSync(file, 'package');
    const calls = [];
    signReleaseArtifacts(options(root, (cmd, args, config) => {
      calls.push({ cmd, args });
      if (cmd !== 'minisign') { assert.equal(config.env.TAURI_SIGNING_PRIVATE_KEY, 'fake-secret'); writeFileSync(`${file}.sig`, signature); }
      return { status: 0 };
    }, { TAURI_SIGNING_PRIVATE_KEY: 'fake-secret', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'fake-password' }));
    assert.deepEqual(calls[0].args, ['signer', 'sign', file]);
    assert.equal(calls[1].cmd, 'minisign');
    assert.equal(JSON.stringify(calls).includes('fake-secret'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects malformed signatures, missing credentials and failed commands without leaking diagnostics', () => {
  for (const mode of ['missing-key', 'bad-signature', 'bad-key', 'signer-failure', 'verify-failure', 'verify-missing']) {
    const root = fixture();
    try {
      const file = join(root, 'dist/a.deb');
      writeFileSync(file, 'package');
      if (['bad-signature', 'verify-failure', 'verify-missing'].includes(mode)) writeFileSync(`${file}.sig`, mode === 'bad-signature' ? 'bad' : signature);
      if (mode === 'bad-key') writeFileSync(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ plugins: { updater: { pubkey: 'not-base64!' } } }));
      assert.throws(() => signReleaseArtifacts(options(root, () => ({ status: mode === 'verify-missing' ? null : 1, stderr: 'TOP_SECRET', error: Error('TOP_SECRET') }), mode === 'missing-key' ? {} : { TAURI_SIGNING_PRIVATE_KEY: 'fake' })), (error) => !error.message.includes('TOP_SECRET') && error.message.length > 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('rejects empty package trees and symlinked artifacts', () => {
  const root = fixture();
  try {
    assert.throws(() => signReleaseArtifacts(options(root, () => ({ status: 0 }))));
    symlinkSync('/tmp', join(root, 'dist/link'));
    assert.throws(() => signReleaseArtifacts(options(root, () => ({ status: 0 }))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('exports the validated public key and preserves a different existing key', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'dist/a.deb'), 'package');
    writeFileSync(join(root, 'dist/a.deb.sig'), signature);
    const keyPath = join(root, 'dist/grace-updater.pub');
    signReleaseArtifacts(options(root, () => ({ status: 0 })));
    assert.equal(readFileSync(keyPath, 'utf8'), Buffer.from(publicKey, 'base64').toString());
    signReleaseArtifacts(options(root, () => ({ status: 0 })));
    writeFileSync(keyPath, 'different');
    assert.throws(() => signReleaseArtifacts(options(root, () => ({ status: 0 }))));
    assert.equal(readFileSync(keyPath, 'utf8'), 'different');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
