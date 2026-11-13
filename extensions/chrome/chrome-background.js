import './background.js';

// The shared bootstrap opens consent on first install. This entry point adds
// a discoverable toolbar action without changing the signed Gecko payload.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage().catch(() => {});
});
