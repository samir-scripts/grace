import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual, webcrypto } from 'node:crypto';

const TOKEN = 'background-test-shared-secret';
const policy = (revision = 1, domains = ['example.com']) => ({ type: 'policy', version: 3, revision, active: domains.length > 0, domains, lease_secs: 15 });
const hmac = (key, text) => createHmac('sha256', key).update(text).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate, description) {
  for (let attempts = 0; attempts < 1000; attempts++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`Did not observe ${description}`);
}
async function flush() {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
}

async function background(t, options = {}) {
  const descriptors = new Map();
  const replace = (name, value) => {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const timers = new Map();
  let timerId = 0;
  const clock = {
    fireTimeout(ms) {
      for (const [id, timer] of [...timers]) {
        if (!timer.interval && timer.ms === ms) { timers.delete(id); timer.callback(); }
      }
    },
    fireIntervals() {
      for (const timer of [...timers.values()]) if (timer.interval) timer.callback();
    },
    count(ms, interval = false) { return [...timers.values()].filter(timer => timer.ms === ms && timer.interval === interval).length; }
  };
  replace('setTimeout', (callback, ms) => { timers.set(++timerId, { callback, ms, interval: false }); return timerId; });
  replace('clearTimeout', id => timers.delete(id));
  replace('setInterval', (callback, ms) => { timers.set(++timerId, { callback, ms, interval: true }); return timerId; });
  replace('clearInterval', id => timers.delete(id));
  replace('crypto', options.crypto || webcrypto);
  const sockets = [];
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 3;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    open() { this.readyState = 1; return this.onopen?.(); }
    send(wire) { assert.equal(this.readyState, 1); this.sent.push(wire); }
    receive(message) { return this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) }); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.({ code: 1000, wasClean: true }));
    }
  }
  replace('WebSocket', Socket);
  let reconnect;
  let storageChanged;
  const stored = { token: TOKEN, profile_id: 'profile-a', port: 1421, ...(options.consent === false ? {} : { focus_data_consent: { version: 1, decision: 'accepted' } }) };
  const listeners = {};
  let nativeCalls = 0;
  let rules = options.initialRules || [];
  const mutations = [];
  const redirects = [];
  const logs = [];
  const originalDebug = console.debug;
  const originalLog = console.log;
  console.debug = (...args) => logs.push(args);
  console.log = (...args) => logs.push(args);
  const api = {
    runtime: {
      getURL: path => `moz-extension://background-test/${path}`,
      getBrowserInfo: async () => ({ name: 'Firefox' }),
      onMessage: { addListener: callback => { reconnect = callback; } },
      onStartup: { addListener: callback => { listeners.startup = callback; } },
      onInstalled: { addListener: callback => { listeners.installed = callback; } },
      openOptionsPage: async () => { listeners.optionsOpened = true; },
      ...(options.native ? { connectNative: () => { nativeCalls++; return options.native; } } : {})
    },
    management: { getSelf: options.getSelf || (async () => ({ installType: 'development', mayDisable: true })) },
    storage: {
      local: { get: options.getStorage || (async () => stored), set: options.setStorage || (async value => Object.assign(stored, value)) },
      onChanged: { addListener: callback => { storageChanged = callback; } },
    },
    permissions: { onRemoved: { addListener: callback => { listeners.permissionRemoved = callback; } } },
    alarms: { onAlarm: { addListener: callback => { listeners.alarm = callback; } }, create() {} },
    declarativeNetRequest: {
      getDynamicRules: async () => rules.map(rule => ({ ...rule })),
      updateDynamicRules: async change => {
        mutations.push(change);
        if (options.updateRules) await options.updateRules(change, mutations.length);
        rules = rules.filter(rule => !change.removeRuleIds.includes(rule.id)).concat(change.addRules);
      }
    },
    tabs: {
      query: async () => [{ id: 7, url: 'https://example.com/existing' }],
      update: async (id, change) => { redirects.push({ id, ...change }); },
      onActivated: { addListener: callback => { listeners.activated = callback; } }
    }
  };
  replace('browser', api);
  replace('chrome', undefined);
  t.after(() => {
    for (const socket of sockets) {
      socket.onerror?.();
      socket.onclose = null;
      socket.close();
      assert.equal(socket.sent.some(wire => wire.includes(TOKEN)), false, 'credential never appears on the socket');
    }
    timers.clear();
    console.debug = originalDebug;
    console.log = originalLog;
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await import(`../focus/background.js?auth-test=${Math.random()}`);
  if (options.consent !== false) await until(() => sockets.length === 1, 'initial WebSocket');
  else await flush();
  return { sockets, clock, mutations, redirects, logs, stored, listeners, nativeCalls: () => nativeCalls,
    rules: () => rules, reconnect: () => reconnect({ type: 'reconnect' }), stop: () => reconnect({ type: 'consent:stop' }),
    begin: () => { let generation; reconnect({ type: 'consent:begin' }, null, value => { generation = value; }); return generation; },
    accept: generation => reconnect({ type: 'consent:accept', generation }),
    changeConsent: value => { stored.focus_data_consent = value; storageChanged?.({ focus_data_consent: { newValue: value } }, 'local'); } };
}

function peer(socket, nonce = '1'.repeat(64)) {
  const init = JSON.parse(socket.sent[0]);
  assert.deepEqual(Object.keys(init).sort(), ['client_nonce', 'type', 'version']);
  assert.equal(init.type, 'auth_init');
  assert.equal(init.version, 3);
  assert.match(init.client_nonce, /^[0-9a-f]{64}$/);
  const base = `pomotroid-focus-v3`;
  const transcript = role => `${base}\n${role}\n${init.client_nonce}\n${nonce}`;
  let clientKey;
  let serverKey;
  let outgoing = 0;
  let incoming = 0;
  return {
    challenge: { type: 'auth_challenge', version: 3, server_nonce: nonce, proof: hmac(TOKEN, transcript('server')) },
    accept() {
      const response = socket.sent.map(wire => JSON.parse(wire)).find(msg => msg.type === 'auth_response');
      assert.ok(response);
      assert.equal(response.version, 3);
      const expected = hmac(TOKEN, `${transcript('client')}\n${response.metadata}`);
      assert.ok(timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(response.proof, 'hex')));
      assert.deepEqual(JSON.parse(response.metadata), ['profile-a']);
      clientKey = Buffer.from(hmac(TOKEN, `${transcript('key-client')}\n${response.metadata}`), 'hex');
      serverKey = Buffer.from(hmac(TOKEN, `${transcript('key-server')}\n${response.metadata}`), 'hex');
      assert.equal(socket.sent.some(wire => wire.includes(TOKEN)), false);
    },
    frame(body) {
      const payload = JSON.stringify(body);
      const sequence = ++outgoing;
      return JSON.stringify({ type: 'authenticated', sequence, payload, mac: hmac(serverKey, `${base}\nframe\n${sequence}\n${payload}`) });
    },
    received() {
      return socket.sent.map(wire => JSON.parse(wire)).filter(msg => msg.type === 'authenticated').map(msg => {
        assert.equal(msg.sequence, ++incoming);
        const expected = hmac(clientKey, `${base}\nframe\n${msg.sequence}\n${msg.payload}`);
        assert.ok(timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(msg.mac, 'hex')));
        return JSON.parse(msg.payload);
      });
    }
  };
}

