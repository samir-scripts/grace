import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, activeAck, targetKey, classifyExisting } from './browser-probe.mjs';

test('only a baseline-verified abort with a fresh active ACK is blocking evidence', () => {
  assert.equal(classify('work', true, { error: 'NS_ERROR_ABORT' }, true, true), 'blocked-observed');
  assert.equal(classify('work', false, { error: 'NS_ERROR_ABORT' }, true, true), 'inconclusive');
  assert.equal(classify('work', true, { error: 'NS_ERROR_ABORT' }, false, true), 'inconclusive');
  assert.equal(classify('work', true, { error: 'NS_ERROR_NET_TIMEOUT' }, true, true), 'inconclusive');
  assert.equal(classify('work', false, { url: 'https://example.org/', title: 'Example', sameHost: true }, true, false), 'inconclusive');
  assert.equal(classify('work', true, { url: 'about:blank', title: '' }, true, true), 'inconclusive');
  assert.equal(classify('released', true, { url: 'https://example.com/', title: 'Example Domain', sameHost: true }, false, true), 'loaded');
  assert.equal(classify('baseline', false, { url: 'https://example.com/', title: 'Example Domain', sameHost: true }, false, true), 'loaded');
});

test('existing tab evidence requires the exact companion block page and original URL', () => {
  const uuid = '12345678-1234-1234-1234-123456789abc';
  const original = 'https://youtube.com/';
  const url = `moz-extension://${uuid}/blocked.html?url=${encodeURIComponent(original)}`;
  assert.equal(classifyExisting(url, uuid, original, true), 'blocked-existing');
  assert.equal(classifyExisting(url, uuid, original, false), 'inconclusive');
  assert.equal(classifyExisting(url, '87654321-1234-1234-1234-123456789abc', original, true), 'inconclusive');
  assert.equal(classifyExisting(url, uuid, 'https://reddit.com/', true), 'inconclusive');
  assert.equal(classifyExisting('about:blank', uuid, original, true), 'inconclusive');
});

test('controlled observations require the nonce marker and no proxy request for a block', () => {
  const loaded = { url: 'http://youtube.com/?probe_nonce=abc', title: 'grace-probe-abc', sameHost: true, markerMatched: true };
  assert.equal(classify('baseline', false, loaded, false, true, 'controlled'), 'loaded');
  assert.equal(classify('baseline', false, { ...loaded, markerMatched: false }, false, true, 'controlled'), 'inconclusive');
  assert.equal(classify('work', true, { error: 'NS_ERROR_ABORT', proxyRequested: false }, true, true, 'controlled'), 'blocked-observed');
  assert.equal(classify('work', true, { error: 'NS_ERROR_ABORT', proxyRequested: true }, true, true, 'controlled'), 'inconclusive');
  assert.equal(classify('work', true, { error: 'NS_ERROR_ABORT' }, true, true, 'controlled'), 'inconclusive');
  assert.equal(targetKey('http://youtube.com/watch?probe_nonce=one'), targetKey('http://youtube.com/watch?probe_nonce=two'));
  assert.notEqual(targetKey('http://example.org/?next=https://reddit.com/r/all&probe_nonce=one'), targetKey('http://example.org/?probe_nonce=two'));
});

test('ACK must follow the fresh active policy for the same connection and revision', () => {
  const hello = 'hello_accepted connection=abc-123 version=3\n';
  const policy = 'policy_sent connection=abc-123 revision=4 active=true\n';
  assert.deepEqual(activeAck(hello + policy + 'ack_received connection=abc-123 revision=4\n'), { connection: 'abc-123', revision: '4' });
  assert.equal(activeAck(hello + policy + 'ack_received connection=abc-123 revision=3\n'), null);
  assert.equal(activeAck(hello + policy + 'ack_received connection=def-456 revision=4\n'), null);
  assert.equal(activeAck(hello + policy.replace('active=true', 'active=false') + 'ack_received connection=abc-123 revision=4\n'), null);
  assert.equal(activeAck(hello + 'ack_received connection=abc-123 revision=4\n' + policy), null);
  assert.equal(activeAck(hello + policy + 'ack_received connection=abc-123 revision=4\nsocket_closed connection=abc-123\n'), null);
  const broadcast = 'policy_sent revision=7 participants=1\nack_received connection=abc-123 revision=7\n';
  assert.deepEqual(activeAck(hello + broadcast, Buffer.byteLength(hello)), { connection: 'abc-123', revision: '7' });
  assert.equal(activeAck(hello + broadcast, Buffer.byteLength(hello + broadcast)), null);
  assert.equal(activeAck(hello + broadcast + 'ack_received connection=abc-123 revision=8\n', Buffer.byteLength(hello)), null);
  assert.equal(activeAck(hello + broadcast + 'policy_released revision=8\n', Buffer.byteLength(hello)), null);
});

test('target lists accept custom public URLs and reject unsafe domains', async () => {
  const { normalizeTargets } = await import('./browser-probe.mjs');
  assert.deepEqual(normalizeTargets({ blocked: ['https://news.example.net/path'], allowed: ['http://control.example.net/?q=ok'] }), { blocked: ['https://news.example.net/path'], allowed: ['http://control.example.net/?q=ok'] });
  for (const url of ['https://u:p@example.com/', 'http://localhost/', 'http://127.0.0.1/', 'https://*.example.com/', 'file:///etc/passwd', 'https://exa[mple.com/']) {
    assert.throws(() => normalizeTargets({ blocked: [url], allowed: [] }), url);
  }
  assert.throws(() => normalizeTargets({ blocked: Array(257).fill('https://example.com/'), allowed: [] }));
});

test('baseline target hash changes when a control or target changes', async () => {
  const { targetSetHash } = await import('./browser-probe.mjs');
  const a = { blocked: ['https://site.example/path'], allowed: ['https://control.example/'] };
  const b = { blocked: ['https://site.example/path'], allowed: ['https://other.example/'] };
  assert.notEqual(targetSetHash(a), targetSetHash(b));
  assert.equal(targetSetHash(a), targetSetHash({ ...a }));
});

test('reacquires only a unique exact retained page or companion block page', async () => {
  const { reacquireContext } = await import('./browser-probe.mjs');
  const uuid = '12345678-1234-1234-1234-123456789abc';
  const original = 'http://example.com/path?probe_nonce=abc';
  const blocked = `moz-extension://${uuid}/blocked.html?url=${encodeURIComponent(original)}`;
  assert.equal(reacquireContext([{ context: 'new', url: blocked }], uuid, original), 'new');
  assert.equal(reacquireContext([{ context: 'a', url: blocked }, { context: 'b', url: blocked }], uuid, original), null);
  assert.equal(reacquireContext([{ context: 'a', url: blocked.replace(uuid, '87654321-1234-1234-1234-123456789abc') }], uuid, original), null);
  assert.equal(reacquireContext([{ context: 'a', url: original + 'x' }], uuid, original), null);
  assert.equal(reacquireContext([{ context: 'a', url: original }], null, original), 'a');
});
