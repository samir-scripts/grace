import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRelease } from './prepare-release.mjs';

const source = 'a'.repeat(40);
const head = 'd'.repeat(40);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const cases = Object.fromEntries(['installation','automatic_pairing','profile_assignment','policy_ack','existing_tabs','fresh_http','fresh_https','subdomains','allowed_control','browser_restart','app_restart','crash_recovery','disconnect_withdrawal','natural_completion','emergency_release','restored_access'].map((c) => [c, 'passed']));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-prep-'));
  mkdirSync(join(root, 'dist', 'nested'), { recursive: true });
  for (const [file, bytes] of Object.entries({ 'nested/app-setup.exe': 'windows', 'nested/app-setup.exe.sig': 'signature', 'nested/app.deb': 'linux', 'nested/app.deb.sig': 'signature', 'app.dmg': 'mac', 'app.dmg.sig': 'signature', 'grace..app.tar.gz': 'mac updater archive', 'grace..app.tar.gz.sig': 'mac updater signature', 'app.AppImage': 'appimage', 'app.AppImage.sig': 'signature', 'grace-updater.pub': 'public verification key', 'latest.json': 'unsafe feed' })) writeFileSync(join(root, 'dist', file), bytes);
  return root;
}
function reports(root) {
  const items = [['windows-x64', 'windows'], ['ubuntu-x64', 'linux']].map(([platform, bytes]) => ({ platform, source_revision: source, package_sha256: hash(bytes), os_version: 'test', chrome_version: 'test', architecture: 'x86_64', review: { pr_url: 'https://github.com/samir-scripts/grace/pull/42', reviewer: 'reviewer', approved: true }, cases }));
  writeFileSync(join(root, 'reports.json'), JSON.stringify(items));
  return items;
}
const reviewLookup = (root) => {
  const bytes = readFileSync(join(root, 'reports.json'));
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  return { headSha: head, author: 'author', files: [{ filename: 'reports.json', sha }], reviews: [{ user: { login: 'reviewer' }, state: 'APPROVED', commit_id: head }] };
};
const opts = (root) => ({ root, tag: 'v1.7.2', sourceRevision: source, reportsPath: 'reports.json', reviewLookup: () => reviewLookup(root) });

