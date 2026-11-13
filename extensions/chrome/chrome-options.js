import { getConsentState } from './consent.js';
import { probeNativeHost, connectionGuidance } from './chrome-diagnostics.js';

const help = document.createElement('p');
help.id = 'chromeConnectionHelp';
help.className = 'consent-status';
help.setAttribute('role', 'status');
help.setAttribute('aria-live', 'polite');
document.getElementById('consentStatus').after(help);
let generation = 0, controller;
let sharingStopped = false, acceptanceRequested = false;

function stopDiagnostics() {
  sharingStopped = true;
  acceptanceRequested = false;
  generation++;
  controller?.abort();
  help.textContent = '';
}

// Withdrawal takes effect before the shared page attempts to persist it.
for (const id of ['consentStop', 'consentDecline']) {
  document.getElementById(id).addEventListener('click', stopDiagnostics, { capture: true });
}
document.getElementById('consentAccept').addEventListener('click', () => {
  acceptanceRequested = true;
}, { capture: true });
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'consent:stop') stopDiagnostics();
  if (message?.type === 'consent:accept') acceptanceRequested = true;
});

async function refresh() {
  if (sharingStopped) return;
  const current = ++generation;
  controller?.abort();
  const attempt = new AbortController();
  controller = attempt;
  try {
    const { decision } = await getConsentState(chrome);
    if (current !== generation || decision !== 'accepted' || document.hidden) {
      if (current === generation) help.textContent = '';
      return;
    }
    const state = await chrome.runtime.sendMessage({ type: 'connection:status' });
    if (current !== generation) return;
    if (state?.connected === true) {
      help.textContent = connectionGuidance('ready', true);
      return;
    }
    const nativeStatus = await probeNativeHost(chrome.runtime.connectNative.bind(chrome.runtime), attempt.signal);
    if (current !== generation || attempt.signal.aborted) return;
    // Consent may have changed while the native host was responding.
    const consent = await getConsentState(chrome);
    if (current === generation && consent.decision === 'accepted') help.textContent = connectionGuidance(nativeStatus);
  } catch {
    if (current === generation && !attempt.signal.aborted) help.textContent = 'Connection details unavailable. Reopen Grace and this page to retry.';
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.focus_data_consent) return;
  if (changes.focus_data_consent.newValue?.decision !== 'accepted') {
    stopDiagnostics();
    return;
  }
  // Ignore an old accepted write arriving after withdrawal. A new acceptance
  // request and its successful persisted decision are both required to resume.
  if (sharingStopped && !acceptanceRequested) return;
  sharingStopped = false;
  acceptanceRequested = false;
  refresh();
});
window.addEventListener('focus', refresh);
document.addEventListener('visibilitychange', refresh);
window.addEventListener('pagehide', () => { generation++; controller?.abort(); });
setInterval(refresh, 5000);
refresh();
