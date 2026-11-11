import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDomains, rulesForPolicy, isUrlBlocked } from '../focus/policy.js';

test('canonicalDomains deduplicates, lowercases and trims', () => {
  const input = ['  REDDIT.COM ', 'reddit.com', 'https://youtube.com/watch', 'discord.gg/invite'];
  const output = canonicalDomains(input);
  assert.deepEqual(output, ['discord.gg', 'reddit.com', 'youtube.com']);
});

test('rulesForPolicy produces declarativeNetRequest rules with hostname boundary', () => {
  const rules = rulesForPolicy(['reddit.com', 'youtube.com']);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], {
    id: 1,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||reddit.com^',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'websocket']
    }
  });
  assert.deepEqual(rules[1], {
    id: 2,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||youtube.com^',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'websocket']
    }
  });
});

test('isUrlBlocked matches apex and subdomains only', () => {
  const domains = ['reddit.com'];
  assert.equal(isUrlBlocked('https://reddit.com/r/all', domains), true);
  assert.equal(isUrlBlocked('https://old.reddit.com/r/all', domains), true);
  assert.equal(isUrlBlocked('https://notreddit.com/', domains), false);
  assert.equal(isUrlBlocked('https://example.com/?q=reddit.com', domains), false);
  assert.equal(isUrlBlocked('https://reddit.com.evil.com/', domains), false);
});

test('common blocked sites match hostnames, not lookalikes or query text', () => {
  const domains = ['youtube.com', 'instagram.com', 'reddit.com'];
  for (const url of [
    'https://YOUTUBE.COM/watch?v=123',
    'https://www.instagram.com/reels/?q=1',
    'https://old.reddit.com/r/all?sort=new'
  ]) {
    assert.equal(isUrlBlocked(url, domains), true, url);
  }
  for (const url of [
    'https://notyoutube.com/',
    'https://instagram.com.evil.com/',
    'https://example.com/?next=https://reddit.com/r/all'
  ]) {
    assert.equal(isUrlBlocked(url, domains), false, url);
  }
});