async function open(socket) {
  await socket.open();
  await until(() => socket.sent.length > 0, 'auth_init');
}
async function authenticate(socket, nonce) {
  await open(socket);
  const server = peer(socket, nonce);
  await socket.receive(server.challenge);
  await until(() => socket.sent.length === 2, 'verified auth_response');
  server.accept();
  return server;
}
async function replaceConnection(env) {
  env.reconnect();
  await until(() => env.sockets.length === 2, 'replacement WebSocket');
  return env.sockets[1];
}

test('pending consent blocks native and stored-credential connections on all startup paths', async t => {
  const native = { postMessage() {}, onMessage: { addListener() {} }, onDisconnect: { addListener() {} } };
  const env = await background(t, { consent: false, native });
  env.listeners.startup(); env.listeners.installed(); env.listeners.alarm({ name: 'pomotroid-reconnect' });
  env.listeners.activated(); env.reconnect();
  await flush();
  assert.equal(env.nativeCalls(), 0);
  assert.equal(env.sockets.length, 0);
});

test('withdrawal prevents reconnect and stale DNR completion from sending an ACK', async t => {
  const gate = deferred();
  const env = await background(t, { updateRules: () => gate.promise });
  const socket = env.sockets[0];
  const server = await authenticate(socket);
  socket.receive(server.frame(policy()));
  await until(() => env.mutations.length === 1, 'in-flight rule update');
  env.changeConsent({ version: 1, decision: 'declined' });
  env.listeners.startup(); env.reconnect(); env.clock.fireIntervals();
  gate.resolve();
  await flush();
  assert.equal(socket.readyState, 3);
  assert.equal(socket.sent.length, 2);
  assert.equal(env.sockets.length, 1);
});

