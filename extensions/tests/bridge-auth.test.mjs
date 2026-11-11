import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual, webcrypto } from 'node:crypto';
import { createClientAuth } from '../focus/bridge-auth.js';

const TOKEN = 'test-only-shared-secret';
const C = '0'.repeat(64);
const S = '1'.repeat(64);
const META = ['profile-a'];
const M = '["profile-a"]';
const POLICY = { type: 'policy', version: 3, revision: 0, active: false, domains: [], lease_secs: 15 };
const PAYLOAD = '{"type":"policy","version":3,"revision":0,"active":false,"domains":[],"lease_secs":15}';
const hmac = (key, input) => createHmac('sha256', key).update(input).digest('hex');
const transcript = (role, c = C, s = S, metadata) => `pomotroid-focus-v3\n${role}\n${c}\n${s}${metadata === undefined ? '' : `\n${metadata}`}`;
const challenge = (c = C, s = S) => ({ type: 'auth_challenge', version: 3, server_nonce: s, proof: hmac(TOKEN, transcript('server', c, s)) });
const key = (role, c = C, s = S, metadata = M) => Buffer.from(hmac(TOKEN, transcript(role, c, s, metadata)), 'hex');
const frame = (payload = PAYLOAD, sequence = 1, secret = key('key-server')) => JSON.stringify({
  type: 'authenticated', sequence, payload,
  mac: hmac(secret, `pomotroid-focus-v3\nframe\n${sequence}\n${payload}`)
});

const configuredCrypto = new WeakSet();

function useCrypto(t, overrides = {}) {
  if (!configuredCrypto.has(t)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    t.after(() => descriptor ? Object.defineProperty(globalThis, 'crypto', descriptor) : delete globalThis.crypto);
    configuredCrypto.add(t);
  }
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    getRandomValues: bytes => bytes.fill(0), subtle: webcrypto.subtle, ...overrides
  } });
}

async function ready(t) {
  useCrypto(t);
  const client = createClientAuth(TOKEN, META);
  client.init();
  await client.acceptChallenge(challenge());
  return client;
}

test('v3 authenticates a single profile identity without browser metadata', async t => {
  useCrypto(t);
  const client = createClientAuth(TOKEN, ['profile-a']);
  assert.deepEqual(client.init(), { type: 'auth_init', version: 3, client_nonce: C });
  const response = await client.acceptChallenge({
    type: 'auth_challenge', version: 3, server_nonce: S,
    proof: 'e3fc9452addcb73ffc16a1f94082e42bd565be154b099aac3ce39a87172026fb'
  });
  assert.deepEqual(response, {
    type: 'auth_response', version: 3, metadata: '["profile-a"]',
    proof: 'a697f84bb151b672d87b2df111883dddb7d9168d1fbd6702640c7be10f04b814'
  });
  for (const metadata of [[], [''], ['profile-a', 'firefox'], ['profile-a', 'firefox', 'development', true]]) {
    assert.throws(() => createClientAuth(TOKEN, metadata));
  }
});

test('literal cross-language proofs and frame vector use UTF-8 token bytes and exact metadata', async t => {
  useCrypto(t);
  const client = createClientAuth(TOKEN, META);
  assert.deepEqual(client.init(), { type: 'auth_init', version: 3, client_nonce: C });
  assert.equal(challenge().proof, 'e3fc9452addcb73ffc16a1f94082e42bd565be154b099aac3ce39a87172026fb');
  const response = await client.acceptChallenge(challenge());
  assert.deepEqual(response, { type: 'auth_response', version: 3, metadata: M, proof: 'a697f84bb151b672d87b2df111883dddb7d9168d1fbd6702640c7be10f04b814' });
  assert.equal(key('key-client').toString('hex'), 'e32df8a42114455dca89e6ae6da62fa2c0999b702faf94e228e4e63f143e496f');
  assert.equal(key('key-server').toString('hex'), '744d842dc3f2dc5c4f1e5b5bae9148a4261e124917694e0912d3386ecb352a76');
  assert.equal(JSON.parse(frame()).mac, '5e6f93b568a06cf9200947e6653d14461ddc07c12ea97839520f2954eccdb083');
  assert.deepEqual(await client.decode(frame()), POLICY);
  const ack = JSON.parse(await client.encode({ type: 'ack', revision: 0, profile_id: 'profile-a' }));
  assert.equal(ack.sequence, 1);
  const expected = hmac(key('key-client'), `pomotroid-focus-v3\nframe\n1\n${ack.payload}`);
  assert.ok(timingSafeEqual(Buffer.from(ack.mac, 'hex'), Buffer.from(expected, 'hex')));
  assert.equal(JSON.stringify(response).includes(TOKEN), false);
});

test('rogue server bad proof rejects without returning a client proof', async t => {
  useCrypto(t);
  const client = createClientAuth(TOKEN, META);
  client.init();
  await assert.rejects(client.acceptChallenge({ ...challenge(), proof: 'a'.repeat(64) }));
  await assert.rejects(client.encode({ type: 'heartbeat', revision: 0 }));
});

