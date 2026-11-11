export const CONSENT_VERSION = 1;
export const REQUIRED_DATA = ['authenticationInfo', 'personallyIdentifyingInfo'];

async function storageCall(api, method, argument) {
  const storage = api?.storage?.local;
  if (!storage || typeof storage[method] !== 'function') throw new Error('Consent storage unavailable');
  if (typeof globalThis.chrome === 'undefined' || api !== globalThis.chrome || api === globalThis.browser) {
    return await storage[method](argument);
  }
  return await new Promise((resolve, reject) => {
    try {
      storage[method](argument, result => {
        const error = api.runtime?.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    } catch (error) { reject(error); }
  });
}

export async function getConsentState(api) {
  const permissions = api?.permissions?.getAll ? await api.permissions.getAll() : {};
  if (api?.runtime?.getURL?.('')?.startsWith('moz-extension://') &&
      Array.isArray(permissions?.permissions) && !permissions.permissions.includes('nativeMessaging')) {
    throw new Error('Native messaging permission unavailable');
  }
  const builtin = Array.isArray(permissions?.data_collection);
  const result = await storageCall(api, 'get', ['focus_data_consent']);
  const record = result?.focus_data_consent;
  const decision = record?.version === CONSENT_VERSION && ['accepted', 'declined'].includes(record.decision)
    ? record.decision : 'pending';
  return { decision, builtin };
}

export async function setConsentDecision(api, decision) {
  if (!['accepted', 'declined'].includes(decision)) throw new Error('Invalid consent decision');
  await storageCall(api, 'set', { focus_data_consent: { version: CONSENT_VERSION, decision } });
}
