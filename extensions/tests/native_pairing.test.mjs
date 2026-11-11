import test from 'node:test';
import assert from 'node:assert/strict';
import { tryNativePairing } from '../focus/native-pairing.js';

test('tryNativePairing successfully connects and saves config to storage', async () => {
  let postedMessage = null;
  let messageListener = null;
  let disconnectListener = null;

  const mockPort = {
    postMessage: (msg) => { postedMessage = msg; },
    onMessage: {
      addListener: (fn) => { messageListener = fn; }
    },
    onDisconnect: {
      addListener: (fn) => { disconnectListener = fn; }
    }
  };

  const mockConnectNative = (name) => {
    assert.equal(name, 'com.splode.pomotroid');
    return mockPort;
  };

  const stored = {};
  const mockStorage = {
    get: (keys, cb) => cb(stored),
    set: (items, cb) => {
      Object.assign(stored, items);
      if (cb) cb();
    }
  };

  let pairedResult = null;
  const pairingPromise = tryNativePairing({
    connectNative: mockConnectNative,
    storage: mockStorage,
    onPaired: (res) => { pairedResult = res; }
  });

  assert.deepEqual(postedMessage, { type: 'connect' });

  // Simulate host response
  messageListener({
    type: 'config',
    token: 'auto-paired-token-456',
    port: 1421
  });

  const success = await pairingPromise;
  assert.equal(success, true);
  assert.equal(stored.token, 'auto-paired-token-456');
  assert.equal(stored.port, 1421);
  assert.ok(stored.profile_id);
  assert.equal(stored.is_native_paired, true);
  assert.equal(pairedResult.token, 'auto-paired-token-456');
});

test('paired native port stays open until sharing is stopped', async () => {
  let receive;
  let closed = 0;
  const controller = new AbortController();
  const port = {
    postMessage() {},
    disconnect() { closed++; },
    onMessage: { addListener(fn) { receive = fn; } },
    onDisconnect: { addListener() {} }
  };
  const pending = tryNativePairing({
    connectNative: () => port,
    storage: { get: async () => ({}), set: async () => {} },
    signal: controller.signal,
    keepOpen: true,
  });
  await receive({ type: 'config', token: 'test-only-token', port: 1421 });
  assert.equal(await pending, true);
  assert.equal(closed, 0);
  controller.abort();
  assert.equal(closed, 1);
});

test('tryNativePairing returns false when connectNative is missing', async () => {
  const success = await tryNativePairing({
    connectNative: null,
    storage: {},
    onPaired: () => {}
  });
  assert.equal(success, false);
});

test('tryNativePairing handles port disconnect gracefully', async () => {
  let disconnectListener = null;
  const mockPort = {
    postMessage: () => {},
    onMessage: { addListener: () => {} },
    onDisconnect: { addListener: (fn) => { disconnectListener = fn; } }
  };

  const pairingPromise = tryNativePairing({
    connectNative: () => mockPort,
    storage: {},
    onPaired: () => {}
  });

  disconnectListener();
  const success = await pairingPromise;
  assert.equal(success, false);
});

test('tryNativePairing supports Promise-returning storage (Gecko WebExtension storage)', { timeout: 1000 }, async () => {
  let postedMessage = null;
  let messageListener = null;

  const mockPort = {
    postMessage: (msg) => { postedMessage = msg; },
    onMessage: { addListener: (fn) => { messageListener = fn; } },
    onDisconnect: { addListener: () => {} }
  };

  const stored = {};
  // Mock storage that only returns Promises and does not invoke callback
  const mockPromiseStorage = {
    get: async (keys) => {
      return stored;
    },
    set: async (items) => {
      Object.assign(stored, items);
    }
  };

  const pairingPromise = tryNativePairing({
    connectNative: () => mockPort,
    storage: mockPromiseStorage,
    onPaired: () => {}
  });

  messageListener({
    type: 'config',
    token: 'gecko-token-789',
    port: 1421
  });

  const success = await pairingPromise;
  assert.equal(success, true);
  assert.equal(stored.token, 'gecko-token-789');
  assert.equal(stored.port, 1421);
  assert.ok(stored.profile_id);
  assert.equal(stored.is_native_paired, true);
});

test('tryNativePairing returns false when storage.set fails', async () => {
  let messageListener = null;
  const mockPort = {
    postMessage: () => {},
    onMessage: { addListener: (fn) => { messageListener = fn; } },
    onDisconnect: { addListener: () => {} }
  };

  const failingStorage = {
    get: async () => ({}),
    set: async () => {
      throw new Error('QuotaExceeded');
    }
  };

  const pairingPromise = tryNativePairing({
    connectNative: () => mockPort,
    storage: failingStorage,
    onPaired: () => {}
  });

  messageListener({
    type: 'config',
    token: 'token-fail',
    port: 1421
  });

  const success = await pairingPromise;
  assert.equal(success, false);
});

test('native disconnect reports a redacted reason without changing credentials', async () => {
  let disconnect;
  const events = [];
  const stored = { token: 'DO_NOT_LOG_TOKEN' };
  const before = { ...stored };
  const port = {
    error: { message: 'No such native application com.splode.pomotroid' },
    postMessage() {},
    onMessage: { addListener() {} },
    onDisconnect: { addListener(fn) { disconnect = fn; } }
  };
  const pending = tryNativePairing({
    connectNative: () => port,
    storage: { get: async () => stored, set: async items => Object.assign(stored, items) },
    onDiagnostic: event => events.push(event)
  });
  disconnect();
  assert.equal(await pending, false);
  assert.deepEqual(stored, before);
  assert.equal(events.at(-1)?.reason, 'host_not_found');
  assert.equal(JSON.stringify(events).includes('DO_NOT_LOG_TOKEN'), false);
});

test('native storage failure reports a redacted reason without pairing', async () => {
  let receive;
  let pairedCalls = 0;
  const events = [];
  const port = {
    postMessage() {},
    onMessage: { addListener(fn) { receive = fn; } },
    onDisconnect: { addListener() {} }
  };
  const pending = tryNativePairing({
    connectNative: () => port,
    storage: { get: async () => ({}), set: async () => { throw new Error('quota'); } },
    onPaired: () => { pairedCalls++; },
    onDiagnostic: event => events.push(event)
  });
  await receive({ type: 'config', token: 'DO_NOT_LOG_TOKEN', port: 1421 });
  assert.equal(await pending, false);
  assert.equal(events.at(-1)?.reason, 'storage_write_failed');
  assert.equal(pairedCalls, 0);
  assert.equal(JSON.stringify(events).includes('DO_NOT_LOG_TOKEN'), false);
});

test('withdrawal aborts native pairing and ignores a late configuration', async () => {
  const controller = new AbortController();
  let receive;
  let disconnected = false;
  let paired = false;
  const port = {
    postMessage() {},
    disconnect() { disconnected = true; },
    onMessage: { addListener(fn) { receive = fn; } },
    onDisconnect: { addListener() {} },
  };
  const stored = {};
  const pending = tryNativePairing({
    connectNative: () => port,
    storage: { get: async () => stored, set: async data => Object.assign(stored, data) },
    onPaired: () => { paired = true; },
    signal: controller.signal,
  });
  controller.abort();
  assert.equal(await pending, false);
  await receive({ type: 'config', token: 'late-secret', port: 1421 });
  assert.equal(disconnected, true);
  assert.equal(paired, false);
  assert.deepEqual(stored, {});
});
