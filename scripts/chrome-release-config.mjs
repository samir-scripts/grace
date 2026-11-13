import { createHash, createPublicKey } from 'node:crypto';
import fs from 'node:fs';

export function extensionId(publicKey) {
  const bytes = Buffer.from(publicKey, 'base64');
  if (bytes.toString('base64') !== publicKey) throw new Error('Chrome release public key must be canonical base64');
  try { createPublicKey({ key: bytes, type: 'spki', format: 'der' }); }
  catch { throw new Error('Chrome release public key must be a DER SPKI public key'); }
  return [...createHash('sha256').update(bytes).digest('hex').slice(0, 32)]
    .map(n => String.fromCharCode(97 + parseInt(n, 16))).join('');
}
export function readChromeReleaseConfig(filename, developmentKey) {
  let config;
  try { config = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch { throw new Error('Chrome release configuration is missing or invalid'); }
  if (!/^[a-p]{32}$/.test(config.extension_id ?? '') || typeof config.public_key !== 'string') {
    throw new Error('Chrome release identity is not configured; create a draft Web Store item first');
  }
  if (config.public_key !== developmentKey || extensionId(config.public_key) !== config.extension_id) {
    throw new Error('Chrome release key and ID must match the unpacked identity');
  }
  for (const name of ['privacy_policy_url', 'support_url']) {
    let url;
    try { url = new URL(config[name]); } catch { throw new Error(`Chrome release ${name} must be a public HTTPS URL`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' ||
        /(^|\.)(example\.(com|org|net)|invalid|test|local)$/.test(url.hostname) || !url.hostname.includes('.')) {
      throw new Error(`Chrome release ${name} must be a public HTTPS URL, not a placeholder`);
    }
  }
  return config;
}
