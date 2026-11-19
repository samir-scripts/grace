import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyTag, readVersions, validateVersions } from './release-policy.mjs';

const repo = 'samir-scripts/grace';
const dev = 'refs/remotes/origin/dev';
const nightly = /-nightly\.(\d{8})$/;
const sha = /^[a-f0-9]{40}$/;
const beta = 'v1.7.2-beta.1';
const buildJobs = ['Linux x64', 'macOS (universal)', 'Windows x64'];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const resolve = ref => git('rev-parse', '--verify', ref).trim();
const read = path => readFileSync(path, 'utf8');
const show = (revision, path) => git('show', `${revision}:${path}`);
const tags = () => git('tag', '--list').trim().split('\n').filter(Boolean);
const github = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const api = (gh, endpoint) => JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/${endpoint}`));

function dateFor(tag) {
  classifyTag(tag, { allowNightly: true });
  const match = nightly.exec(tag);
  if (!match) throw new Error('A dated nightly tag is required');
  return match[1];
}

function parentOf(revision) {
  const parents = git('show', '-s', '--format=%P', revision).trim().split(' ');
  if (parents.length !== 1 || !sha.test(parents[0])) throw new Error('Nightly must have exactly one parent');
  return parents[0];
}

function requireDevParent(source) {
  const check = spawnSync('git', ['merge-base', '--is-ancestor', source, dev], { stdio: 'ignore' });
  if (check.status !== 0) throw new Error('Nightly parent is not on origin/dev');
}

function nightlies() {
  return tags().filter(tag => nightly.test(tag)).map(tag => {
    const date = dateFor(tag);
    if (git('cat-file', '-t', `refs/tags/${tag}`).trim() !== 'tag') throw new Error(`Nightly tag is not annotated: ${tag}`);
    const revision = resolve(`refs/tags/${tag}^{commit}`);
    return { tag, date, revision, source: parentOf(revision) };
  }).sort((a, b) => b.date.localeCompare(a.date, 'en'));
}

function nextTag(source, date) {
  const versions = readVersions(path => show(source, path));
  validateVersions(versions.package, versions);
  classifyTag(`v${versions.package}`);
  const [major, minor, patch] = versions.package.split('-')[0].split('.');
  let next = BigInt(patch);
  const assigned = new Set(tags());
  while (assigned.has(`v${major}.${minor}.${next}`)) next++;
  const candidate = `v${major}.${minor}.${next}-nightly.${date}`;
  dateFor(candidate);
  const previous = nightlies();
  return previous.find(item => item.source === source)?.tag
    ?? (previous.some(item => item.date === date) ? null : candidate);
}

function rewriteCargo(text, header, version) {
  const sections = text.split(/(?=^\[\[?[^\]\n]+\]\]?\s*$)/m);
  return sections.map(section => section.startsWith(`${header}\n`) && /^name\s*=\s*"pomotroid"\s*$/m.test(section)
    ? section.replace(/^(version\s*=\s*")[^"\n]+(".*)$/m, `$1${version}$2`)
    : section).join('');
}

function nightlyFiles(source, tag) {
  const date = dateFor(tag);
  const { version } = classifyTag(tag, { allowNightly: true });
  const from = path => show(source, path);
  const before = readVersions(from);
  validateVersions(before.package, before);
  const jsonWithVersion = (path, lock = false) => {
    const doc = JSON.parse(from(path));
    doc.version = version;
    if (lock) doc.packages[''].version = version;
    return JSON.stringify(doc, null, 2) + '\n';
  };
  const previous = nightlies().find(item => item.date < date)?.source ?? resolve(`refs/tags/${beta}^{commit}`);
  const files = new Map([
    ['package.json', jsonWithVersion('package.json')],
    ['package-lock.json', jsonWithVersion('package-lock.json', true)],
    ['src-tauri/tauri.conf.json', jsonWithVersion('src-tauri/tauri.conf.json')],
    ['src-tauri/Cargo.toml', rewriteCargo(from('src-tauri/Cargo.toml'), '[package]', version)],
    ['src-tauri/Cargo.lock', rewriteCargo(from('src-tauri/Cargo.lock'), '[[package]]', version)],
    ['CHANGELOG.md', `[${tag}]\n\n- Reviewed dev source: https://github.com/${repo}/commit/${source}\n- Changes: https://github.com/${repo}/compare/${previous}...${source}\n- Signed manual downloads only. No stable updater changes. Install in a disposable environment, not over a production profile.\n- Windows x64 and Ubuntu x64 packaged runtime acceptance is unverified / deferred to contributors. Detached signatures are not OS publisher signatures.\n\n${from('CHANGELOG.md')}`],
  ]);
  validateVersions(version, readVersions(path => files.get(path)));
  return files;
}

