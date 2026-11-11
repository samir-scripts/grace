const PREFIX = 'pomotroid-focus-v3';
const HEX_32 = /^[0-9a-f]{64}$/;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function unhex(value) {
  if (typeof value !== 'string' || !HEX_32.test(value)) throw new Error('invalid_auth_hex');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// One instance belongs to one socket. Keys and counters never leave this closure.
export function createClientAuth(token, metadata) {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function') throw new Error('auth_unavailable');
  if (typeof token !== 'string' || !token) throw new Error('invalid_credential');
  if (!Array.isArray(metadata) || metadata.length !== 1 ||
      typeof metadata[0] !== 'string' || !metadata[0]) {
    throw new Error('invalid_metadata');
  }
  const serializedMetadata = JSON.stringify(metadata);
  if (encoder.encode(serializedMetadata).length > 4096) throw new Error('metadata_too_large');

  let state = 'new';
  let clientNonce;
  let clientKey;
  let serverKey;
  let sent = 0;
  let received = 0;
  let sendQueue = Promise.resolve();
  let receiveQueue = Promise.resolve();
  const importKey = (bytes, usages) => crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, usages);
  const sign = (key, text) => crypto.subtle.sign('HMAC', key, encoder.encode(text));

  async function acceptChallenge(message) {
    try {
      if (state !== 'awaiting_challenge') throw new Error('unexpected_challenge');
      state = 'verifying_challenge';
      if (!message || message.type !== 'auth_challenge' || message.version !== 3) throw new Error('invalid_challenge');
      const nonce = message.server_nonce;
      unhex(nonce);
      const proof = unhex(message.proof);
      const root = await importKey(encoder.encode(token), ['sign', 'verify']);
      const base = role => `${PREFIX}\n${role}\n${clientNonce}\n${nonce}`;
      if (!await crypto.subtle.verify('HMAC', root, proof, encoder.encode(base('server')))) throw new Error('invalid_server_proof');
      if (state !== 'verifying_challenge') throw new Error('authentication_cancelled');
      const bound = role => `${base(role)}\n${serializedMetadata}`;
      const responseProof = hex(await sign(root, bound('client')));
      clientKey = await importKey(await sign(root, bound('key-client')), ['sign']);
      serverKey = await importKey(await sign(root, bound('key-server')), ['verify']);
      if (state !== 'verifying_challenge') throw new Error('authentication_cancelled');
      state = 'awaiting_policy';
      return { type: 'auth_response', version: 3, metadata: serializedMetadata, proof: responseProof };
    } catch (error) {
      state = 'failed';
      throw error;
    }
  }

  function encode(payload) {
    const result = sendQueue.then(async () => {
      if (state !== 'established') throw new Error('channel_not_established');
      if (!payload || !['ack', 'heartbeat'].includes(payload.type)) throw new Error('invalid_client_body');
      if (sent >= Number.MAX_SAFE_INTEGER) throw new Error('sequence_exhausted');
      const serialized = JSON.stringify(payload);
      const sequence = sent + 1;
      const mac = hex(await sign(clientKey, `${PREFIX}\nframe\n${sequence}\n${serialized}`));
      if (state !== 'established') throw new Error('channel_closed');
      const wire = JSON.stringify({ type: 'authenticated', sequence, payload: serialized, mac });
      if (encoder.encode(wire).length > MAX_MESSAGE_BYTES) throw new Error('message_too_large');
      sent = sequence;
      return wire;
    }).catch(error => {
      state = 'failed';
      throw error;
    });
    sendQueue = result.catch(() => {});
    return result;
  }

  function decode(wire) {
    const result = receiveQueue.then(async () => {
      if (state !== 'awaiting_policy' && state !== 'established') throw new Error('unexpected_frame');
      if (typeof wire !== 'string' || encoder.encode(wire).length > MAX_MESSAGE_BYTES) throw new Error('invalid_frame');
      const frame = JSON.parse(wire);
      if (!frame || frame.type !== 'authenticated' || !Number.isSafeInteger(frame.sequence) ||
          frame.sequence < 1 || received >= Number.MAX_SAFE_INTEGER || frame.sequence !== received + 1 ||
          typeof frame.payload !== 'string') throw new Error('invalid_frame');
      const mac = unhex(frame.mac);
      if (!await crypto.subtle.verify('HMAC', serverKey, mac, encoder.encode(`${PREFIX}\nframe\n${frame.sequence}\n${frame.payload}`))) {
        throw new Error('invalid_frame_mac');
      }
      if (state !== 'awaiting_policy' && state !== 'established') throw new Error('channel_closed');
      // Parse only after authenticating the exact received payload bytes.
      const payload = JSON.parse(frame.payload);
      if (!payload || !['policy', 'heartbeat'].includes(payload.type) ||
          (payload.type === 'policy' && payload.version !== 3) ||
          (state === 'awaiting_policy' && payload.type !== 'policy')) throw new Error('invalid_server_body');
      received = frame.sequence;
      state = 'established';
      return payload;
    }).catch(error => {
      state = 'failed';
      throw error;
    });
    receiveQueue = result.catch(() => {});
    return result;
  }

  return {
    init() {
      if (state !== 'new') throw new Error('authentication_already_started');
      clientNonce = hex(crypto.getRandomValues(new Uint8Array(32)));
      state = 'awaiting_challenge';
      return { type: 'auth_init', version: 3, client_nonce: clientNonce };
    },
    acceptChallenge,
    encode,
    decode
  };
}
