export async function tryNativePairing({ connectNative, storage, onPaired }) {
  if (!connectNative) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      const port = connectNative('com.splode.pomotroid');
      let resolved = false;

      port.onMessage.addListener((msg) => {
        if (msg && msg.type === 'config' && msg.token) {
          storage.get(['profile_id'], (items) => {
            const profile_id = (items && items.profile_id)
              ? items.profile_id
              : ('profile-' + Math.random().toString(36).substring(2, 9));

            storage.set({
              token: msg.token,
              port: msg.port || 1421,
              profile_id,
              is_native_paired: true
            }, () => {
              resolved = true;
              if (onPaired) {
                onPaired({ token: msg.token, port: msg.port || 1421, profile_id });
              }
              resolve(true);
            });
          });
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
