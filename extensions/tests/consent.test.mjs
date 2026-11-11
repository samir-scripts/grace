import test from 'node:test';
import assert from 'node:assert/strict';
import { getConsentState, setConsentDecision } from '../focus/consent.js';

function api(initial = {}, permissions = {}) {
  const values = { ...initial };
  return {
    values,
    storage: { local: {
      get: async keys => Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]])),
      set: async changes => Object.assign(values, changes),
    } },
    permissions: { getAll: async () => permissions },
  };
}

test('stored credentials do not grant consent; explicit choice persists', async () => {
  const browser = api({ token: 'secret', profile_id: 'profile' }, { data_collection: [] });
  assert.deepEqual(await getConsentState(browser), { decision: 'pending', builtin: true });
  await setConsentDecision(browser, 'accepted');
  assert.deepEqual(await getConsentState(browser), { decision: 'accepted', builtin: true });
  await setConsentDecision(browser, 'declined');
  assert.deepEqual(await getConsentState(browser), { decision: 'declined', builtin: true });
});

test('old or malformed consent records require fresh consent on legacy browser', async () => {
  for (const record of [{ version: 0, decision: 'accepted' }, { version: 1, decision: 'unknown' }, null]) {
    const browser = api({ focus_data_consent: record });
    assert.deepEqual(await getConsentState(browser), { decision: 'pending', builtin: false });
  }
});

test('permission and storage errors do not grant or persist consent', async () => {
  const browser = api();
  browser.permissions.getAll = async () => { throw new Error('unavailable'); };
  await assert.rejects(getConsentState(browser));
  browser.storage.local.set = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(setConsentDecision(browser, 'accepted'));
  assert.equal(browser.values.focus_data_consent, undefined);
});

test('a revoked Gecko native messaging permission cannot reuse saved consent', async () => {
  const browser = api({ focus_data_consent: { version: 1, decision: 'accepted' } }, {
    permissions: [], data_collection: [],
  });
  browser.runtime = { getURL: () => 'moz-extension://test/' };
  await assert.rejects(getConsentState(browser), /native messaging/i);
});

test('legacy Gecko without data collection API requires and persists explicit consent', async () => {
  const browser = api({ token: 'stored-token', profile_id: 'stored-profile' }, { permissions: ['nativeMessaging', 'storage'] });
  browser.runtime = { getURL: () => 'moz-extension://test/' };
  assert.deepEqual(await getConsentState(browser), { decision: 'pending', builtin: false });
  await setConsentDecision(browser, 'accepted');
  assert.deepEqual(await getConsentState(browser), { decision: 'accepted', builtin: false });
  await setConsentDecision(browser, 'declined');
  assert.deepEqual(await getConsentState(browser), { decision: 'declined', builtin: false });
});
