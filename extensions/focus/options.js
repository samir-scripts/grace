const tokenInput = document.getElementById('token');
const profileIdInput = document.getElementById('profileId');
const saveBtn = document.getElementById('save');
const statusDiv = document.getElementById('status');
const autoBadge = document.getElementById('autoPairedBadge');

const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser.storage)
  ? globalThis.browser
  : (typeof chrome !== 'undefined' ? chrome : null);

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
  if (!api || !api.storage || !api.storage.local) return;
  try {
    const res = api.storage.local.set(items);
    if (res && typeof res.then === 'function') {
      return await res;
    }
  } catch {}
  return new Promise((resolve) => {
    try {
      api.storage.local.set(items, () => resolve());
    } catch {
      resolve();
    }
  });
}

// Load stored values
(async () => {
  const items = await getStorage(['token', 'profile_id', 'is_native_paired']);
  if (items.is_native_paired && autoBadge) {
    autoBadge.style.display = 'block';
  }
  if (items.token) tokenInput.value = items.token;
  if (items.profile_id) {
    profileIdInput.value = items.profile_id;
  } else {
    profileIdInput.value = 'profile-' + Math.random().toString(36).substring(2, 9);
  }
})();

saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  const profile_id = profileIdInput.value.trim();
  if (!token) {
    statusDiv.style.color = '#f38ba8';
    statusDiv.textContent = 'Token cannot be empty.';
    return;
  }
  if (!profile_id) {
    statusDiv.style.color = '#f38ba8';
    statusDiv.textContent = 'Profile ID cannot be empty.';
    return;
  }
  const items = await getStorage(['port']);
  const port = items.port || 1421;
  await setStorage({ token, profile_id, port });
  statusDiv.style.color = '#a6e3a1';
  statusDiv.textContent = 'Saved! Reconnecting to Pomotroid...';
  if (api && api.runtime && api.runtime.sendMessage) {
    try {
      const res = api.runtime.sendMessage({ type: 'reconnect' });
      if (res && typeof res.catch === 'function') res.catch(() => {});
    } catch {}
  }
});
