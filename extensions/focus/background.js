import { canonicalDomains, rulesForPolicy, isUrlBlocked } from './policy.js';
import { tryNativePairing } from './native-pairing.js';

const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser.runtime)
  ? globalThis.browser
  : (typeof globalThis.chrome !== 'undefined' ? globalThis.chrome : null);

let socket = null;
let currentRevision = 0;
let lastAckedRevision = 0;
let heartbeatTimer = null;
let reconnectTimer = null;

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

async function getSelfInfo() {
  if (api && api.management && api.management.getSelf) {
    try {
      const info = await api.management.getSelf();
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
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('zen')) {
        return 'zen';
      }
    }
    if (typeof navigator !== 'undefined' && navigator.userAgentData && navigator.userAgentData.brands) {
      if (navigator.userAgentData.brands.some(b => b.brand && b.brand.toLowerCase().includes('zen'))) {
        return 'zen';
      }
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

  const { token, profile_id, port } = await getStorage(['token', 'profile_id', 'port']);
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
        revision: lastAckedRevision,
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
  try {
    if (active && domains && domains.length > 0) {
      const newRules = rulesForPolicy(domains);
      const existingRules = await api.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules.map(r => r.id);

      await api.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules: newRules
      });

      // Redirect any currently open tabs matching blocked domains
      if (api.tabs && api.tabs.query) {
        const tabs = await api.tabs.query({});
        for (const tab of tabs) {
          if (tab.url && isUrlBlocked(tab.url, domains)) {
            const blockedUrl = api.runtime.getURL('blocked.html?url=' + encodeURIComponent(tab.url));
            if (api.tabs.update) {
              try {
                const res = api.tabs.update(tab.id, { url: blockedUrl });
                if (res && typeof res.catch === 'function') res.catch(() => {});
              } catch {}
            }
          }
        }
      }
    } else {
      // Clear all rules
      const existingRules = await api.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules.map(r => r.id);
      if (removeRuleIds.length > 0) {
        await api.declarativeNetRequest.updateDynamicRules({
          removeRuleIds,
          addRules: []
        });
      }
    }

    currentRevision = revision;
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
        code: (err && err.message) ? err.message : 'dnr_error'
      };
      socket.send(JSON.stringify(errorMsg));
    }
  }
}

if (api && api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'reconnect') {
      if (socket) {
        try { socket.close(); } catch {}
      }
      connect();
    }
  });
}

if (api?.runtime?.onStartup) api.runtime.onStartup.addListener(() => { bootstrap(); });
if (api?.runtime?.onInstalled) api.runtime.onInstalled.addListener(() => { bootstrap(); });
if (api?.alarms) {
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'pomotroid-reconnect') connect();
  });
  api.alarms.create('pomotroid-reconnect', { periodInMinutes: 1 });
}
if (api?.tabs?.onActivated) api.tabs.onActivated.addListener(() => { connect(); });

// Automated bootstrap with native messaging pairing fallback to stored config
async function bootstrap() {
  const connectNative = (api && api.runtime && api.runtime.connectNative)
    ? api.runtime.connectNative.bind(api.runtime)
    : null;

  if (connectNative) {
    await tryNativePairing({
      connectNative,
      storage: api.storage ? api.storage.local : null,
      onPaired: () => {
        console.log('[pomotroid-focus] Paired automatically via native messaging.');
      }
    });
  }

  await connect();
}

bootstrap();
