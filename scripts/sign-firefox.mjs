import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { verifySignedGeckoArtifact } from './gecko-signed-artifact.mjs';
import { assertSafeExtensionTree } from './extension-source-guard.mjs';

const id = 'focus@pomotroid.local';
const managementUrl = 'https://addons.mozilla.org/en-US/developers/addon/3f4853f52b9c427ba24c/versions';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function snapshot(dir) {
  const result = new Map();
  function collect(base, prefix = '') {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const name = prefix + entry.name, full = path.join(base, entry.name);
      if (entry.isDirectory()) collect(full, name + '/');
      else if (entry.isFile() && !/\.(xpi|zip)$/i.test(name)) result.set(name, fs.readFileSync(full));
      else throw new Error('Unsupported source entry');
    }
  }
  collect(dir);
  return result;
}
function matches(a, b) {
  return a.size === b.size && [...a].every(([key, value]) => b.has(key) && value.equals(b.get(key)));
}
function credentials(root, env) {
  const file = path.join(root, '.env.amo.local');
  let values = {};
  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('.env.amo.local must be a private file (chmod 600)');
    values = parseEnv(fs.readFileSync(file, 'utf8'));
  }
  const key = env.WEB_EXT_API_KEY || values.WEB_EXT_API_KEY;
  const secret = env.WEB_EXT_API_SECRET || values.WEB_EXT_API_SECRET;
  if (!key || !secret) throw new Error('Missing AMO signing credentials');
  return { WEB_EXT_API_KEY: key, WEB_EXT_API_SECRET: secret };
}
export function classifySigningFailure(output, secrets) {
  let safe = output;
  for (const secret of secrets.filter(Boolean)) safe = safe.split(secret).join('[redacted]');
  if (/expired/i.test(safe)) return 'expired';
  if (/not yet valid|not valid yet|immature/i.test(safe)) return 'not-yet-valid';
  if (/unknown.*issuer|issuer.*unknown|invalid.*issuer|user not found/i.test(safe)) return 'unknown-issuer';
  if (/signature/i.test(safe)) return 'invalid-signature';
  if (/unverified|not verified|email.*verif/i.test(safe)) return 'account-unverified';
  if (/permission|forbidden/i.test(safe)) return 'permission-denied';
  if (/\b(?:401|403|unauthorized)\b/i.test(safe)) return 'authentication';
  if (/validation failed|failed validation/i.test(safe)) return 'validation';
  if (/already exists|version.*(?:already|duplicate|exists)/i.test(safe)) return 'version';
  if (/Approval: timeout exceeded/i.test(safe)) return 'pending-review';
  if (/timeout|timed out/i.test(safe)) return 'timeout';
  if (/fetch failed|econnrefused|econnreset|enotfound|eai_again|network|certificate/i.test(safe)) return 'network';
  if (/unknown argument|missing required argument|usage error/i.test(safe)) return 'configuration';
  return 'unknown';
}
class SigningFailure extends Error {
  constructor(category) { super(`AMO signing failed (${category})`); this.category = category; }
}
function execute(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/web-ext/bin/web-ext.js', import.meta.url)), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = chunk => { if (output.length < 131072) output += chunk.toString().slice(0, 131072 - output.length); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', () => reject(new SigningFailure('tool-start')));
    child.on('close', code => code === 0 ? resolve() : reject(new SigningFailure(classifySigningFailure(output, [env.WEB_EXT_API_KEY, env.WEB_EXT_API_SECRET]))));
  });
}
export async function signFirefox({ root = process.cwd(), env = process.env, run = execute } = {}) {
  const secrets = credentials(root, env);
  const sourceDir = path.join(root, 'extensions/focus');
  const manifestPath = path.join(root, 'extensions/firefox/manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.browser_specific_settings?.gecko?.id !== id || !manifest.version) throw new Error('Unexpected Firefox extension identity');
  assertSafeExtensionTree(sourceDir);
  const sources = snapshot(sourceDir);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'grace-amo-'));
  try {
    const staged = path.join(temp, 'source'), artifacts = path.join(temp, 'artifacts');
    fs.mkdirSync(staged); fs.mkdirSync(artifacts);
    for (const [name, bytes] of sources) {
      const target = path.join(staged, name);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    }
    fs.writeFileSync(path.join(staged, 'manifest.json'), manifestBytes);
    const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('WEB_EXT_')));
    await run(['sign', '--channel', 'unlisted', '--source-dir', staged, '--artifacts-dir', artifacts], { ...childEnv, ...secrets });
    assertSafeExtensionTree(sourceDir);
    if (!manifestBytes.equals(fs.readFileSync(manifestPath)) || !matches(sources, snapshot(sourceDir))) throw new Error('Extension source changed during signing');
    const files = fs.readdirSync(artifacts).filter(name => name.endsWith('.xpi'));
    if (files.length !== 1) throw new Error('Expected exactly one signed XPI');
    const input = path.join(artifacts, files[0]);
    const provenance = { id, version: manifest.version, channel: 'unlisted', sha256: hash(fs.readFileSync(input)), amo_submission_url: managementUrl };
    const provenanceTemp = path.join(temp, 'provenance.json');
    fs.writeFileSync(provenanceTemp, JSON.stringify(provenance, null, 2) + '\n');
    verifySignedGeckoArtifact({ artifactPath: input, provenancePath: provenanceTemp, sharedDir: sourceDir, manifestPath });
    assertSafeExtensionTree(sourceDir);
    if (!manifestBytes.equals(fs.readFileSync(manifestPath)) || !matches(sources, snapshot(sourceDir))) throw new Error('Extension source changed during signing');
    const dest = path.join(root, 'extensions/signed/firefox'); fs.mkdirSync(dest, { recursive: true });
    const targets = [path.join(dest, `${id}.xpi`), path.join(dest, 'provenance.json')];
    const contents = [fs.readFileSync(input), fs.readFileSync(provenanceTemp)];
    const backups = targets.map(p => fs.existsSync(p) ? fs.readFileSync(p) : null);
    const stagedFiles = targets.map((p, i) => { const tmp = `${p}.${process.pid}.tmp`; fs.writeFileSync(tmp, contents[i], { flag: 'wx' }); return tmp; });
    try { for (let i = 0; i < targets.length; i++) fs.renameSync(stagedFiles[i], targets[i]); }
    catch (error) {
      for (let i = 0; i < targets.length; i++) {
        if (backups[i] === null) fs.rmSync(targets[i], { force: true });
        else fs.writeFileSync(targets[i], backups[i]);
      }
      throw error;
    } finally { for (const p of stagedFiles) fs.rmSync(p, { force: true }); }
    return provenance;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  signFirefox().then(result => console.log(`Signed Firefox companion ${result.version} (${result.sha256})`))
    .catch(error => { console.error(error instanceof SigningFailure ? `Firefox signing failed: ${error.category}.` : 'Firefox signing failed before verification; check local configuration and source.'); process.exitCode = 1; });
}