test('beta packages actual bytes and excludes updater feed without consulting reviews', async () => {
  const root = fixture();
  try {
    const result = await prepareRelease({ root, tag: 'v1.7.2-beta.1', sourceRevision: source, reviewLookup: () => { throw Error('unexpected lookup'); } });
    assert.equal(result.prerelease, 'true');
    assert.equal(readFileSync(join(root, 'release-assets/grace-windows-x64-1.7.2-beta.1-setup.exe'), 'utf8'), 'windows');
    assert.equal(readFileSync(join(root, 'release-assets/grace-windows-x64-1.7.2-beta.1-setup.exe.sig'), 'utf8'), 'signature');
    assert.equal(existsSync(join(root, 'release-assets/latest.json')), false);
    const provenance = JSON.parse(readFileSync(join(root, 'release-assets/provenance.json')));
    assert.equal(provenance.platforms['windows-x64'].sha256, hash('windows'));
    assert.equal(provenance.platforms['ubuntu-x64'].status, 'unverified / deferred to contributors');
    assert.match(readFileSync(join(root, 'release-assets/SHA256SUMS'), 'utf8'), new RegExp(hash('linux')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stable packages require reviewed reports for the exact package hashes', async () => {
  const root = fixture();
  try {
    reports(root);
    const result = await prepareRelease(opts(root));
    assert.equal(result.artifactHashes['windows-x64'], hash('windows'));
    assert.equal(JSON.parse(readFileSync(join(root, 'release-assets/provenance.json'))).platforms['windows-x64'].status, 'accepted');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stable rejects stale reports, changed packages, and unverified reviews without output', async () => {
  for (const variation of ['stale', 'hash', 'unapproved', 'wrong-head', 'self-review', 'unrelated-file', 'later-changes']) {
    const root = fixture();
    try {
      const items = reports(root);
      if (variation === 'stale') items[0].source_revision = 'b'.repeat(40);
      if (variation === 'hash') items[0].package_sha256 = 'b'.repeat(64);
      writeFileSync(join(root, 'reports.json'), JSON.stringify(items));
      const lookup = () => {
        const review = reviewLookup(root);
        if (variation === 'unapproved') review.reviews[0].state = 'COMMENTED';
        if (variation === 'wrong-head') review.reviews[0].commit_id = source;
        if (variation === 'self-review') review.author = 'reviewer';
        if (variation === 'unrelated-file') review.files = [{ filename: 'other.json', sha: 'a'.repeat(40) }];
        if (variation === 'later-changes') review.reviews.push({ user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', commit_id: head });
        return review;
      };
      await assert.rejects(prepareRelease({ ...opts(root), reviewLookup: lookup }), variation);
      assert.equal(existsSync(join(root, 'release-assets')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('missing or duplicate packages and invalid revision leave existing output untouched', async () => {
  for (const kind of ['missing', 'duplicate', 'revision', 'existing']) {
    const root = fixture();
    try {
      if (kind === 'missing') rmSync(join(root, 'dist/app.dmg'));
      if (kind === 'duplicate') writeFileSync(join(root, 'dist/second.deb'), 'other');
      if (kind === 'existing') { mkdirSync(join(root, 'release-assets')); writeFileSync(join(root, 'release-assets/keep'), 'keep'); }
      await assert.rejects(prepareRelease({ root, tag: 'v1.7.2-beta.1', sourceRevision: kind === 'revision' ? 'bad' : source }));
      if (kind === 'existing') assert.deepEqual(readdirSync(join(root, 'release-assets')), ['keep']);
      else assert.equal(existsSync(join(root, 'release-assets')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});


test('stable without reports and duplicate retained filenames fail before writing', async () => {
  const root = fixture();
  try {
    await assert.rejects(prepareRelease({ root, tag: 'v1.7.2', sourceRevision: source }));
    mkdirSync(join(root, 'dist/other'));
    writeFileSync(join(root, 'dist/other/app.AppImage'), 'duplicate');
    await assert.rejects(prepareRelease({ root, tag: 'v1.7.2-beta.1', sourceRevision: source }));
    assert.equal(existsSync(join(root, 'release-assets')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI prepares a beta from the given paths', () => {
  const root = fixture();
  try {
    const result = JSON.parse(execFileSync(process.execPath, [join(process.cwd(), 'scripts/prepare-release.mjs'), '--tag', 'v1.7.2-beta.1', '--artifacts', 'dist', '--output', 'out', '--source-revision', source], { cwd: root, encoding: 'utf8' }));
    assert.equal(result.prerelease, 'true');
    assert.equal(existsSync(join(root, 'out/latest.json')), false);
    assert.equal(existsSync(join(root, 'out/SHA256SUMS')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects report bytes changed after the evidence PR was reviewed', async () => {
  const root = fixture();
  try {
    const items = reports(root);
    const reviewedBytes = readFileSync(join(root, 'reports.json'));
    const blobSha = createHash('sha1').update(`blob ${reviewedBytes.length}\0`).update(reviewedBytes).digest('hex');
    items[0].extra = 'changed after review';
    writeFileSync(join(root, 'reports.json'), JSON.stringify(items));
    const lookup = () => ({ ...reviewLookup(root), files: [{ filename: 'reports.json', sha: blobSha }] });
    await assert.rejects(prepareRelease({ ...opts(root), reviewLookup: lookup }), /blob|report/i);
    assert.equal(existsSync(join(root, 'release-assets')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('renamed package keeps its detached signature under the matching public name', async t => {
  const root = mkdtempSync(join(tmpdir(), 'grace-signature-name-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'dist'));
  for (const name of ['grace-setup.exe','grace-setup.exe.sig','grace.deb','grace.deb.sig','grace.dmg','grace.dmg.sig','grace.deb.asc','grace-updater.pub']) writeFileSync(join(root,'dist',name),'synthetic '+name);
  const result=await prepareRelease({root,tag:'v1.7.2-beta.1',sourceRevision:'a'.repeat(40)});
  assert.ok(result.assets.includes('grace-ubuntu-x64-1.7.2-beta.1.deb.asc'));
  assert.equal(result.assets.includes('grace.deb.asc'),false);
});


test('stable Ubuntu DEB evidence does not publish unaccepted Linux formats', async t => {
 const root=fixture(); t.after(()=>rmSync(root,{recursive:true,force:true})); reports(root);
 writeFileSync(join(root,'dist/app.rpm'),'unaccepted rpm');
 writeFileSync(join(root,'dist/app.AppImage.sig'),'unaccepted format signature');
 const result=await prepareRelease(opts(root));
 assert.equal(result.assets.some(name=>/\.(?:AppImage|rpm)(?:\.(?:sig|asc))?$/.test(name)),false);
});


test('all public package formats require a detached signature before assembly', async () => {
  for (const file of ['nested/app-setup.exe', 'nested/app.deb', 'app.dmg', 'app.AppImage', 'extra.rpm', 'grace..app.tar.gz']) {
    const root = fixture();
    try {
      for (const path of ['nested/app-setup.exe', 'nested/app.deb', 'app.dmg', 'app.AppImage']) writeFileSync(join(root, 'dist', path + '.sig'), 'signature');
      if (file.startsWith('extra.')) writeFileSync(join(root, 'dist', file), 'extra package');
      rmSync(join(root, 'dist', file + '.sig'), { force: true });
      await assert.rejects(prepareRelease({ root, tag: 'v1.7.2-beta.1', sourceRevision: source }), /signature/i);
      assert.equal(existsSync(join(root, 'release-assets')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});


test('normalizes double-dot macOS updater archive and its signature in checksums and provenance', async () => {
  const root = fixture();
  try {
    const archive = 'grace-macos-universal-1.7.2-beta.1.app.tar.gz';
    const result = await prepareRelease({ root, tag: 'v1.7.2-beta.1', sourceRevision: source });
    assert.ok(result.assets.includes(archive));
    assert.ok(result.assets.includes(archive + '.sig'));
    assert.equal(result.assets.includes('grace..app.tar.gz'), false);
    assert.equal(readFileSync(join(root, 'release-assets', archive), 'utf8'), 'mac updater archive');
    assert.equal(readFileSync(join(root, 'release-assets', archive + '.sig'), 'utf8'), 'mac updater signature');
    const sums = readFileSync(join(root, 'release-assets/SHA256SUMS'), 'utf8');
    assert.ok(sums.includes(`${hash('mac updater archive')}  ${archive}\n`));
    assert.ok(sums.includes(`${hash('mac updater signature')}  ${archive}.sig\n`));
    const provenance = JSON.parse(readFileSync(join(root, 'release-assets/provenance.json')));
    assert.ok(provenance.artifacts.some((entry) => entry.file === archive && entry.sha256 === hash('mac updater archive')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('stable fails closed on absent or duplicate updater archives', async () => {
  for (const kind of ['missing', 'duplicate']) {
    const root = fixture();
    try {
      reports(root);
      if (kind === 'missing') { rmSync(join(root, 'dist/grace..app.tar.gz')); rmSync(join(root, 'dist/grace..app.tar.gz.sig')); }
      else { writeFileSync(join(root, 'dist/second.app.tar.gz'), 'other'); writeFileSync(join(root, 'dist/second.app.tar.gz.sig'), 'signature'); }
      await assert.rejects(prepareRelease(opts(root)), /archive/i);
      assert.equal(existsSync(join(root, 'release-assets')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('beta permits no updater archive but rejects duplicates', async () => {
  for (const kind of ['missing', 'duplicate']) {
    const root = fixture();
    try {
      if (kind === 'missing') { rmSync(join(root, 'dist/grace..app.tar.gz')); rmSync(join(root, 'dist/grace..app.tar.gz.sig')); }
      else { writeFileSync(join(root, 'dist/second.app.tar.gz'), 'other'); writeFileSync(join(root, 'dist/second.app.tar.gz.sig'), 'signature'); }
      const run = prepareRelease({ root, tag: 'v1.7.2-beta.1', sourceRevision: source });
      if (kind === 'missing') await assert.doesNotReject(run);
      else { await assert.rejects(run, /archive/i); assert.equal(existsSync(join(root, 'release-assets')), false); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
