import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('./prepare-nightly.mjs', import.meta.url);
const tag = 'v1.7.2-nightly.20261118';
const beta = 'v1.7.2-beta.1';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'grace-nightly-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgSign=false', ...args], { cwd, encoding: 'utf8' }).trim();
  git('init', '-b', 'dev');
  mkdirSync(join(cwd, 'src-tauri'));
  const write = (path, text) => writeFileSync(join(cwd, path), text);
  const read = path => readFileSync(join(cwd, path), 'utf8');
  const files = {
    'package.json': '{"name":"grace","version":"1.7.2-beta.1"}\n',
    'package-lock.json': '{"version":"1.7.2-beta.1","packages":{"":{"version":"1.7.2-beta.1"},"other":{"version":"1.7.2-beta.1"}}}\n',
    'src-tauri/tauri.conf.json': '{"productName":"grace.","version":"1.7.2-beta.1"}\n',
    'src-tauri/Cargo.toml': '[package]\nname = "pomotroid"\nversion = "1.7.2-beta.1"\n',
    'src-tauri/Cargo.lock': 'version = 4\n\n[[package]]\nname = "pomotroid"\nversion = "1.7.2-beta.1"\n\n[[package]]\nname = "other"\nversion = "1.7.2-beta.1"\n',
    'CHANGELOG.md': '[v1.7.2-beta.1]\n\nPrior beta notes.\n',
    'app.txt': 'reviewed app source\n',
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  git('add', '.'); git('commit', '-qm', 'base'); git('tag', '-am', beta, beta);
  git('update-ref', 'refs/remotes/origin/dev', 'HEAD');
  const source = git('rev-parse', 'HEAD');
  git('checkout', '--quiet', '--detach', source);
  const run = (...args) => execFileSync(process.execPath, [decodeURIComponent(script.pathname), ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const install = () => {
    run('prepare', tag);
    git('add', '.'); git('commit', '-qm', 'nightly'); git('tag', '-am', tag, tag);
  };
  return { cwd, git, read, write, run, install, source };
}

test('prepares and verifies an exact, metadata-only descendant of dev', t => {
  const f = fixture(t);
  f.install();
  assert.equal(f.run('verify', tag), f.source);
  assert.equal(f.git('rev-parse', 'HEAD^'), f.source);
  assert.equal(f.git('rev-parse', 'dev'), f.source);
  const lock = JSON.parse(f.read('package-lock.json'));
  assert.equal(lock.version, tag.slice(1));
  assert.equal(lock.packages[''].version, tag.slice(1));
  assert.equal(lock.packages.other.version, '1.7.2-beta.1');
  assert.match(f.read('src-tauri/Cargo.lock'), /name = "other"\nversion = "1.7.2-beta.1"/);
  assert.match(f.read('CHANGELOG.md'), /^\[v1\.7\.2-nightly\.20261118\]\n/);
  assert.ok(f.read('CHANGELOG.md').includes(f.source));
});

test('rejects an annotated nightly that changes app source or has an unreviewed parent', t => {
  const f = fixture(t);
  f.run('prepare', tag);
  f.write('app.txt', 'different app source\n');
  f.git('add', '.'); f.git('commit', '-qm', 'nightly with extra code'); f.git('tag', '-am', tag, tag);
  assert.throws(() => f.run('verify', tag), /metadata only/);
  f.git('update-ref', '-d', 'refs/remotes/origin/dev');
  assert.throws(() => f.run('verify', tag), /parent is not on origin\/dev/);
});

test('chooses the next unused stable core and retains an existing nightly tag across midnight', t => {
  const f = fixture(t);
  f.git('tag', 'v1.7.2');
  assert.equal(f.run('tag', '20261118'), 'v1.7.3-nightly.20261118');
  f.git('tag', '-d', 'v1.7.2');
  f.install();
  f.git('checkout', '--detach', f.source);
  assert.equal(f.run('tag', '20261119'), tag);
});

test('scheduler requires exact green push checks and never dispatches a duplicate or replaces a daily tag', t => {
  const f = fixture(t);
  f.git('init', '--bare', 'remote.git');
  f.git('remote', 'add', 'origin', join(f.cwd, 'remote.git'));
  f.git('push', 'origin', 'dev:dev', `refs/tags/${beta}`);
  const invoke = (date, overrides = {}) => execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { schedule } from ${JSON.stringify(script.href)};
    import { createHash } from 'node:crypto';
    const input = JSON.parse(process.env.TEST_INPUT);
    const version = ${JSON.stringify(tag.slice(1))};
    const digest = text => createHash('sha256').update(text).digest('hex');
    const files = { 'grace-updater.pub': 'key', 'sample.rpm': 'artifact', 'sample.rpm.sig': 'signature' };
    const artifacts = Object.entries(files).map(([file, text]) => ({ file, sha256: digest(text) }));
    files['provenance.json'] = JSON.stringify({ version, prerelease: 'true', source_revision: input.completed, artifacts });
    files.SHA256SUMS = Object.entries(files).map(([name, text]) => digest(text) + '  ' + name).join('\\n') + '\\n';
    const assets = Object.entries(files).map(([name, text], i) => ({ id: i + 1, name, digest: 'sha256:' + digest(text), size: Buffer.byteLength(text), state: 'uploaded' }));
    const run = (extra = {}) => ({ id: 42, run_attempt: 1, head_sha: input.source, head_branch: 'dev', event: 'push',
      status: 'completed', conclusion: 'success', ...extra });
    const gh = (command, ...args) => {
      if (command === 'workflow') { console.log('DISPATCH', args[3]); return ''; }
      const endpoint = args.at(-1);
      if (endpoint.includes('/build.yml/')) return JSON.stringify([{ workflow_runs: [run(input.gate)] }]);
      if (endpoint.includes('/codeql-analysis.yml/')) return JSON.stringify([{ workflow_runs: [run()] }]);
      if (endpoint.includes('/actions/runs/42/')) return JSON.stringify([{ jobs: ['Linux x64', 'macOS (universal)', 'Windows x64'].map((name, id) => ({ id: 2 + id, name, conclusion: 'success' })).concat({ id: 1, name: 'Windows x64', conclusion: 'failure' }) }]);
      if (endpoint.includes('/release.yml/')) return JSON.stringify([{ workflow_runs: input.active || input.completed ? [run({
        event: 'workflow_dispatch', head_sha: input.active || input.completed, status: input.active ? 'in_progress' : 'completed'
      })] : [] }]);
      if (args.includes('--jq')) return input.completed ? JSON.stringify({ prerelease: true, assets: assets.filter(asset => asset.name !== input.omit) }) : '';
      if (endpoint.includes('/releases/assets/')) return files[assets[Number(endpoint.split('/').at(-1)) - 1].name];
      throw new Error('Unexpected API call');
    };
    try {
      schedule({ gh, now: new Date(input.date), env: { GITHUB_SHA: input.source, GITHUB_REPOSITORY: 'samir-scripts/grace',
        GITHUB_REF: 'refs/heads/dev', GITHUB_EVENT_NAME: 'workflow_dispatch' } });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  `], { cwd: f.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TEST_INPUT: JSON.stringify({ source: f.source, date, ...overrides }) }
  });
  assert.throws(() => invoke('2026-11-18', { gate: { conclusion: 'failure' } }), /build.yml must pass/);
  assert.throws(() => invoke('2026-11-18', { gate: { head_sha: '0'.repeat(40) } }), /no push run/);
  assert.equal(f.git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`), '');
  assert.match(invoke('2026-11-18'), new RegExp(`DISPATCH ${tag}`));
  const nightlySource = f.git('rev-parse', `${tag}^{commit}`);
  f.git('checkout', '--detach', f.source);
  assert.doesNotMatch(invoke('2026-11-19', { active: nightlySource }), /DISPATCH/);
  assert.match(invoke('2026-11-19', { completed: nightlySource }), /ready; no new dispatch/);
  assert.throws(() => invoke('2026-11-19', { completed: nightlySource, omit: 'sample.rpm' }), /needs asset\/run verification/);
  assert.match(invoke('2026-11-19'), new RegExp(`DISPATCH ${tag}`), 'retry reuses the prior tag');
  assert.equal(f.git('rev-parse', 'HEAD'), f.source);
  f.write('app.txt', 'a second reviewed change\n');
  f.git('add', 'app.txt'); f.git('commit', '-qm', 'next');
  const nextSource = f.git('rev-parse', 'HEAD');
  f.git('update-ref', 'refs/remotes/origin/dev', nextSource);
  assert.match(invoke('2026-11-18', { source: nextSource }), /another source/);
  assert.equal(f.git('rev-parse', `${tag}^{commit}`), nightlySource);
  assert.equal(f.git('ls-remote', '--tags', 'origin', 'refs/tags/*nightly*').split('\n').length, 2);
});
