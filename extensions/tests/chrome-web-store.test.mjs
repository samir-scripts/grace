import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, verify as verifySignature } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { loadCredentials, createChromeWebStoreClient, runChromeWebStoreCli } from '../../scripts/chrome-web-store.mjs';

const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey
  .export({ type: 'spki', format: 'der' }).toString('base64');
const extensionId = [...createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 32)]
  .map(char => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
const config = {
  publisher_id: randomUUID(),
  extension_id: extensionId,
  public_key: publicKey,
  privacy_policy_url: 'https://grace.example/privacy',
  support_url: 'https://grace.example/support'
};
const serviceKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceAccount = {
  type: 'service_account',
  client_email: 'grace-store@example-project.iam.gserviceaccount.com',
  private_key: serviceKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
};

function releaseZip(key = publicKey, version = '1.1.1') {
  return Buffer.from(zipSync({ 'manifest.json': strToU8(JSON.stringify({ manifest_version: 3, version, key })) }));
}

test('status uses Chrome Web Store API V2 and prints only allow-listed status fields', async () => {
  const calls = [];
  const client = createChromeWebStoreClient({ config, credentials: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' }, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'access-token', expires_in: 3600 });
    }
    return Response.json({ itemId: extensionId, lastAsyncUploadState: 'SUCCESS', publicKey: 'must not print', unknown: 'must not print' });
  } });
  const result = await client.status();
  assert.equal(result.itemId, extensionId);
  assert.equal(result.lastAsyncUploadState, 'SUCCESS');
  assert.equal('publicKey' in result, false);
  assert.equal(calls[1].url, `https://chromewebstore.googleapis.com/v2/publishers/${config.publisher_id}/items/${extensionId}:fetchStatus`);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer access-token');
});

test('upload sends a validated release ZIP to the v2 media endpoint and does not publish', async () => {
  const calls = [];
  const client = createChromeWebStoreClient({ config, credentials: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' }, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url) === 'https://oauth2.googleapis.com/token'
      ? Response.json({ access_token: 'access-token' })
      : Response.json({ uploadState: 'IN_PROGRESS', untrusted: 'must not print' });
  } });
  const result = await client.upload(releaseZip());
  assert.deepEqual(result, { uploadState: 'IN_PROGRESS' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, `https://chromewebstore.googleapis.com/upload/v2/publishers/${config.publisher_id}/items/${extensionId}:upload`);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls[1].init.headers['Content-Type'], 'application/zip');
  assert.deepEqual(Buffer.from(calls[1].init.body), releaseZip());
  assert.equal(calls.some(call => call.url.includes(':publish')), false);
});

test('upload rejects a ZIP whose manifest identity does not match release configuration', async () => {
  let called = false;
  const client = createChromeWebStoreClient({ config, credentials: { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' }, fetchImpl: async () => { called = true; } });
  await assert.rejects(client.upload(releaseZip('not-the-release-key')), /does not match configured Chrome release identity/);
  assert.equal(called, false);
});

test('OAuth and API failures omit provider response bodies and secret values', async () => {
  const client = createChromeWebStoreClient({ config, credentials: { clientId: 'private-client', clientSecret: 'private-secret', refreshToken: 'private-refresh' }, fetchImpl: async () => new Response('private-secret private-refresh response-detail', { status: 403 }) });
  await assert.rejects(client.status(), error => {
    assert.match(error.message, /HTTP 403/);
    for (const secret of ['private-client', 'private-secret', 'private-refresh', 'response-detail']) assert.equal(error.message.includes(secret), false);
    return true;
  });
});

test('HTTPS requests abort after the configured timeout and redact network errors', async () => {
  let aborted = false;
  const client = createChromeWebStoreClient({
    config,
    credentials: { clientId: 'private-client', clientSecret: 'private-secret', refreshToken: 'private-refresh' },
    timeoutMs: 5,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      if (!init.signal) {
        reject(new Error('missing abort signal'));
        return;
      }
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('private-secret socket details'));
      }, { once: true });
    })
  });
  await assert.rejects(client.status(), error => {
    assert.equal(error.message, 'Google OAuth token refresh request failed; network details omitted.');
    assert.equal(error.message.includes('private-secret'), false);
    return true;
  });
  assert.equal(aborted, true);
});

