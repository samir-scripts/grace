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

test('nightly release requires the exact pushed tag and the parent’s green dev checks', t => {
  const f = fixture(t);
  f.install();
  const invoke = (overrides = {}) => execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { verifyNightlyRelease } from ${JSON.stringify(script.href)};
    const input = JSON.parse(process.env.TEST_INPUT);
    const gh = (_command, ...args) => {
      const endpoint = args.at(-1);
      if (endpoint.endsWith('/pulls')) return JSON.stringify([input.directPush ? [] : [{
        merged_at: '2026-11-18T12:00:00Z', merge_commit_sha: input.source,
        base: { ref: 'dev', repo: { full_name: 'samir-scripts/grace' } }
      }]]);
      if (endpoint.includes('/build.yml/') || endpoint.includes('/codeql-analysis.yml/')) {
        const run = { id: 42, head_sha: input.source, head_branch: 'dev', event: 'push',
          status: 'completed', conclusion: 'success' };
        return JSON.stringify([{ workflow_runs: [{ ...run, ...(endpoint.includes('/build.yml/') ? input.gate : {}) }] }]);
      }
      throw new Error('Unexpected GitHub endpoint');
    };
    try {
      verifyNightlyRelease(input.tag, { gh, env: {
        GITHUB_SHA: input.revision, GITHUB_REPOSITORY: 'samir-scripts/grace',
        GITHUB_REF: 'refs/tags/' + input.tag, GITHUB_EVENT_NAME: input.event
      }});
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  `], {
    cwd: f.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, TEST_INPUT: JSON.stringify({
      source: f.source, tag, revision: f.git('rev-parse', 'HEAD'), event: 'push', ...overrides
    }) }
  });
  assert.doesNotThrow(() => invoke());
  assert.doesNotThrow(() => invoke({ revision: f.git('rev-parse', tag) }));
  assert.throws(() => invoke({ event: 'workflow_dispatch' }), /exact tag push/);
  assert.throws(() => invoke({ revision: f.source }), /exact tag push/);
  assert.throws(() => invoke({ gate: { conclusion: 'failure' } }), /build.yml must pass/);
  assert.throws(() => invoke({ gate: { head_sha: '0'.repeat(40) } }), /no push run/);
  assert.throws(() => invoke({ directPush: true }), /merged pull request/);
});
