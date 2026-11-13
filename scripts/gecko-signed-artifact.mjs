import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Unzip, unzipSync } from 'fflate';
import { geckoPayload } from './gecko-payload.mjs';
import { assertSafeExtensionName, assertSafeExtensionTree } from './extension-source-guard.mjs';

// Checks source correspondence and provenance, not Mozilla's cryptographic signature.
export function verifySignedGeckoArtifact({ artifactPath, provenancePath, sharedDir, manifestPath }) {
  assertSafeExtensionTree(sharedDir);
  const bytes = fs.readFileSync(artifactPath);
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const id = 'focus@pomotroid.local';
  const hash = createHash('sha256').update(bytes).digest('hex');
  let url;
  try { url = new URL(provenance.amo_submission_url); } catch { throw new Error('Invalid AMO submission URL'); }
  if (manifest.browser_specific_settings?.gecko?.id !== id || provenance.id !== id ||
      provenance.version !== manifest.version || provenance.channel !== 'unlisted' ||
      !/^[0-9a-f]{64}$/.test(provenance.sha256) || provenance.sha256 !== hash ||
      url.protocol !== 'https:' || url.hostname !== 'addons.mozilla.org' || url.username || url.password) {
    throw new Error('Signed Gecko provenance does not match current source');
  }
  const entries = unzipSync(bytes);
  // The streaming reader finds local headers; unzipSync reads central entries.
  // Requiring both inventories prevents malformed local headers being skipped.
  const localNames = [];
  const stream = new Unzip(file => { localNames.push(file.name); });
  stream.push(bytes, true);
  const centralNames = Object.keys(entries);
  for (const name of centralNames) if (!name.endsWith('/')) assertSafeExtensionName(name);
  if (localNames.length !== centralNames.length ||
      new Set(localNames).size !== localNames.length ||
      localNames.some(name => !Object.hasOwn(entries, name))) {
    throw new Error('Gecko archive local headers do not match its central directory');
  }
  if (!entries['META-INF/mozilla.rsa']?.length && !entries['META-INF/cose.sig']?.length) {
    throw new Error('Gecko archive lacks a signature marker');
  }
  const archiveManifest = JSON.parse(Buffer.from(entries['manifest.json'] || []).toString('utf8'));
  if (!isDeepStrictEqual(archiveManifest, manifest)) throw new Error('Gecko archive manifest differs from source');
  const expected = geckoPayload(sharedDir, manifestPath);
  const payload = Object.keys(entries).filter(name => !name.endsWith('/') && !name.startsWith('META-INF/') && name !== 'manifest.json');
  if (payload.length !== expected.size || payload.some(name => !expected.has(name) || !expected.get(name).equals(Buffer.from(entries[name])))) {
    throw new Error('Gecko archive payload differs from source');
  }
  return bytes;
}
