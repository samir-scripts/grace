import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageSuffix = /(?:\.deb|\.dmg|\.AppImage|\.rpm|-setup\.exe|\.app\.tar\.gz)$/;

function decodeBase64(input) {
  if (typeof input !== 'string') throw new Error('Invalid encoding');
  const value = input.trim();
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid encoding');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error('Invalid encoding');
  return decoded;
}

function decodeMinisign(encoded, type) {
  const bytes = decodeBase64(encoded);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length !== (type === 'public' ? 2 : 4) || !lines[0].startsWith('untrusted comment:') || (type === 'signature' && !lines[2].startsWith('trusted comment:'))) throw new Error('Invalid minisign format');
  const primary = decodeBase64(lines[1]);
  if (type === 'public') {
    if (primary.length !== 42 || primary.subarray(0, 2).toString() !== 'Ed') throw new Error('Invalid public key');
  } else {
    if (primary.length !== 74 || !['Ed', 'ED'].includes(primary.subarray(0, 2).toString()) || decodeBase64(lines[3]).length !== 64) throw new Error('Invalid signature');
  }
  return Buffer.from(`${lines.join('\n')}\n`);
}

function collect(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('Symlink artifact');
  if (stat.isDirectory()) return readdirSync(path).sort().flatMap((name) => collect(resolve(path, name)));
  return stat.isFile() && packageSuffix.test(basename(path)) ? [path] : [];
}

export function signReleaseArtifacts({ root = process.cwd(), artifactDir = 'dist', executor = spawnSync, env = process.env } = {}) {
  let temp;
  try {
    const packages = collect(resolve(root, artifactDir));
    if (!packages.length) throw new Error('No packages');
    const config = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    const publicKey = decodeMinisign(config.plugins?.updater?.pubkey, 'public');
    const publicArtifact = resolve(root, artifactDir, 'grace-updater.pub');
    let publicExists = true;
    try {
      if (!lstatSync(publicArtifact).isFile() || !readFileSync(publicArtifact).equals(publicKey)) throw new Error('Existing public key differs');
    } catch (error) { if (error.code === 'ENOENT') publicExists = false; else throw error; }
    temp = mkdtempSync(resolve(tmpdir(), 'grace-sign-'));
    const publicPath = resolve(temp, 'public.key');
    const signaturePath = resolve(temp, 'signature');
    writeFileSync(publicPath, publicKey, { mode: 0o600, flag: 'wx' });
    for (const file of packages) {
      const sig = `${file}.sig`;
      let exists = true;
      try { if (!lstatSync(sig).isFile()) throw new Error('Invalid signature file'); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
      if (!exists) {
        if (!env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Missing signing key');
        const result = executor(resolve(root, 'node_modules/.bin/tauri'), ['signer', 'sign', file], { env, stdio: 'pipe' });
        if (result?.status !== 0 || result.error) throw new Error('Signing failed');
        if (!lstatSync(sig).isFile()) throw new Error('Invalid signature file');
      }
      const signature = decodeMinisign(readFileSync(sig, 'utf8'), 'signature');
      writeFileSync(signaturePath, signature, { mode: 0o600 });
      const result = executor('minisign', ['-Vm', file, '-p', publicPath, '-x', signaturePath], { stdio: 'pipe' });
      if (result?.status !== 0 || result.error) throw new Error('Verification failed');
    }
    if (!publicExists) writeFileSync(publicArtifact, publicKey, { flag: 'wx' });
    return packages;
  } catch {
    throw new Error('Release artifact signing or verification failed');
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

function main(args) {
  if (args.length !== 2 || args[0] !== '--artifacts' || !args[1] || args[1].startsWith('--')) throw new Error('Usage: --artifacts DIR');
  const packages = signReleaseArtifacts({ artifactDir: args[1] });
  process.stdout.write(`Verified ${packages.length} release package signatures\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch { console.error('Release artifact signing or verification failed'); process.exitCode = 1; }
}
