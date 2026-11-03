const tokenInput = document.getElementById('token');
const profileIdInput = document.getElementById('profileId');
const saveBtn = document.getElementById('save');
const statusDiv = document.getElementById('status');
const autoBadge = document.getElementById('autoPairedBadge');

// Load stored values
chrome.storage.local.get(['token', 'profile_id', 'is_native_paired'], (items) => {
  if (items.is_native_paired && autoBadge) {
    autoBadge.style.display = 'block';
  }
  if (items.token) tokenInput.value = items.token;
  if (items.profile_id) {
    profileIdInput.value = items.profile_id;
  } else {
    // Generate default profile ID if absent
    profileIdInput.value = 'profile-' + Math.random().toString(36).substring(2, 9);
  }
});

saveBtn.addEventListener('click', () => {
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
  chrome.storage.local.get(['port'], (items) => {
    const port = items.port || 1421;
    chrome.storage.local.set({ token, profile_id, port }, () => {
      statusDiv.style.color = '#a6e3a1';
      statusDiv.textContent = 'Saved! Reconnecting to Pomotroid...';
      chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {});
    });
  });
});
