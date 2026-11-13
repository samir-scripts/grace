import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const platforms = ['windows-x64', 'ubuntu-x64'];
export const requiredCases = ['installation', 'automatic_pairing', 'profile_assignment', 'policy_ack', 'existing_tabs', 'fresh_http', 'fresh_https', 'subdomains', 'allowed_control', 'browser_restart', 'app_restart', 'crash_recovery', 'disconnect_withdrawal', 'natural_completion', 'emergency_release', 'restored_access'];
const hex40 = /^[a-f0-9]{40}$/;
const hex64 = /^[a-f0-9]{64}$/;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

export function classifyTag(tag) {
  if (typeof tag !== 'string' || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta\.(0|[1-9]\d*))?$/.test(tag)) throw new Error('Invalid release tag');
  return { version: tag.slice(1), prerelease: String(tag.includes('-beta.')) };
}

export function validateVersions(version, versions) {
  for (const key of ['package', 'lock', 'lockRoot', 'tauri', 'cargo', 'cargoLock']) {
    if (versions?.[key] !== version) throw new Error(`Version mismatch: ${key}`);
  }
}

export function validateAcceptance(reports, { sourceRevision, artifactHashes } = {}) {
  if (!hex40.test(sourceRevision ?? '') || !artifactHashes || !Array.isArray(reports)) throw new Error('Missing or invalid acceptance inputs');
  for (const platform of platforms) {
    const matches = reports.filter((report) => report?.platform === platform);
    if (matches.length !== 1) throw new Error(`Missing or duplicate report: ${platform}`);
    const report = matches[0];
    if (report.source_revision !== sourceRevision) throw new Error(`Stale report: ${platform}`);
    if (!hex64.test(artifactHashes[platform] ?? '') || report.package_sha256 !== artifactHashes[platform]) throw new Error(`Artifact hash mismatch: ${platform}`);
    if (!nonempty(report.os_version) || !nonempty(report.chrome_version) || report.architecture !== 'x86_64') throw new Error(`Invalid system details: ${platform}`);
    if (report.review?.approved !== true || !nonempty(report.review?.reviewer) || !/^https:\/\/github\.com\/samir-scripts\/grace\/pull\/[1-9]\d*$/.test(report.review?.pr_url ?? '')) throw new Error(`Invalid review: ${platform}`);
    for (const name of requiredCases) if (report.cases?.[name] !== 'passed') throw new Error(`Acceptance case ${name} not passed: ${platform}`);
  }
}

function sectionValues(text, header) {
  return text.split(/^\s*\[\[?[^\]\n]+\]\]?\s*$/m).slice(1).map((body, index) => ({ body, header: [...text.matchAll(/^\s*(\[\[?[^\]\n]+\]\]?)\s*$/gm)][index][1] })).filter((section) => section.header === header).map(({ body }) => Object.fromEntries([...body.matchAll(/^\s*(name|version)\s*=\s*"([^"\n]*)"\s*(?:#.*)?$/gm)].map((match) => [match[1], match[2]])));
}

export function readVersions() {
  const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const pkg = json('package.json');
  const lock = json('package-lock.json');
  const tauri = json('src-tauri/tauri.conf.json');
  const cargo = sectionValues(readFileSync('src-tauri/Cargo.toml', 'utf8'), '[package]').filter((item) => item.name === 'pomotroid');
  const cargoLock = sectionValues(readFileSync('src-tauri/Cargo.lock', 'utf8'), '[[package]]').filter((item) => item.name === 'pomotroid');
  if (cargo.length !== 1 || cargoLock.length !== 1) throw new Error('Expected one pomotroid package in each Cargo manifest');
  return { package: pkg.version, lock: lock.version, lockRoot: lock.packages?.['']?.version, tauri: tauri.version, cargo: cargo[0].version, cargoLock: cargoLock[0].version };
}

function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--tag', '--reports', '--artifacts', '--source-revision'].includes(key) || options[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid CLI arguments');
    options[key] = args[i + 1];
  }
  const result = classifyTag(options['--tag']);
  validateVersions(result.version, readVersions());
  if (result.prerelease === 'false') {
    if (!options['--reports'] || !options['--artifacts'] || !options['--source-revision']) throw new Error('Stable releases require reports, artifacts and source revision');
    validateAcceptance(JSON.parse(readFileSync(options['--reports'], 'utf8')), { sourceRevision: options['--source-revision'], artifactHashes: JSON.parse(readFileSync(options['--artifacts'], 'utf8')) });
  } else if (options['--reports'] || options['--artifacts'] || options['--source-revision']) {
    throw new Error('Beta releases do not use native acceptance reports');
  }
  const output = `version=${result.version}\nprerelease=${result.prerelease}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