test('withdrawal remains stopped while the declined choice is being persisted', async t => {
  const env = await background(t);
  env.stop();
  env.listeners.startup();
  env.reconnect();
  await flush();
  assert.equal(env.sockets.length, 1);
  assert.equal(env.sockets[0].readyState, 3);
});

test('stale accept notification cannot undo a newer withdrawal', async t => {
  const env = await background(t);
  const generation = env.begin();
  env.stop();
  env.accept(generation);
  await flush();
  assert.equal(env.sockets.length, 1);
  assert.equal(env.sockets[0].readyState, 3);
});

test('withdrawal persists after an earlier delayed acceptance write', async t => {
  const gate = deferred();
  const entered = deferred();
  const saved = {};
  const env = await background(t, { consent: false, setStorage: async value => {
    if (value.focus_data_consent?.decision === 'accepted') {
      entered.resolve();
      await gate.promise;
    }
    Object.assign(saved, value);
  } });
  const generation = env.begin();
  env.accept(generation);
  await entered.promise;
  env.stop();
  gate.resolve();
  await flush();
  assert.equal(saved.focus_data_consent.decision, 'declined');
  assert.equal(env.sockets.length, 0);
});

test('permission withdrawal stops sharing even if saving the declined choice fails', async t => {
  const env = await background(t, { setStorage: async () => { throw new Error('disk failure'); } });
  env.listeners.permissionRemoved({ permissions: ['nativeMessaging'] });
  env.listeners.startup();
  await flush();
  assert.equal(env.sockets[0].readyState, 3);
  assert.equal(env.sockets.length, 1);
  assert.equal(env.listeners.optionsOpened, true);
});

test('withdrawal prevents a delayed credential lookup from creating a socket', async t => {
  const gate = deferred();
  const entered = deferred();
  let calls = 0;
  const stored = { token: TOKEN, profile_id: 'profile-a', port: 1421, focus_data_consent: { version: 1, decision: 'accepted' } };
  const envPromise = background(t, { consent: false, getStorage: async keys => {
    if (++calls === 2) { entered.resolve(); await gate.promise; }
    return stored;
  } });
  await entered.promise;
  const env = await envPromise;
  env.stop();
  gate.resolve();
  await flush();
  assert.equal(env.sockets.length, 0);
});

test('explicit acceptance connects and subsequent withdrawal prevents reconnect', async t => {
  const env = await background(t, { consent: false });
  const generation = env.begin();
  env.changeConsent({ version: 1, decision: 'accepted' });
  env.accept(generation);
  await until(() => env.sockets.length === 1, 'consented connection');
  const socket = env.sockets[0];
  const server = await authenticate(socket);
  await socket.receive(server.frame(policy()));
  await until(() => socket.sent.length === 3, 'consented policy ACK');
  assert.deepEqual(server.received().map(body => body.type), ['ack']);
  env.changeConsent({ version: 1, decision: 'declined' });
  env.listeners.startup(); env.reconnect(); env.clock.fireTimeout(2000);
  await flush();
  assert.equal(socket.readyState, 3);
  assert.equal(env.sockets.length, 1);
});
test('native host loss falls back to stored credentials and reconnects with authenticated policy ACKs', async t => {
  let disconnect;
  const native = {
    onMessage: { addListener() {} },
    onDisconnect: { addListener(callback) { disconnect = callback; } },
    postMessage() { queueMicrotask(() => disconnect()); },
    disconnect() {}
  };
  const env = await background(t, { native });
  assert.equal(env.nativeCalls(), 1);
  const first = env.sockets[0];
  const firstPeer = await authenticate(first);
  await first.receive(firstPeer.frame(policy(1)));
  await until(() => first.sent.length === 3, 'first authenticated policy ACK');
  assert.deepEqual(firstPeer.received().map(message => [message.type, message.revision]), [['ack', 1]]);
  assert.equal(env.rules()[0].condition.urlFilter, '||example.com^');

  first.close();
  await flush();
  env.clock.fireTimeout(2000);
  await until(() => env.sockets.length === 2, 'stored-credential reconnect');
  const second = env.sockets[1];
  const secondPeer = await authenticate(second, '2'.repeat(64));
  await second.receive(secondPeer.frame(policy(2)));
  await until(() => second.sent.length === 3, 'reconnected authenticated policy ACK');
  assert.deepEqual(secondPeer.received().map(message => [message.type, message.revision]), [['ack', 2]]);
  assert.equal(env.rules()[0].condition.urlFilter, '||example.com^');
});

