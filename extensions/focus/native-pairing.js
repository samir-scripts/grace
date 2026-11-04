async function getStorage(storage, keys) {
  if (!storage || typeof storage.get !== 'function') return {};
  try {
    const res = storage.get(keys);
    if (res && typeof res.then === 'function') {
      return await res;
    }
  } catch {}
  return new Promise((resolve) => {
    try {
      storage.get(keys, (items) => resolve(items || {}));
    } catch {
      resolve({});
    }
  });
}

async function setStorage(storage, items) {
  if (!storage || typeof storage.set !== 'function') return;
  try {
    const res = storage.set(items);
    if (res && typeof res.then === 'function') {
      return await res;
    }
  } catch {}
  return new Promise((resolve) => {
    try {
      storage.set(items, () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function tryNativePairing({ connectNative, storage, onPaired }) {
  if (!connectNative) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      const port = connectNative('com.splode.pomotroid');
      let resolved = false;

      port.onMessage.addListener(async (msg) => {
        if (msg && msg.type === 'config' && msg.token) {
          try {
            const items = await getStorage(storage, ['profile_id']);
            const profile_id = (items && items.profile_id)
              ? items.profile_id
              : ('profile-' + Math.random().toString(36).substring(2, 9));

            await setStorage(storage, {
              token: msg.token,
              port: msg.port || 1421,
              profile_id,
              is_native_paired: true
            });

            resolved = true;
            if (onPaired) {
              onPaired({ token: msg.token, port: msg.port || 1421, profile_id });
            }
            resolve(true);
          } catch {
            if (!resolved) resolve(false);
          }
        }
      });

      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolve(false);
        }
      });

      port.postMessage({ type: 'connect' });
    } catch (e) {
      resolve(false);
    }
  });
}
