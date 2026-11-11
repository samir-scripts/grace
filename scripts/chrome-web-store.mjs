import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, createSign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { extensionId, readChromeReleaseConfig } from './chrome-release-config.mjs';

const API_ROOT = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WEBSTORE_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const REQUIRED_CREDENTIALS = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;
const ALLOWED_STATUS = /^[A-Z][A-Z0-9_]{0,39}$/;

function safeError(message) {
  return new Error(message);
}

function parseCredentialFile(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Z_]+)=(.*)$/.exec(trimmed);
    if (!match || !REQUIRED_CREDENTIALS.includes(match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function assertPrivateFile(stat, label) {
  if (!stat.isFile() || stat.isSymbolicLink()) throw safeError(`Chrome Web Store ${label} file must be a regular file.`);
  if ((stat.mode & 0o077) !== 0 || (stat.mode & 0o400) === 0) throw safeError(`Chrome Web Store ${label} file must have mode 0600 or stricter.`);
  if (typeof process.getuid !== 'function' || stat.uid !== process.getuid()) throw safeError(`Chrome Web Store ${label} file owner could not be verified for the current user.`);
}

export function loadCredentials({ env = process.env, filename = path.resolve('.env.chrome.local'), serviceAccountFilename = path.resolve('.env.chrome-service-account.local') } = {}) {
  const configuredServiceFile = typeof env.CHROME_SERVICE_ACCOUNT_FILE === 'string' && env.CHROME_SERVICE_ACCOUNT_FILE.trim() !== '';
  const servicePath = configuredServiceFile ? env.CHROME_SERVICE_ACCOUNT_FILE.trim() : serviceAccountFilename;
  let serviceStat;
  try { serviceStat = fs.lstatSync(servicePath); }
  catch (error) {
    if (error?.code !== 'ENOENT' || configuredServiceFile) throw safeError('Chrome Web Store service account file is unavailable.');
  }
  if (serviceStat) {
    assertPrivateFile(serviceStat, 'service account');
    let service;
    try { service = JSON.parse(fs.readFileSync(servicePath, 'utf8')); }
    catch { throw safeError('Chrome Web Store service account file is invalid.'); }
    if (service?.type !== 'service_account' || typeof service.client_email !== 'string' || !service.client_email.includes('@') || typeof service.private_key !== 'string') {
      throw safeError('Chrome Web Store service account file is incomplete.');
    }
    try {
      const key = createPrivateKey(service.private_key);
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    } catch { throw safeError('Chrome Web Store service account key is invalid.'); }
    return { type: 'service-account', clientEmail: service.client_email, privateKey: service.private_key };
  }

  const present = REQUIRED_CREDENTIALS.map(name => typeof env[name] === 'string' && env[name].trim() !== '');
  if (present.some(Boolean)) {
    if (!present.every(Boolean)) throw safeError('Set all three CWS credential variables or use the protected credential file.');
    return { type: 'oauth', clientId: env.CWS_CLIENT_ID.trim(), clientSecret: env.CWS_CLIENT_SECRET.trim(), refreshToken: env.CWS_REFRESH_TOKEN.trim() };
  }

  let stat;
  try { stat = fs.lstatSync(filename); }
  catch (error) {
    if (error?.code === 'ENOENT') throw safeError('Chrome Web Store credentials are not configured.');
    throw safeError('Chrome Web Store credential file is unavailable.');
  }
  assertPrivateFile(stat, 'credential');

  let parsed;
  try { parsed = parseCredentialFile(fs.readFileSync(filename, 'utf8')); }
  catch { throw safeError('Chrome Web Store credential file could not be read.'); }
  if (!REQUIRED_CREDENTIALS.every(name => typeof parsed[name] === 'string' && parsed[name].length > 0)) {
    throw safeError('Chrome Web Store credential file must define all three CWS credentials.');
  }
  return { type: 'oauth', clientId: parsed.CWS_CLIENT_ID, clientSecret: parsed.CWS_CLIENT_SECRET, refreshToken: parsed.CWS_REFRESH_TOKEN };
}

function validateConfig(config) {
  if (!config || typeof config.publisher_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(config.publisher_id)) {
    throw safeError('Chrome Web Store publisher ID is missing or invalid.');
  }
  if (!/^[a-p]{32}$/.test(config.extension_id ?? '') || typeof config.public_key !== 'string') {
    throw safeError('Chrome release identity is missing or invalid.');
  }
  try {
    if (extensionId(config.public_key) !== config.extension_id) throw new Error();
  } catch {
    throw safeError('Chrome release key and extension ID do not match.');
  }
}

async function responseJson(response, label) {
  if (!response?.ok) throw safeError(`${label} failed (HTTP ${Number(response?.status) || 0}); provider response omitted.`);
  try { return await response.json(); }
  catch { throw safeError(`${label} returned an invalid response; provider response omitted.`); }
}

function safeEnum(value) {
  return typeof value === 'string' && ALLOWED_STATUS.test(value) ? value : undefined;
}

function safeRevisionStatus(value) {
  const state = safeEnum(value?.state);
  return state ? { state } : undefined;
}

function validateReleaseZip(bytes, config) {
  const zip = Buffer.from(bytes ?? []);
  if (zip.length === 0 || zip.length > MAX_PACKAGE_BYTES) throw safeError('Chrome release ZIP is empty or exceeds the Web Store size limit.');
  let files;
  try { files = unzipSync(zip); }
  catch { throw safeError('Chrome release ZIP is invalid.'); }
  let manifest;
  try { manifest = JSON.parse(Buffer.from(files['manifest.json'] ?? []).toString('utf8')); }
  catch { throw safeError('Chrome release ZIP has no valid manifest.'); }
  let manifestId;
  try { manifestId = extensionId(manifest?.key); }
  catch { throw safeError('Chrome release ZIP identity does not match configured Chrome release identity.'); }
  if (manifest?.manifest_version !== 3 || typeof manifest.version !== 'string' ||
      manifest.key !== config.public_key || manifestId !== config.extension_id) {
    throw safeError('Chrome release ZIP identity does not match configured Chrome release identity.');
  }
  return zip;
}

export function createChromeWebStoreClient({ config, credentials, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 30_000 } = {}) {
  validateConfig(config);
  const isServiceAccount = credentials?.type === 'service-account';
  if (isServiceAccount) {
    if (typeof credentials.clientEmail !== 'string' || !credentials.clientEmail.includes('@') || typeof credentials.privateKey !== 'string') {
      throw safeError('Chrome Web Store service account credentials are incomplete.');
    }
    try {
      const key = createPrivateKey(credentials.privateKey);
      if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    } catch { throw safeError('Chrome Web Store service account key is invalid.'); }
  } else if (!credentials || !REQUIRED_CREDENTIALS.every((name, index) => {
    const key = ['clientId', 'clientSecret', 'refreshToken'][index];
    return typeof credentials[key] === 'string' && credentials[key].length > 0;
  })) throw safeError('Chrome Web Store OAuth credentials are incomplete.');
  if (typeof fetchImpl !== 'function') throw safeError('HTTPS request support is unavailable.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw safeError('HTTPS request timeout must be a positive number.');

  const resource = `publishers/${config.publisher_id}/items/${config.extension_id}`;
  function serviceAccountAssertion() {
    const issuedAt = Math.floor(now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claims = Buffer.from(JSON.stringify({
      iss: credentials.clientEmail,
      scope: WEBSTORE_SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600
    })).toString('base64url');
    const unsigned = `${header}.${claims}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${signer.sign(credentials.privateKey).toString('base64url')}`;
  }

  async function accessToken() {
    let response;
    try {
      response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: isServiceAccount
          ? new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: serviceAccountAssertion()
          })
          : new URLSearchParams({
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
            refresh_token: credentials.refreshToken,
            grant_type: 'refresh_token'
          })
      });
    } catch { throw safeError('Google OAuth token refresh request failed; network details omitted.'); }
    const body = await responseJson(response, 'Google OAuth token refresh');
    if (typeof body?.access_token !== 'string' || !body.access_token) {
      throw safeError('Google OAuth token refresh returned no access token; provider response omitted.');
    }
    return body.access_token;
  }

  async function request(url, method, token, body, headers = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${token}`, ...headers },
        ...(body === undefined ? {} : { body })
      });
    } catch { throw safeError('Chrome Web Store HTTPS request failed; network details omitted.'); }
    return responseJson(response, 'Chrome Web Store request');
  }

  return {
    async status() {
      const token = await accessToken();
      const body = await request(`${API_ROOT}/v2/${resource}:fetchStatus`, 'GET', token);
      if (body?.itemId !== config.extension_id) throw safeError('Chrome Web Store returned a different item ID.');
      const result = { itemId: config.extension_id };
      const lastUpload = safeEnum(body.lastAsyncUploadState);
      const published = safeRevisionStatus(body.publishedItemRevisionStatus);
      const submitted = safeRevisionStatus(body.submittedItemRevisionStatus);
      if (lastUpload) result.lastAsyncUploadState = lastUpload;
      if (published) result.publishedItemRevisionStatus = published;
      if (submitted) result.submittedItemRevisionStatus = submitted;
      if (typeof body.takenDown === 'boolean') result.takenDown = body.takenDown;
      if (typeof body.warned === 'boolean') result.warned = body.warned;
      return result;
    },

    async upload(bytes) {
      const zip = validateReleaseZip(bytes, config);
      const token = await accessToken();
      const body = await request(`${API_ROOT}/upload/v2/${resource}:upload`, 'POST', token, zip, { 'Content-Type': 'application/zip' });
      const uploadState = safeEnum(body?.uploadState);
      if (!uploadState) throw safeError('Chrome Web Store upload returned an unknown state; provider response omitted.');
      return { uploadState };
    }
  };
}

function readConfig(filename, cwd) {
  let config;
  try { config = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch { throw safeError('Chrome Web Store release configuration is missing or invalid.'); }
  validateConfig(config);
  let developmentKey;
  try { developmentKey = JSON.parse(fs.readFileSync(path.join(cwd, 'extensions/chrome/manifest.json'), 'utf8')).key; }
  catch { throw safeError('Chrome extension manifest is missing or invalid.'); }
  return readChromeReleaseConfig(filename, developmentKey);
}

function usage() {
  return 'Usage: node scripts/chrome-web-store.mjs <status|upload> [release.zip]';
}

export async function runChromeWebStoreCli(args, { cwd = process.cwd(), env = process.env, fetchImpl = globalThis.fetch, out = console.log } = {}) {
  const [command, zipArgument, ...extra] = args;
  if (!['status', 'upload'].includes(command) || extra.length > 0 || (command === 'status' && zipArgument)) {
    throw safeError(usage());
  }
  const configPath = path.join(cwd, 'extensions/chrome/release.json');
  const config = readConfig(configPath, cwd);
  const credentials = loadCredentials({ env, filename: path.join(cwd, '.env.chrome.local'), serviceAccountFilename: path.join(cwd, '.env.chrome-service-account.local') });
  const client = createChromeWebStoreClient({ config, credentials, fetchImpl });
  if (command === 'status') {
    out(JSON.stringify(await client.status(), null, 2));
    return;
  }
  const zipPath = path.resolve(cwd, zipArgument ?? 'extensions/dist/chrome.zip');
  let bytes;
  try { bytes = fs.readFileSync(zipPath); }
  catch { throw safeError('Chrome release ZIP could not be read.'); }
  out(JSON.stringify(await client.upload(bytes), null, 2));
  out('Upload updates the draft only. No publish request was made.');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runChromeWebStoreCli(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Chrome Web Store operation failed.'}\n`);
    process.exitCode = 1;
  });
}
