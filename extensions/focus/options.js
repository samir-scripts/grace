import { getConsentState } from './consent.js';
import { APPEARANCE_KEY, applyAppearance, fetchAppearance } from './appearance.js';

const tokenInput = document.getElementById('token');
const profileIdInput = document.getElementById('profileId');
const saveBtn = document.getElementById('save');
const statusDiv = document.getElementById('status');
const autoBadge = document.getElementById('autoPairedBadge');

const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser.storage)
  ? globalThis.browser
  : (typeof chrome !== 'undefined' ? chrome : null);

const advanced = document.getElementById('advanced');
const connectionStatus = document.getElementById('connectionStatus');
let pairingLoaded = false;

const consentStatus = document.getElementById('consentStatus');
const consentAccept = document.getElementById('consentAccept');
const consentDecline = document.getElementById('consentDecline');
const consentStop = document.getElementById('consentStop');
const consentUninstall = document.getElementById('consentUninstall');

async function refreshConsent() {
  const { decision } = await getConsentState(api);
  consentStatus.textContent = decision === 'accepted' ? 'Data sharing is enabled.' : 'Data sharing is disabled.';
  consentAccept.hidden = decision === 'accepted';
  consentDecline.hidden = decision === 'accepted';
  consentStop.hidden = decision !== 'accepted';
  advanced.hidden = decision !== 'accepted';
  if (decision === 'accepted' && !pairingLoaded) await loadPairing();
  if (decision !== 'accepted') { pairingLoaded = false; tokenInput.value = ''; profileIdInput.value = ''; autoBadge.hidden = true; }
  await refreshConnection(decision);
  return decision;
}

async function sendMessage(message) {
  if (!api?.runtime?.sendMessage) throw new Error('Background unavailable');
  if (api === globalThis.browser) return await api.runtime.sendMessage(message);
  return await new Promise((resolve, reject) => {
    api.runtime.sendMessage(message, result => {
      const error = api.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

consentAccept.addEventListener('click', async () => {
  try {
    const generation = await sendMessage({ type: 'consent:begin' });
    const result = await sendMessage({ type: 'consent:accept', generation });
    if (!result?.ok) throw new Error('Consent could not be saved');
    await refreshConsent();
  } catch { consentStatus.textContent = 'Could not save consent or connect. Try again.'; }
});
async function declineConsent() {
  try {
    const result = await sendMessage({ type: 'consent:stop' });
    if (!result?.ok) throw new Error('Consent could not be saved');
    await refreshConsent();
  } catch { consentStatus.textContent = 'Could not save your choice. Keep the extension disabled or uninstall it.'; }
}
consentDecline.addEventListener('click', declineConsent);
consentStop.addEventListener('click', declineConsent);
consentUninstall.addEventListener('click', async () => {
  try {
    if (!api?.management?.uninstallSelf) throw new Error('unavailable');
    await api.management.uninstallSelf({ showConfirmDialog: true });
  } catch { consentStatus.textContent = 'Uninstall was cancelled or unavailable. Use your browser’s add-on manager to remove the extension.'; }
});
refreshConsent().catch(() => {
  sendMessage({ type: 'consent:stop' }).catch(() => {});
  consentStatus.textContent = 'Consent status unavailable. Sharing is disabled.';
});

async function getStorage(keys) {
  if (!api || !api.storage || !api.storage.local) return {};
  try {
    const res = api.storage.local.get(keys);
    if (res && typeof res.then === 'function') {
      return await res;
    }
  } catch {}
  return new Promise((resolve) => {
    try {
      api.storage.local.get(keys, (items) => resolve(items || {}));
    } catch {
      resolve({});
    }
  });
}

async function setStorage(items) {
  if (!api?.storage?.local) throw new Error('Storage unavailable');
  if (api === globalThis.browser) return await api.storage.local.set(items);
  return await new Promise((resolve, reject) => {
    try {
      api.storage.local.set(items, () => {
        const error = api.runtime?.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    } catch (error) { reject(error); }
  });
}

async function loadPairing() {
  pairingLoaded = true;
  const items = await getStorage(['token', 'profile_id', 'is_native_paired']);
  autoBadge.hidden = !items.is_native_paired;
  tokenInput.value = items.token || '';
  profileIdInput.value = items.profile_id || '';
}

async function refreshConnection(decision) {
  let connected = false, connecting = false, unavailable = false;
  if (decision === 'accepted') {
    try {
      const state = await sendMessage({ type: 'connection:status' });
      connected = state?.connected === true;
      connecting = state?.connecting === true;
    } catch { unavailable = true; }
  }
  connectionStatus.textContent = unavailable ? 'Connection status unavailable' : connected ? 'Connected' : connecting ? 'Connecting…' : 'Disconnected';
  connectionStatus.dataset.connected = String(connected);
}

async function refreshAppearance() {
  if (document.hidden || !api?.runtime?.connectNative) return;
  const appearance = await fetchAppearance(api.runtime.connectNative.bind(api.runtime));
  if (appearance && applyAppearance(document, appearance)) {
    try { await setStorage({ [APPEARANCE_KEY]: appearance }); } catch {}
  }
}
(async () => {
  const cached = await getStorage([APPEARANCE_KEY]);
  applyAppearance(document, cached[APPEARANCE_KEY]);
  await refreshAppearance();
})();
window.addEventListener('focus', () => { refreshAppearance(); refreshConsent().catch(() => {}); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAppearance(); });
setInterval(() => { if (!document.hidden) { refreshAppearance(); refreshConsent().catch(() => {}); } }, 5000);

saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  const profile_id = profileIdInput.value.trim();
  if (!token) {
    statusDiv.style.color = 'var(--status-error)';
    statusDiv.textContent = 'Token cannot be empty.';
    return;
  }
  if (!profile_id) {
    statusDiv.style.color = 'var(--status-error)';
    statusDiv.textContent = 'Profile ID cannot be empty.';
    return;
  }
  try {
    const items = await getStorage(['port']);
    const port = items.port || 1421;
    await setStorage({ token, profile_id, port });
    const decision = await refreshConsent();
    statusDiv.style.color = 'var(--status-success)';
    statusDiv.textContent = decision === 'accepted' ? 'Saved! Reconnecting to grace...' : 'Saved locally. Accept data sharing to connect.';
    if (decision === 'accepted') await sendMessage({ type: 'reconnect' });
  } catch {
    statusDiv.textContent = 'Could not determine consent. Sharing is disabled.';
  }
});
