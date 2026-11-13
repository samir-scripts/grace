import test from 'node:test';
import assert from 'node:assert/strict';
import { probeNativeHost, connectionGuidance } from '../chrome/chrome-diagnostics.js';

function fixture(reply, error) {
 let listener, disconnect, sent = [], closed = false;
 return { api: () => ({
  postMessage(message) { sent.push(message); queueMicrotask(() => reply ? listener(reply) : disconnect()); },
  disconnect() { closed = true; }, error,
  onMessage: { addListener(fn) { listener = fn; } },
  onDisconnect: { addListener(fn) { disconnect = fn; } },
 }), sent, closed: () => closed };
}
test('native probe discards credentials and closes port after protocol check', async () => {
 const f=fixture({type:'config', protocol_version:3, token:'synthetic-secret', port:1421});
 const result=await probeNativeHost(f.api);
 assert.equal(result,'ready'); assert.deepEqual(f.sent,[{type:'connect'}]); assert.equal(f.closed(),true);
 assert.equal(JSON.stringify(result).includes('synthetic-secret'),false);
});
test('old or different native protocol gives an update instruction', async () => {
 for (const protocol_version of [undefined,2,4]) {
  const f=fixture({type:'config',protocol_version,token:'synthetic-secret'});
  assert.equal(await probeNativeHost(f.api),'incompatible'); assert.equal(f.closed(),true);
 }
 assert.match(connectionGuidance('incompatible'),/Update Grace/);
});
test('missing host has setup guidance distinct from a disconnected app', async () => {
 const f=fixture(null,{message:'Specified native messaging host not found.'});
 assert.equal(await probeNativeHost(f.api),'missing'); assert.equal(f.closed(),true);
 assert.match(connectionGuidance('missing'),/Install Chrome Companion/);
 assert.match(connectionGuidance('ready'),/Disconnected/);
});
test('withdrawal aborts an outstanding native probe', async () => {
 const abort=new AbortController(); let closed=false;
 const pending=probeNativeHost(()=>({postMessage(){},disconnect(){closed=true;},onMessage:{addListener(){}},onDisconnect:{addListener(){}}}),abort.signal);
 abort.abort(); assert.equal(await pending,'unavailable'); assert.equal(closed,true);
});
test('connected guidance requires authenticated background status', () => {
 assert.match(connectionGuidance('ready',true),/^Connected/);
 assert.doesNotMatch(connectionGuidance('ready',false),/^Connected/);
});

// Exercise the Chrome wrapper separately from the signed, shared options page.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
function optionsFixture({ crlf = false } = {}) {
 const targets = new Map();
 const target = id => {
  if (!targets.has(id)) targets.set(id, { textContent: '', listeners: {}, setAttribute() {}, after() {}, addEventListener(event, listener) { (this.listeners[event] ??= []).push(listener); } });
  return targets.get(id);
 };
 let interval, storageChanged, messageReceived;
 const probes = [];
 const context = {
  document: { hidden: false, createElement: () => target('help'), getElementById: target, addEventListener() {} },
  window: { addEventListener() {} }, AbortController,
  setInterval(callback) { interval = callback; },
  chrome: {
   runtime: { sendMessage: async () => ({connected:false}), connectNative() {}, onMessage: { addListener(listener) { messageReceived = listener; } } },
   storage: { onChanged: { addListener(listener) { storageChanged = listener; } } },
  },
  getConsentState: async () => ({decision:'accepted'}),
  connectionGuidance: () => 'Ready to connect',
  probeNativeHost(connect, signal) { return new Promise(resolve => probes.push({signal, resolve})); },
 };
 const raw = readFileSync(new URL('../chrome/chrome-options.js', import.meta.url), 'utf8');
 const source = (crlf ? raw.replace(/\r?\n/g, '\r\n') : raw).replace(/^import .*;\r?\n/gm, '');
 vm.runInNewContext(source, context);
 return { probes, help: target('help'),
  click(id) { for (const listener of target(id).listeners.click ?? []) listener(); },
  poll() { interval(); },
  changed(decision) { storageChanged({focus_data_consent:{newValue:{version:1,decision}}}, 'local'); },
  message(message) { messageReceived?.(message); },
 };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('Chrome options abort immediately when withdrawal persistence is delayed or fails', async () => {
 const f = optionsFixture(); await flush();
 assert.equal(f.probes.length, 1);
 f.click('consentStop');
 assert.equal(f.probes[0].signal.aborted, true);
 f.probes[0].resolve('ready'); await flush();
 f.changed('accepted'); await flush();
 f.poll(); await flush();
 assert.equal(f.probes.length, 1, 'old accepted storage must not reopen diagnostics');
 assert.equal(f.help.textContent, '');
});
test('only a persisted acceptance resumes diagnostics after withdrawal', async () => {
 const f = optionsFixture(); await flush();
 f.click('consentDecline');
 f.message({type:'consent:accept'}); f.poll(); await flush();
 assert.equal(f.probes.length, 1);
 f.changed('accepted'); await flush();
 assert.equal(f.probes.length, 2);
});
test('withdrawal from another options page aborts this page diagnostics', async () => {
 const f = optionsFixture(); await flush();
 f.message({type:'consent:stop'}); await flush();
 assert.equal(f.probes[0].signal.aborted, true);
 f.poll(); await flush();
 assert.equal(f.probes.length, 1);
});

test('Chrome wrapper fixture accepts Windows checkout line endings', async () => {
 const f = optionsFixture({crlf:true}); await flush();
 assert.equal(f.probes.length, 1);
 f.click('consentStop');
 assert.equal(f.probes[0].signal.aborted, true);
});