function verify(tag, checkout = resolve('HEAD'), ref = `refs/tags/${tag}`) {
  dateFor(tag);
  if (git('cat-file', '-t', ref).trim() !== 'tag') throw new Error('Nightly release tag must be annotated');
  const revision = resolve(`${ref}^{commit}`);
  if (revision !== checkout) throw new Error('Nightly checkout does not match the tag');
  const source = parentOf(revision);
  requireDevParent(source);
  const files = nightlyFiles(source, tag);
  const paths = git('diff', '--name-only', '-z', source, revision).split('\0').filter(Boolean);
  if (paths.length !== files.size || paths.some(path => !files.has(path)) || git('diff', '--summary', source, revision).trim()) {
    throw new Error('Nightly commit must change release metadata only');
  }
  for (const [path, expected] of files) {
    if (show(revision, path) !== expected) throw new Error(`Nightly metadata mismatch: ${path}`);
  }
  return source;
}

function latestRun(gh, workflow, source, event, branch) {
  const query = new URLSearchParams({ event, head_sha: source, per_page: '30', ...(branch ? { branch } : {}) });
  return api(gh, `actions/workflows/${workflow}/runs?${query}`)
    .flatMap(page => page.workflow_runs)
    .filter(run => run.head_sha === source && run.event === event && (!branch || run.head_branch === branch))
    .sort((a, b) => b.id - a.id)[0];
}

function requireGreenDev(gh, source) {
  for (const workflow of ['build.yml', 'codeql-analysis.yml']) {
    const run = latestRun(gh, workflow, source, 'push', 'dev');
    const details = run ? `https://github.com/${repo}/actions/runs/${run.id}` : `no push run for ${source}`;
    if (run?.status !== 'completed' || run.conclusion !== 'success') throw new Error(`${workflow} must pass: ${details}`);
    if (workflow === 'build.yml') {
      const jobs = api(gh, `actions/runs/${run.id}/jobs?filter=all&per_page=100`).flatMap(page => page.jobs).sort((a, b) => b.id - a.id);
      if (!buildJobs.every(name => jobs.find(job => job.name === name)?.conclusion === 'success')) {
        throw new Error(`All dev platform builds must pass: ${details}`);
      }
    }
  }
}

function existingDraft(gh, tag, revision) {
  const releaseJson = gh('api', '--paginate', `repos/${repo}/releases?per_page=100`, '--jq', `.[] | select(.tag_name == ${JSON.stringify(tag)})`).trim();
  const release = releaseJson ? JSON.parse(releaseJson) : null;
  const run = latestRun(gh, 'release.yml', revision, 'workflow_dispatch');
  if (run && run.status !== 'completed') return 'active';
  if (!release) return run?.conclusion ?? 'missing';
  const incomplete = () => { throw new Error(`Existing nightly needs asset/run verification before proceeding: ${release.html_url}`); };
  if (run?.conclusion !== 'success' || !release.prerelease) incomplete();
  const assets = new Map();
  for (const asset of release.assets) {
    if (asset.state !== 'uploaded' || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
        assets.has(asset.name) || asset.name === 'latest.json') incomplete();
    assets.set(asset.name, asset);
  }
  const metadata = name => {
    const asset = assets.get(name);
    if (!asset || !Number.isSafeInteger(asset.id)) incomplete();
    const text = gh('api', '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${asset.id}`);
    if ('sha256:' + createHash('sha256').update(text).digest('hex') !== asset.digest ||
        Buffer.byteLength(text) !== asset.size) incomplete();
    return text;
  };
  const checksumNames = new Set(['SHA256SUMS']);
  for (const line of metadata('SHA256SUMS').trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || checksumNames.has(match[2]) || assets.get(match[2])?.digest !== `sha256:${match[1]}`) incomplete();
    checksumNames.add(match[2]);
  }
  const provenance = JSON.parse(metadata('provenance.json'));
  const reportedNames = new Set(['SHA256SUMS', 'provenance.json']);
  for (const { file, sha256 } of provenance.artifacts) {
    if (reportedNames.has(file) || assets.get(file)?.digest !== `sha256:${sha256}`) incomplete();
    reportedNames.add(file);
  }
  if (checksumNames.size !== assets.size || reportedNames.size !== assets.size ||
      provenance.source_revision !== revision || provenance.version !== tag.slice(1) || provenance.prerelease !== 'true') incomplete();
  return 'ready';
}

