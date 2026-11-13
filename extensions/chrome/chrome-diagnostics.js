// Keep diagnostics separate from pairing. Never return or display credentials.
export function probeNativeHost(connectNative, signal) {
  if (signal?.aborted) return Promise.resolve('unavailable');
  return new Promise(resolve => {
    let port, timer, finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try { port?.disconnect(); } catch {}
      resolve(result);
    };
    const abort = () => finish('unavailable');
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish('unavailable'), 2000);
    try {
      port = connectNative('com.splode.pomotroid');
      port.onMessage.addListener(message => {
        if (message?.type !== 'config') return finish('unavailable');
        finish(message.protocol_version === 3 ? 'ready' : 'incompatible');
      });
      port.onDisconnect.addListener(() => {
        // Read lastError inside the callback to avoid an unchecked error warning.
        const error = port.error || globalThis.chrome?.runtime?.lastError;
        const message = error?.message ?? '';
        finish(/not found|No such native application|not registered/i.test(message) ? 'missing' : 'unavailable');
      });
      port.postMessage({ type: 'connect' });
    } catch { finish('unavailable'); }
  });
}

export function connectionGuidance(nativeStatus, connected = false) {
  if (connected) return 'Connected. Assign this profile in Grace Settings → Sessions before starting website blocking.';
  if (nativeStatus === 'missing') return 'Grace’s browser connection is not installed. Open Grace Settings → Sessions and select Install Chrome Companion, then reopen this page.';
  if (nativeStatus === 'incompatible') return 'Update Grace and this companion to compatible versions using protocol 3, then select Install Chrome Companion in Grace to refresh the browser connection.';
  if (nativeStatus === 'ready') return 'Disconnected. Keep Grace running, check the profile assignment in Settings → Sessions, and retry. The native host supports protocol 3; the focus connection is not authenticated yet.';
  return 'Grace’s browser connection is unavailable. Open Grace and select Install Chrome Companion in Settings → Sessions to repair it, then retry. Keep pairing tokens private.';
}
