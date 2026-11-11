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
