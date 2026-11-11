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
  if (!storage || typeof storage.set !== 'function') {
    throw new Error('storage.set is not a function');
  }
  let res;
  let promiseAttempted = false;
  try {
    res = storage.set(items);
    if (res && typeof res.then === 'function') {
      promiseAttempted = true;
      return await res;
    }
  } catch (err) {
    if (promiseAttempted) throw err;
  }
  return new Promise((resolve, reject) => {
    try {
      storage.set(items, () => {
        const lastErr = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError)
          ? chrome.runtime.lastError
          : null;
        if (lastErr) reject(lastErr);
        else resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

export async function tryNativePairing({ connectNative, storage, onPaired, onDiagnostic = () => {}, signal, keepOpen = false, onPortClosed = () => {} }) {
  if (!connectNative || signal?.aborted) return false;

  return new Promise((resolve) => {
    let port;
    let settled = false;
    let retained = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      retained = value && keepOpen;
      if (!value || !keepOpen) {
        signal?.removeEventListener('abort', abort);
        try { port?.disconnect?.(); } catch {}
      }
      resolve(value);
    };
    const abort = () => {
      if (!settled) finish(false);
      else {
        signal?.removeEventListener('abort', abort);
        try { port?.disconnect?.(); } catch {}
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    onDiagnostic({ event: 'native_attempt' });
    try {
      port = connectNative('com.splode.pomotroid');
      if (signal?.aborted) { finish(false); return; }
      port.onMessage.addListener(async (msg) => {
        if (settled || signal?.aborted || !msg || msg.type !== 'config' || !msg.token) return;
        onDiagnostic({ event: 'native_config_received', token_present: true, port: msg.port || 1421 });
        try {
          const items = await getStorage(storage, ['profile_id']);
          if (settled || signal?.aborted) return;
          const profile_id = items?.profile_id || ('profile-' + Math.random().toString(36).substring(2, 9));
          await setStorage(storage, { token: msg.token, port: msg.port || 1421, profile_id, is_native_paired: true });
          if (settled || signal?.aborted) return;
          onDiagnostic({ event: 'native_paired' });
          if (onPaired) onPaired({ token: msg.token, port: msg.port || 1421, profile_id });
          finish(true);
        } catch {
          if (!settled) onDiagnostic({ event: 'native_failed', reason: 'storage_write_failed' });
          finish(false);
        }
      });
      port.onDisconnect.addListener(() => {
        if (settled) {
          signal?.removeEventListener('abort', abort);
          if (retained) onPortClosed();
          return;
        }
        const error = port.error || (typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null);
        const message = error?.message || '';
        const reason = message.includes('No such native application') ? 'host_not_found'
          : message.includes('does not have permission') ? 'host_forbidden'
          : message.includes('does not exist') || message.includes('not executable') ? 'host_not_executable'
          : 'native_disconnected';
        onDiagnostic({ event: 'native_failed', reason });
        finish(false);
      });
      if (signal?.aborted) { finish(false); return; }
      port.postMessage({ type: 'connect' });
    } catch {
      if (!settled) onDiagnostic({ event: 'native_failed', reason: 'native_connect_failed' });
      finish(false);
    }
  });
}
