import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyTag, validateAcceptance } from './release-policy.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function githubReviewLookup(prNumber) {
  const base = `repos/samir-scripts/grace/pulls/${prNumber}`;
  const get = (...args) => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' }));
  const pr = get(base);
  const pages = (endpoint) => get('--paginate', '--slurp', endpoint).flat();
  return { headSha: pr.head?.sha, author: pr.user?.login, reviews: pages(`${base}/reviews`), files: pages(`${base}/files`).map(({ filename, sha }) => ({ filename, sha })) };
}

function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in artifacts');
    return entry.isDirectory() ? collect(path) : entry.isFile() ? [path] : [];
  });
}

export async function prepareRelease({ root = process.cwd(), tag, artifactDir = 'dist', outputDir = 'release-assets', sourceRevision, reportsPath, reviewLookup = githubReviewLookup }) {
  const { version, prerelease } = classifyTag(tag);
  if (typeof sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error('Invalid source revision');
  const destination = resolve(root, outputDir);
  if (existsSync(destination)) throw new Error('Output directory already exists');
  const files = collect(resolve(root, artifactDir));
  const required = [
    ['windows-x64', (name) => name.endsWith('-setup.exe'), `grace-windows-x64-${version}-setup.exe`],
    ['ubuntu-x64', (name) => name.endsWith('.deb'), `grace-ubuntu-x64-${version}.deb`],
    ['macos-universal', (name) => name.endsWith('.dmg'), `grace-macos-universal-${version}.dmg`],
  ];
  const selected = new Map();
  for (const [platform, match, output] of required) {
    const matches = files.filter((file) => match(basename(file)));
    if (matches.length !== 1) throw new Error(`Expected exactly one ${platform} package`);
    selected.set(matches[0], output);
  }
  for (const [source, output] of [...selected]) {
    for (const suffix of ['.sig', '.asc']) {
      if (files.includes(source + suffix)) selected.set(source + suffix, output + suffix);
    }
  }
  const relevant = /(?:\.AppImage|\.rpm|\.app\.tar\.gz|\.sig|\.asc)$/;
  for (const file of files) {
    if (prerelease === 'false' && /\.(?:AppImage|rpm)(?:\.(?:sig|asc))?$/.test(file)) continue;
    if (relevant.test(file) && !selected.has(file)) selected.set(file, basename(file));
  }
  const assets = [...selected].map(([path, file]) => ({ file, bytes: readFileSync(path) })).sort((a, b) => a.file.localeCompare(b.file, 'en'));
  const names = new Set(['SHA256SUMS', 'provenance.json', 'latest.json']);
  for (const asset of assets) {
    if (names.has(asset.file)) throw new Error(`Duplicate asset name: ${asset.file}`);
    names.add(asset.file);
    asset.sha256 = sha256(asset.bytes);
  }
  const platformAssets = Object.fromEntries(required.map(([platform, , file]) => [platform, assets.find((asset) => asset.file === file)]));
  const artifactHashes = Object.fromEntries(required.map(([platform]) => [platform, platformAssets[platform].sha256]));
  if (prerelease === 'false') {
    if (!reportsPath) throw new Error('Stable releases require reports');
    const reportFile = resolve(root, reportsPath);
    const reportName = relative(resolve(root), reportFile).split(sep).join('/');
    if (!reportName || reportName.startsWith('../') || isAbsolute(reportName)) throw new Error('Reports must be inside the repository');
    const reportBytes = readFileSync(reportFile);
    const reportBlob = createHash('sha1').update(`blob ${reportBytes.length}\0`).update(reportBytes).digest('hex');
    const reports = JSON.parse(reportBytes.toString('utf8'));
    validateAcceptance(reports, { sourceRevision, artifactHashes });
    const cache = new Map();
    for (const report of reports.filter((item) => ['windows-x64', 'ubuntu-x64'].includes(item.platform))) {
      const prNumber = report.review.pr_url.match(/\/(\d+)$/)[1];
      if (!cache.has(prNumber)) cache.set(prNumber, await reviewLookup(prNumber));
      const pr = cache.get(prNumber);
      if (!pr || !/^[a-f0-9]{40}$/.test(pr.headSha ?? '') || !pr.author || !Array.isArray(pr.files) || !Array.isArray(pr.reviews)) throw new Error(`Invalid PR evidence: ${prNumber}`);
      if (!pr.files.some((file) => file?.filename === reportName && file.sha === reportBlob)) throw new Error(`Report blob does not match PR head: ${prNumber}`);
      const reviewer = report.review.reviewer;
      const decisions = pr.reviews.filter((review) => review.user?.login?.toLowerCase() === reviewer.toLowerCase() && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state));
      const latest = decisions.at(-1);
      if (reviewer.toLowerCase() === pr.author.toLowerCase() || latest?.state !== 'APPROVED' || latest.commit_id !== pr.headSha) throw new Error(`Review not approved at PR head: ${prNumber}`);
    }
  }
  const status = prerelease === 'true' ? 'unverified / deferred to contributors' : 'accepted';
  const provenance = { source_revision: sourceRevision, version, prerelease, platforms: Object.fromEntries(['windows-x64', 'ubuntu-x64'].map((platform) => [platform, { file: platformAssets[platform].file, sha256: platformAssets[platform].sha256, status }])), artifacts: assets.map(({ file, sha256 }) => ({ file, sha256 })) };
  const provenanceBytes = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  const sums = [...assets.map(({ file, sha256 }) => ({ file, sha256 })), { file: 'provenance.json', sha256: sha256(provenanceBytes) }].sort((a, b) => a.file.localeCompare(b.file, 'en')).map(({ file, sha256 }) => `${sha256}  ${file}\n`).join('');
  mkdirSync(destination);
  for (const asset of assets) writeFileSync(resolve(destination, asset.file), asset.bytes, { flag: 'wx' });
  writeFileSync(resolve(destination, 'provenance.json'), provenanceBytes, { flag: 'wx' });
  writeFileSync(resolve(destination, 'SHA256SUMS'), sums, { flag: 'wx' });
  return { version, prerelease, assets: [...assets.map(({ file }) => file), 'provenance.json', 'SHA256SUMS'], artifactHashes };
}

async function main(args) {
  const options = {};
  const keys = { '--tag': 'tag', '--artifacts': 'artifactDir', '--output': 'outputDir', '--source-revision': 'sourceRevision', '--reports': 'reportsPath' };
  for (let i = 0; i < args.length; i += 2) {
    const key = keys[args[i]];
    if (!key || options[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid CLI arguments');
    options[key] = args[i + 1];
  }
  const result = await prepareRelease(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
