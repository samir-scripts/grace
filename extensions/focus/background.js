import { canonicalDomains, rulesForPolicy, isUrlBlocked } from './policy.js';
import { tryNativePairing } from './native-pairing.js';

let socket = null;
let currentRevision = 0;
let lastAckedRevision = 0;
let heartbeatTimer = null;
let reconnectTimer = null;

async function getSelfInfo() {
  if (typeof chrome !== 'undefined' && chrome.management && chrome.management.getSelf) {
    try {
      const info = await chrome.management.getSelf();
      return {
        install_type: info.installType || 'development',
        may_disable: info.mayDisable !== false
      };
    } catch {
      // Fallback
    }
  }
  return { install_type: 'development', may_disable: true };
}

function getBrowserKind() {
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getURL('').startsWith('moz-extension://')) {
    if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().includes('zen')) {
      return 'zen';
    }
    return 'firefox';
  }
  if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome')) {
    return 'safari';
  }
  return 'chrome';
}

async function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const { token, profile_id, port } = await chrome.storage.local.get(['token', 'profile_id', 'port']);
  if (!token || !profile_id) {
    console.log('[pomotroid-focus] Missing token or profile_id. Configure in extension options.');
    return;
  }

  const wsUrl = `ws://127.0.0.1:${port || 1421}/focus-browser`;
  try {
    socket = new WebSocket(wsUrl);
  } catch (e) {
    scheduleReconnect();
    return;
  }
  socket.onopen = async () => {
    console.log('[pomotroid-focus] Connected to desktop bridge.');
    const selfInfo = await getSelfInfo();
    const hello = {
      type: 'hello',
      version: 1,
      token,
      profile_id,
      browser: getBrowserKind(),
      install_type: selfInfo.install_type,
      may_disable: selfInfo.may_disable
    };
    socket.send(JSON.stringify(hello));
    startHeartbeat(profile_id);
  };

  socket.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'policy') {
        await applyPolicy(msg, profile_id);
      }
    } catch (err) {
      console.error('[pomotroid-focus] Failed to process server message:', err);
    }
  };

  socket.onclose = () => {
    console.log('[pomotroid-focus] Disconnected from desktop bridge.');
    stopHeartbeat();
    scheduleReconnect();
  };

  socket.onerror = (err) => {
    console.warn('[pomotroid-focus] Bridge connection error:', err);
    try { socket.close(); } catch {}
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
  }, 2000);
}

function startHeartbeat(profile_id) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const hb = {
        type: 'heartbeat',
        revision: currentRevision,
        profile_id
      };
      socket.send(JSON.stringify(hb));
    }
  }, 2000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function applyPolicy(policy, profile_id) {
  const { revision, active, domains } = policy;
  currentRevision = revision;

  try {
    if (active && domains && domains.length > 0) {
      const newRules = rulesForPolicy(domains);
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules.map(r => r.id);

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules: newRules
      });

      // Redirect any currently open tabs matching blocked domains
      if (chrome.tabs && chrome.tabs.query) {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.url && isUrlBlocked(tab.url, domains)) {
            const blockedUrl = chrome.runtime.getURL('blocked.html?url=' + encodeURIComponent(tab.url));
            chrome.tabs.update(tab.id, { url: blockedUrl }).catch(() => {});
          }
        }
      }
    } else {
      // Clear all rules
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules.map(r => r.id);
      if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds,
          addRules: []
        });
      }
    }

    lastAckedRevision = revision;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const ack = {
        type: 'ack',
        revision,
        profile_id
      };
      socket.send(JSON.stringify(ack));
    }
  } catch (err) {
    console.error('[pomotroid-focus] Failed to apply rules:', err);
    if (socket && socket.readyState === WebSocket.OPEN) {
      const errorMsg = {
        type: 'error',
        revision,
        profile_id,
        code: err.message || 'dnr_error'
      };
      socket.send(JSON.stringify(errorMsg));
    }
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'reconnect') {
    if (socket) {
      try { socket.close(); } catch {}
    }
    connect();
  }
});

// Automated bootstrap with native messaging pairing fallback to stored config
async function bootstrap() {
  const connectNative = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connectNative)
    ? chrome.runtime.connectNative.bind(chrome.runtime)
    : ((typeof browser !== 'undefined' && browser.runtime && browser.runtime.connectNative)
      ? browser.runtime.connectNative.bind(browser.runtime)
      : null);

  if (connectNative) {
    await tryNativePairing({
      connectNative,
      storage: chrome.storage.local,
      onPaired: () => {
        console.log('[pomotroid-focus] Paired automatically via native messaging.');
      }
    });
  }

  await connect();
}

bootstrap();