test('client proof reflected as server proof and changed nonce are rejected', async t => {
  useCrypto(t);
  for (const message of [
    { ...challenge(), proof: 'a697f84bb151b672d87b2df111883dddb7d9168d1fbd6702640c7be10f04b814' },
    { ...challenge(), server_nonce: '2'.repeat(64) },
    { ...challenge(), proof: challenge().proof.toUpperCase() },
    { ...challenge(), server_nonce: 'z'.repeat(64) },
    { ...challenge(), version: 1 },
    POLICY
  ]) {
    const client = createClientAuth(TOKEN, META);
    client.init();
    await assert.rejects(client.acceptChallenge(message));
  }
});

test('metadata is bound exactly and rejects invalid or oversized values', async t => {
  useCrypto(t);
  const client = createClientAuth(TOKEN, ['profile-b', ...META.slice(1)]);
  client.init();
  const response = await client.acceptChallenge(challenge());
  assert.notEqual(response.proof, 'a697f84bb151b672d87b2df111883dddb7d9168d1fbd6702640c7be10f04b814');
  assert.equal(response.proof, hmac(TOKEN, transcript('client', C, S, response.metadata)));
  for (const metadata of [[], [''], ['a', 'firefox'], ['a', 'firefox', 'development', true], ['é'.repeat(2100)]]) {
    assert.throws(() => createClientAuth(TOKEN, metadata));
  }
});

test('init and challenge are single use and sends wait for a verified first policy', async t => {
  useCrypto(t);
  const uninitialized = createClientAuth(TOKEN, META);
  await assert.rejects(uninitialized.acceptChallenge(challenge()));
  const client = createClientAuth(TOKEN, META);
  client.init();
  assert.throws(() => client.init());
  await client.acceptChallenge(challenge());
  await assert.rejects(client.encode({ type: 'heartbeat', revision: 0 }));
  await assert.rejects(client.acceptChallenge(challenge()));
});

test('first authenticated body must be a version-3 policy', async t => {
  for (const body of [{ type: 'heartbeat' }, { ...POLICY, version: 2 }, { type: 'auth_challenge', version: 3 }]) {
    const client = await ready(t);
    await assert.rejects(client.decode(frame(JSON.stringify(body))));
    await assert.rejects(client.encode({ type: 'ack', revision: 0 }));
  }
});

test('tampered payload and malformed MAC fail closed before dispatch', async t => {
  for (const mutate of [
    wire => ({ ...wire, payload: wire.payload.replace('false', 'true') }),
    wire => ({ ...wire, mac: 'g'.repeat(64) }),
    wire => ({ ...wire, mac: wire.mac.toUpperCase() }),
    wire => ({ ...wire, sequence: 0 }),
    wire => ({ ...wire, sequence: 1.5 }),
    wire => ({ ...wire, sequence: Number.MAX_SAFE_INTEGER + 1 }),
    () => POLICY
  ]) {
    const client = await ready(t);
    await assert.rejects(client.decode(JSON.stringify(mutate(JSON.parse(frame())))));
    await assert.rejects(client.decode(frame()));
  }
});

test('duplicate skipped and reflected directional frames are rejected', async t => {
  let client = await ready(t);
  await client.decode(frame());
  await assert.rejects(client.decode(frame()));
  client = await ready(t);
  await assert.rejects(client.decode(frame(PAYLOAD, 2)));
  client = await ready(t);
  await assert.rejects(client.decode(frame(PAYLOAD, 1, key('key-client'))));
});

test('fresh client nonce rejects a previously authenticated session frame', async t => {
  useCrypto(t, { getRandomValues: bytes => bytes.fill(2) });
  const client = createClientAuth(TOKEN, META);
  const init = client.init();
  assert.notEqual(init.client_nonce, C);
  await client.acceptChallenge(challenge(init.client_nonce));
  await assert.rejects(client.decode(frame()));
});

test('concurrent verification and sends preserve exact wire order', async t => {
  let release;
  let entered;
  const pending = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let checks = 0;
  useCrypto(t, { subtle: new Proxy(webcrypto.subtle, { get(target, prop) {
    if (prop === 'verify') return async (...args) => {
      if (++checks === 2) { entered(); await gate; }
      return target.verify(...args);
    };
    return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
  } }) });
  const client = createClientAuth(TOKEN, META);
  client.init();
  await client.acceptChallenge(challenge());
  const first = client.decode(frame());
  await pending;
  const second = client.decode(frame(JSON.stringify({ type: 'heartbeat' }), 2));
  release();
  assert.deepEqual(await Promise.all([first, second]), [POLICY, { type: 'heartbeat' }]);
  const sent = await Promise.all([client.encode({ type: 'ack', revision: 0 }), client.encode({ type: 'heartbeat', revision: 0 })]);
  assert.deepEqual(sent.map(wire => JSON.parse(wire).sequence), [1, 2]);
});

test('authenticated inner handshake and unknown bodies are not accepted', async t => {
  const client = await ready(t);
  await client.decode(frame());
  await assert.rejects(client.decode(frame('{"type":"auth_init","version":2}', 2)));
  const sender = await ready(t);
  await sender.decode(frame());
  await assert.rejects(sender.encode({ type: 'hello', token: TOKEN }));
});

test('missing Web Crypto fails closed rather than using insecure randomness', t => {
  useCrypto(t, { subtle: undefined });
  assert.throws(() => createClientAuth(TOKEN, META));
});