test('rogue challenge closes without client proof, credential disclosure, or DNR changes', async t => {
  const env = await background(t);
  const socket = env.sockets[0];
  await open(socket);
  await socket.receive({ ...peer(socket).challenge, proof: '0'.repeat(64) });
  await until(() => socket.readyState === 3, 'rogue socket closure');
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent.some(wire => wire.includes(TOKEN)), false);
  assert.deepEqual(env.mutations, []);
  assert.equal(JSON.stringify(env.logs).includes(TOKEN), false);
});

test('policy before server proof fails closed and retains existing rules', async t => {
  const retained = [{ id: 99, action: { type: 'block' }, condition: { urlFilter: '||retained.example^' } }];
  const env = await background(t, { initialRules: retained });
  const socket = env.sockets[0];
  await open(socket);
  await socket.receive(policy(1, []));
  await until(() => socket.readyState === 3, 'pre-auth policy rejection');
  assert.equal(socket.sent.length, 1);
  assert.deepEqual(env.rules(), retained);
  assert.deepEqual(env.mutations, []);
});

test('challenge and first-policy deadlines are independent and heartbeat waits for establishment', async t => {
  const env = await background(t);
  const first = env.sockets[0];
  await open(first);
  assert.equal(env.clock.count(5000), 1);
  assert.equal(env.clock.count(2000, true), 0);
  env.clock.fireTimeout(5000);
  await until(() => first.readyState === 3, 'challenge timeout');
  env.clock.fireTimeout(2000);
  await until(() => env.sockets.length === 2, 'timeout reconnect');
  const second = env.sockets[1];
  await authenticate(second);
  assert.equal(env.clock.count(5000), 1);
  assert.equal(env.clock.count(2000, true), 0);
  env.clock.fireTimeout(5000);
  await until(() => second.readyState === 3, 'first-policy timeout');
  assert.deepEqual(env.mutations, []);
});

test('valid first policy establishes before DNR completion and ACK and heartbeat are authenticated', async t => {
  const gate = deferred();
  const env = await background(t, { updateRules: () => gate.promise });
  const socket = env.sockets[0];
  const server = await authenticate(socket);
  socket.receive(server.frame(policy()));
  await until(() => env.mutations.length === 1, 'policy mutation');
  assert.equal(env.clock.count(5000), 0);
  assert.equal(env.clock.count(2000, true), 1);
  env.clock.fireIntervals();
  await until(() => socket.sent.length === 3, 'authenticated heartbeat during DNR');
  gate.resolve();
  await until(() => socket.sent.length === 4, 'authenticated ACK');
  assert.deepEqual(server.received().map(body => body.type), ['heartbeat', 'ack']);
  assert.equal(env.rules()[0].condition.urlFilter, '||example.com^');
  assert.equal(env.redirects.length, 1);
});

test('policy failure closes without transmitting exception details or an ACK', async t => {
  const env = await background(t, { updateRules: async () => { throw new Error('sensitive https://example.com secret'); } });
  const socket = env.sockets[0];
  const server = await authenticate(socket);
  await socket.receive(server.frame(policy()));
  await until(() => socket.readyState === 3, 'policy failure closure');
  assert.equal(socket.sent.length, 2);
  assert.equal(JSON.stringify(socket.sent).includes('sensitive'), false);
});

test('tampered policy is rejected without mutation or ACK after a valid handshake', async t => {
  const env = await background(t);
  const socket = env.sockets[0];
  const server = await authenticate(socket);
  await socket.receive(server.frame(policy()).replace('example.com', 'attacker.com'));
  await until(() => socket.readyState === 3, 'tampered policy closure');
  assert.deepEqual(env.mutations, []);
  assert.equal(socket.sent.length, 2);
});

