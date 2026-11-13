import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signFirefox } from '../../scripts/sign-firefox.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grace-sign-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'extensions/focus'), { recursive: true });
  fs.mkdirSync(path.join(root, 'extensions/firefox'), { recursive: true });
  fs.mkdirSync(path.join(root, 'extensions/signed/firefox'), { recursive: true });
  fs.writeFileSync(path.join(root, 'extensions/focus/a.js'), 'source');
  fs.writeFileSync(path.join(root, 'extensions/firefox/manifest.json'), JSON.stringify({version:'1.1.0', browser_specific_settings:{gecko:{id:'focus@pomotroid.local'}}}));
  fs.writeFileSync(path.join(root, 'extensions/signed/firefox/focus@pomotroid.local.xpi'), 'old artifact');
  fs.writeFileSync(path.join(root, 'extensions/signed/firefox/provenance.json'), 'old provenance');
  return root;
}
test('rejects missing credentials before invoking signer', async t => {
 const root = fixture(t); let called = false;
 await assert.rejects(signFirefox({root, env:{}, run: async () => {called=true;}}), /credentials/i);
 assert.equal(called, false);
});
test('uses unlisted channel and environment credentials without exposing them in arguments; invalid archive preserves prior pair', async t => {
 const root = fixture(t); let args;
 await assert.rejects(signFirefox({root, env:{WEB_EXT_API_KEY:'secret-key',WEB_EXT_API_SECRET:'secret-value'}, run: async (a,e) => {args=a; assert.equal(e.WEB_EXT_API_SECRET,'secret-value'); fs.writeFileSync(path.join(a[a.indexOf('--artifacts-dir')+1], 'invalid.xpi'),'invalid');}}));
 assert.ok(args.includes('--channel') && args[args.indexOf('--channel')+1] === 'unlisted');
 assert.ok(!args.join(' ').includes('secret'));
 assert.equal(fs.readFileSync(path.join(root,'extensions/signed/firefox/focus@pomotroid.local.xpi'),'utf8'),'old artifact');
 assert.equal(fs.readFileSync(path.join(root,'extensions/signed/firefox/provenance.json'),'utf8'),'old provenance');
});
test('refuses changed source before replacing artifact', async t => {
 const root=fixture(t);
 await assert.rejects(signFirefox({root,env:{WEB_EXT_API_KEY:'key',WEB_EXT_API_SECRET:'secret'},run:async(a)=>{fs.writeFileSync(path.join(root,'extensions/focus/a.js'),'changed'); fs.writeFileSync(path.join(a[a.indexOf('--artifacts-dir')+1],'invalid.xpi'),'invalid');}}),/source changed/i);
});
test('installs a source-matched signed candidate and matching provenance', async t => {
 const root = fixture(t);
 const { zipSync, strToU8 } = await import('fflate');
 const result = await signFirefox({root,env:{WEB_EXT_API_KEY:'key',WEB_EXT_API_SECRET:'secret'},run:async(a)=>{
   const source=a[a.indexOf('--source-dir')+1], artifacts=a[a.indexOf('--artifacts-dir')+1];
   const archive=zipSync({'manifest.json':new Uint8Array(fs.readFileSync(path.join(source,'manifest.json'))),'a.js':strToU8('source'),'META-INF/mozilla.rsa':strToU8('marker')});
   fs.writeFileSync(path.join(artifacts,'signed.xpi'),archive);
 }});
 const provenance=JSON.parse(fs.readFileSync(path.join(root,'extensions/signed/firefox/provenance.json')));
 assert.equal(provenance.sha256,result.sha256);
 assert.equal(provenance.version,'1.1.0');
 assert.equal(provenance.channel,'unlisted');
});
test('signer failure preserves old artifact and provenance', async t => {
 const root=fixture(t);
 await assert.rejects(signFirefox({root,env:{WEB_EXT_API_KEY:'key',WEB_EXT_API_SECRET:'secret'},run:async()=>{throw new Error('sign failed');}}));
 assert.equal(fs.readFileSync(path.join(root,'extensions/signed/firefox/focus@pomotroid.local.xpi'),'utf8'),'old artifact');
 assert.equal(fs.readFileSync(path.join(root,'extensions/signed/firefox/provenance.json'),'utf8'),'old provenance');
});
test('refuses nested credential files before invoking signer', async t => {
 const root=fixture(t), shared=path.join(root,'extensions/focus');
 fs.mkdirSync(path.join(shared,'nested'));
 fs.writeFileSync(path.join(shared,'nested/.env.amo.local'),'synthetic-private-value');
 let called=false;
 await assert.rejects(signFirefox({root,env:{WEB_EXT_API_KEY:'key',WEB_EXT_API_SECRET:'secret'},run:async()=>{called=true;}}), error => !String(error).includes('synthetic-private-value'));
 assert.equal(called,false);
 assert.equal(fs.readFileSync(path.join(root,'extensions/signed/firefox/focus@pomotroid.local.xpi'),'utf8'),'old artifact');
 assert.equal(fs.readFileSync(path.join(root,'extensions/signed/firefox/provenance.json'),'utf8'),'old provenance');
});
test('credential filename guard blocks key formats and permits ordinary source names', async () => {
 const {assertSafeExtensionName} = await import('../../scripts/extension-source-guard.mjs');
 for (const name of ['nested/.env', 'nested/.env.local', 'private.PEM', 'folder/foo.key', 'x.p12', 'x.pfx', 'META-INF/.env/inside']) assert.throws(() => assertSafeExtensionName(name));
 for (const name of ['env.js', 'keyboard.js', 'pem-utils.js']) assert.doesNotThrow(() => assertSafeExtensionName(name));
});
test('signer diagnostics report only safe categories and never reflected credentials', async () => {
 const { classifySigningFailure } = await import('../../scripts/sign-firefox.mjs');
 assert.equal(classifySigningFailure('fetch failed ECONNREFUSED secret-credential', ['secret-credential']), 'network');
 assert.equal(classifySigningFailure('Upload failed: Unauthorized secret-credential', ['secret-credential']), 'authentication');
 assert.equal(classifySigningFailure('401 Signature verification failed', []), 'invalid-signature');
 assert.equal(classifySigningFailure('401 token expired', []), 'expired');
 assert.equal(classifySigningFailure('JWT not yet valid', []), 'not-yet-valid');
 assert.equal(classifySigningFailure('unknown issuer', []), 'unknown-issuer');
 assert.equal(classifySigningFailure('email not verified', []), 'account-unverified');
 assert.equal(classifySigningFailure('403 permission denied', []), 'permission-denied');
 assert.equal(classifySigningFailure('Validation failed: private body', []), 'validation');
 assert.equal(classifySigningFailure('Approval: timeout exceeded. When approved', []), 'pending-review');
 assert.equal(classifySigningFailure('secret-credential unknown details', ['secret-credential']), 'unknown');
});


test('signer stages Firefox override and rejects mutation during signing', async t => {
 const root = fixture(t);
 fs.writeFileSync(path.join(root, 'extensions/focus/options.html'), '<footer>shared</footer>');
 const overlay = path.join(root, 'extensions/firefox/payload');
 fs.mkdirSync(overlay); fs.writeFileSync(path.join(overlay, 'options.html'), '<footer>Firefox links</footer>');
 await assert.rejects(signFirefox({root,env:{WEB_EXT_API_KEY:'key',WEB_EXT_API_SECRET:'secret'},run:async(a)=>{
   const staged=a[a.indexOf('--source-dir')+1];
   assert.equal(fs.readFileSync(path.join(staged, 'options.html'), 'utf8'), '<footer>Firefox links</footer>');
   fs.writeFileSync(path.join(overlay, 'options.html'), '<footer>changed</footer>');
 }}), /source changed/i);
 assert.equal(fs.readFileSync(path.join(root,'extensions/signed/firefox/focus@pomotroid.local.xpi'),'utf8'),'old artifact');
});