test('credential file requires restrictive permissions and never falls back to incomplete environment credentials', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cws-credentials-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, '.env.chrome.local');
  const serviceAccountFilename = path.join(dir, 'missing-service-account');
  fs.writeFileSync(filename, 'CWS_CLIENT_ID=id\nCWS_CLIENT_SECRET=secret\nCWS_REFRESH_TOKEN=refresh\n', { mode: 0o600 });
  assert.deepEqual(loadCredentials({ env: {}, filename, serviceAccountFilename }), { type: 'oauth', clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' });
  fs.chmodSync(filename, 0o644);
  assert.throws(() => loadCredentials({ env: {}, filename, serviceAccountFilename }), /mode 0600 or stricter/);
  assert.throws(() => loadCredentials({ env: { CWS_CLIENT_ID: 'id' }, filename, serviceAccountFilename }), /all three CWS credential variables/);
});

test('complete environment credentials are supported without reading a file', () => {
  assert.deepEqual(loadCredentials({ env: { CWS_CLIENT_ID: 'id', CWS_CLIENT_SECRET: 'secret', CWS_REFRESH_TOKEN: 'refresh' }, filename: '/missing', serviceAccountFilename: '/missing-service-account' }), {
    type: 'oauth', clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh'
  });
});

test('secure service account credentials take precedence over OAuth environment credentials', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cws-service-account-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, '.env.chrome-service-account.local');
  fs.writeFileSync(filename, JSON.stringify(serviceAccount), { mode: 0o600 });
  const credentials = loadCredentials({
    env: { CHROME_SERVICE_ACCOUNT_FILE: filename, CWS_CLIENT_ID: 'oauth-id', CWS_CLIENT_SECRET: 'oauth-secret', CWS_REFRESH_TOKEN: 'oauth-refresh' },
    serviceAccountFilename: path.join(dir, 'missing'),
    filename: path.join(dir, 'missing-oauth')
  });
  assert.equal(credentials.type, 'service-account');
  assert.equal(credentials.clientEmail, serviceAccount.client_email);
  assert.equal(credentials.privateKey, serviceAccount.private_key);
});

test('service account file rejects permissive modes and symlinks', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cws-service-account-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'service-account.json');
  fs.writeFileSync(filename, JSON.stringify(serviceAccount), { mode: 0o600 });
  fs.chmodSync(filename, 0o644);
  assert.throws(() => loadCredentials({ env: {}, serviceAccountFilename: filename, filename: path.join(dir, 'missing-oauth') }), /mode 0600 or stricter/);
  fs.chmodSync(filename, 0o600);
  const link = path.join(dir, 'service-link.json');
  fs.symlinkSync(filename, link);
  assert.throws(() => loadCredentials({ env: { CHROME_SERVICE_ACCOUNT_FILE: link }, serviceAccountFilename: path.join(dir, 'missing'), filename: path.join(dir, 'missing-oauth') }), /regular file/);
});

test('service account auth exchanges a signed one-hour RSA JWT for an access token', async () => {
  const calls = [];
  const client = createChromeWebStoreClient({
    config,
    credentials: { type: 'service-account', clientEmail: serviceAccount.client_email, privateKey: serviceAccount.private_key },
    now: () => 1_700_000_000_000,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return String(url) === 'https://oauth2.googleapis.com/token'
        ? Response.json({ access_token: 'service-account-access-token' })
        : Response.json({ itemId: extensionId });
    }
  });
  await client.status();
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [headerPart, claimsPart, signaturePart] = form.get('assertion').split('.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(claimsPart, 'base64url').toString());
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(claims.iss, serviceAccount.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/chromewebstore');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.iat, 1_700_000_000);
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(verifySignature('RSA-SHA256', Buffer.from(`${headerPart}.${claimsPart}`), serviceKeyPair.publicKey, Buffer.from(signaturePart, 'base64url')), true);
});

test('there is no public publish command', async () => {
  await assert.rejects(runChromeWebStoreCli(['publish']), /Usage:.*<status\|upload>/);
});