test('concurrent asynchronous frame verification preserves policy application and ACK order', async t => {
  const gate = deferred();
  const entered = deferred();
  let checks = 0;
  const crypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes), subtle: new Proxy(webcrypto.subtle, { get(target, prop) {
    if (prop === 'verify') return async (...args) => {
      if (++checks === 2) { entered.resolve(); await gate.promise; }
      return target.verify(...args);
    };
    return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
  } }) };
  const env = await background(t, { crypto });
  const socket = env.sockets[0];
  const server = await authenticate(socket);
  socket.receive(server.frame(policy(1)));
  await entered.promise;
  socket.receive(server.frame(policy(2, ['example.org'])));
  gate.resolve();
  await until(() => socket.sent.length === 4, 'two ordered ACKs');
  assert.deepEqual(server.received().map(body => body.revision), [1, 2]);
  assert.equal(env.rules()[0].condition.urlFilter, '||example.org^');
});

test('stale socket close and messages cannot stop replacement heartbeat or apply policy', async t => {
  const env = await background(t);
  const old = env.sockets[0];
  const oldServer = await authenticate(old);
  await old.receive(oldServer.frame(policy(1)));
  await until(() => old.sent.length === 3, 'old ACK');
  const replacement = await replaceConnection(env);
  const server = await authenticate(replacement, '2'.repeat(64));
  assert.notEqual(JSON.parse(old.sent[0]).client_nonce, JSON.parse(replacement.sent[0]).client_nonce);
  await replacement.receive(server.frame(policy(2, ['example.org'])));
  await until(() => replacement.sent.length === 3, 'replacement ACK');
  old.onclose({ code: 1000, wasClean: true });
  await old.receive(oldServer.frame(policy(3, [])));
  env.clock.fireIntervals();
  await until(() => replacement.sent.length === 4, 'replacement heartbeat survives stale close');
  assert.deepEqual(server.received().map(body => body.type), ['ack', 'heartbeat']);
  assert.equal(env.rules()[0].condition.urlFilter, '||example.org^');
  assert.equal(env.clock.count(2000), 0);
});


test('delayed old verification cannot dispatch policy after socket replacement', async t => {
  const gate = deferred();
  const entered = deferred();
  let checks = 0;
  const crypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes), subtle: new Proxy(webcrypto.subtle, { get(target, prop) {
    if (prop === 'verify') return async (...args) => {
      if (++checks === 2) { entered.resolve(); await gate.promise; }
      return target.verify(...args);
    };
    return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
  } }) };
  const env = await background(t, { crypto });
  const old = env.sockets[0];
  const oldServer = await authenticate(old);
  old.receive(oldServer.frame(policy(1)));
  await entered.promise;
  const replacement = await replaceConnection(env);
  const server = await authenticate(replacement, '2'.repeat(64));
  await replacement.receive(server.frame(policy(2, ['example.org'])));
  await until(() => replacement.sent.length === 3, 'replacement ACK');
  gate.resolve();
  await flush();
  assert.equal(env.mutations.length, 1);
  assert.equal(env.rules()[0].condition.urlFilter, '||example.org^');
  assert.equal(old.sent.length, 2);
});

test('replacement policy runs after an already-started old DNR mutation with no stale ACK or redirects', async t => {
  const gate = deferred();
  const env = await background(t, { updateRules: (_change, count) => count === 1 ? gate.promise : Promise.resolve() });
  const old = env.sockets[0];
  const oldServer = await authenticate(old);
  old.receive(oldServer.frame(policy(1)));
  await until(() => env.mutations.length === 1, 'old in-flight DNR operation');
  const replacement = await replaceConnection(env);
  const server = await authenticate(replacement, '2'.repeat(64));
  replacement.receive(server.frame(policy(2, ['example.org'])));
  await flush();
  assert.equal(env.mutations.length, 1);
  gate.resolve();
  await until(() => replacement.sent.length === 3, 'replacement ACK after old operation');
  assert.equal(env.rules()[0].condition.urlFilter, '||example.org^');
  assert.equal(env.mutations.length, 2);
  assert.deepEqual(env.redirects, []);
  assert.equal(old.sent.length, 2);
  assert.deepEqual(server.received().map(body => body.revision), [2]);
});
