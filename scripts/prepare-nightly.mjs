import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyTag, readVersions, validateVersions } from './release-policy.mjs';

const repo = 'samir-scripts/grace';
const dev = 'refs/remotes/origin/dev';
const nightly = /-nightly\.(\d{8})(?:\.([1-9]\d*))?$/;
const sha = /^[a-f0-9]{40}$/;
const beta = 'v1.7.2-beta.1';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const resolve = ref => git('rev-parse', '--verify', ref).trim();
const read = path => readFileSync(path, 'utf8');
const show = (revision, path) => git('show', `${revision}:${path}`);
const tags = () => git('tag', '--list').trim().split('\n').filter(Boolean);
const github = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const api = (gh, endpoint) => JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/${endpoint}`));

function nightlyPosition(tag) {
  classifyTag(tag, { allowNightly: true });
  const match = nightly.exec(tag);
  if (!match) throw new Error('A dated nightly tag is required');
  return { date: match[1], sequence: BigInt(match[2] ?? 0) };
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

function comparePosition(a, b) {
  return a.date.localeCompare(b.date) || Number(a.sequence - b.sequence);
}

function nightlies() {
  return tags().filter(tag => nightly.test(tag)).map(tag => {
    const position = nightlyPosition(tag);
    if (git('cat-file', '-t', `refs/tags/${tag}`).trim() !== 'tag') throw new Error(`Nightly tag is not annotated: ${tag}`);
    const revision = resolve(`refs/tags/${tag}^{commit}`);
    return { tag, ...position, source: parentOf(revision) };
  }).sort((a, b) => comparePosition(b, a));
}

function nextTag(source, date) {
  if (!/^\d{8}$/.test(date)) throw new Error('Expected UTC date in YYYYMMDD format');
  const versions = readVersions(path => show(source, path));
  validateVersions(versions.package, versions);
  classifyTag(`v${versions.package}`);
  const [major, minor, patch] = versions.package.split('-')[0].split('.');
  let next = BigInt(patch);
  const assigned = new Set(tags());
  while (assigned.has(`v${major}.${minor}.${next}`)) next++;
  const candidate = `v${major}.${minor}.${next}-nightly.${date}`;
  nightlyPosition(candidate);
  const previous = nightlies();
  const existing = previous.find(item => item.source === source);
  if (existing) return existing.tag;
  const sameDay = previous.find(item => item.date === date);
  return sameDay ? candidate + '.' + (sameDay.sequence + 1n) : candidate;
}

function rewriteCargo(text, header, version) {
  const sections = text.split(/(?=^\[\[?[^\]\n]+\]\]?\s*$)/m);
  return sections.map(section => section.startsWith(`${header}\n`) && /^name\s*=\s*"pomotroid"\s*$/m.test(section)
    ? section.replace(/^(version\s*=\s*")[^"\n]+(".*)$/m, `$1${version}$2`)
    : section).join('');
}

function nightlyFiles(source, tag) {
  const position = nightlyPosition(tag);
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
  const previous = nightlies().find(item => comparePosition(item, position) < 0)?.source ?? resolve(`refs/tags/${beta}^{commit}`);
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

function verify(tag, checkout = resolve('HEAD')) {
  nightlyPosition(tag);
  const ref = `refs/tags/${tag}`;
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

function matchingRuns(gh, workflow, source, event, branch) {
  const query = new URLSearchParams({ event, head_sha: source, per_page: '30', ...(branch ? { branch } : {}) });
  return api(gh, `actions/workflows/${workflow}/runs?${query}`)
    .flatMap(page => page.workflow_runs)
    .filter(run => run.head_sha === source && run.event === event && (!branch || run.head_branch === branch))
    .sort((a, b) => b.id - a.id);
}

function requireGreenDev(gh, source) {
  const pulls = api(gh, `commits/${source}/pulls`).flat();
  if (!pulls.some(pr => pr.merged_at && pr.merge_commit_sha === source &&
      pr.base?.ref === 'dev' && pr.base.repo?.full_name === repo)) {
    throw new Error('Nightly source must be the result of a merged pull request into dev');
  }
  for (const workflow of ['build.yml', 'codeql-analysis.yml']) {
    const [run] = matchingRuns(gh, workflow, source, 'push', 'dev');
    const details = run ? `https://github.com/${repo}/actions/runs/${run.id}` : `no push run for ${source}`;
    if (run?.status !== 'completed' || run.conclusion !== 'success') throw new Error(`${workflow} must pass: ${details}`);
  }
}

export function verifyNightlyRelease(tag, { env = process.env, gh = github } = {}) {
  if (env.GITHUB_REPOSITORY !== repo || env.GITHUB_EVENT_NAME !== 'push' ||
      env.GITHUB_REF !== `refs/tags/${tag}` || !sha.test(env.GITHUB_SHA ?? '') ||
      resolve('HEAD') !== resolve(`${env.GITHUB_SHA}^{commit}`)) {
    throw new Error('Nightly packages require the exact tag push');
  }
  const source = verify(tag);
  requireGreenDev(gh, source);
}

function main([command, arg, ...rest]) {
  if (rest.length) throw new Error('Unexpected arguments');
  if (command === 'tag' && arg) console.log(nextTag(resolve('HEAD'), arg));
  else if (command === 'prepare' && arg) {
    const files = nightlyFiles(resolve('HEAD'), arg);
    for (const [path, content] of files) writeFileSync(path, content);
  } else if (command === 'verify' && arg) console.log(verify(arg));
  else if (command === 'verify-release' && arg) verifyNightlyRelease(arg);
  else throw new Error('Usage: prepare-nightly.mjs tag YYYYMMDD | (prepare|verify|verify-release) TAG');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    // Child command output is deliberately withheld; only script-authored failures are shown.
    console.error(error.status ? 'Nightly Git or GitHub operation failed' : error.message);
    process.exitCode = 1;
  }
}
