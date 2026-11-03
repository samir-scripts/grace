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