export function schedule({ env = process.env, now = new Date(), gh = github } = {}) {
  if (env.GITHUB_REPOSITORY !== repo || env.GITHUB_REF !== 'refs/heads/dev' || !sha.test(env.GITHUB_SHA ?? '') || resolve('HEAD') !== env.GITHUB_SHA || !['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error('Nightly scheduler only accepts a pinned dev run in samir-scripts/grace');
  }
  const source = env.GITHUB_SHA;
  requireDevParent(source);
  const tag = nextTag(source, now.toISOString().slice(0, 10).replaceAll('-', ''));
  if (!tag) { console.log('Today already has a nightly for another source; leaving its tag intact.'); return; }
  const existing = nightlies().find(item => item.tag === tag);
  if (existing) {
    verify(tag, existing.revision);
    const state = existingDraft(gh, tag, existing.revision);
    if (state === 'ready' || state === 'active') { console.log(`${tag}: ${state}; no new dispatch`); return; }
    if (state === 'success') throw new Error(`${tag}: successful release run without a release; inspect GitHub before retrying`);
    if (state !== 'missing' && env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error(`${tag}: release run ${state}; use manual dispatch to retry this tag`);
  }
  requireGreenDev(gh, source);
  if (!existing) {
    const files = nightlyFiles(source, tag);
    for (const [path, content] of files) writeFileSync(path, content);
    const config = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];
    git('add', '--', ...files.keys());
    git(...config, 'commit', '-m', `chore: prepare ${tag}`);
    git(...config, 'tag', '-a', tag, '-m', `Grace nightly ${tag}`);
    verify(tag);
    try { git('push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`); }
    catch {
      const remote = git('ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}^{}`).trim();
      const [revision] = remote.split('\t');
      if (!sha.test(revision)) throw new Error('Unable to push or confirm nightly tag');
      const ref = 'refs/nightly-check/collision';
      git('fetch', '--no-tags', 'origin', `refs/tags/${tag}:${ref}`);
      if (parentOf(revision) !== source) { console.log(`${tag} belongs to another source; leaving it intact.`); return; }
      verify(tag, revision, ref);
      const state = existingDraft(gh, tag, revision);
      if (state !== 'missing') { console.log(`${tag}: ${state}; no new dispatch`); return; }
    }
  }
  gh('workflow', 'run', 'release.yml', '--ref', tag, '-f', `tag=${tag}`, '-R', repo);
  console.log(`Requested signed draft for ${tag}: https://github.com/${repo}/actions/workflows/release.yml`);
}

function main([command, arg, ...rest]) {
  if (rest.length) throw new Error('Unexpected arguments');
  if (command === 'schedule' && !arg) schedule();
  else if (command === 'tag' && arg) console.log(nextTag(resolve('HEAD'), arg) ?? '');
  else if (command === 'prepare' && arg) {
    const files = nightlyFiles(resolve('HEAD'), arg);
    for (const [path, content] of files) writeFileSync(path, content);
  } else if (command === 'verify' && arg) console.log(verify(arg));
  else if (command === 'verify-release' && arg) {
    const env = process.env;
    if (env.GITHUB_REPOSITORY !== repo || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== `refs/tags/${arg}` || env.CANDIDATE_RUN_ID || env.ACCEPTANCE_REF || resolve('HEAD') !== env.GITHUB_SHA) {
      throw new Error('Nightly release requires its own tag dispatch with no stable inputs');
    }
    const source = verify(arg);
    requireGreenDev(github, source);
  } else throw new Error('Usage: prepare-nightly.mjs schedule | tag YYYYMMDD | (prepare|verify|verify-release) TAG');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    // Child command output is deliberately withheld; only script-authored failures are shown.
    console.error(error.status ? 'Nightly Git or GitHub operation failed' : error.message);
    process.exitCode = 1;
  }
}
