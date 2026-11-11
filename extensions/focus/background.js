import { rulesForPolicy, isUrlBlocked } from './policy.js';
import { tryNativePairing } from './native-pairing.js';
import { createClientAuth } from './bridge-auth.js';
import { getConsentState, setConsentDecision, REQUIRED_DATA } from './consent.js';

const api = (typeof globalThis.browser !== 'undefined' && globalThis.browser.runtime)
  ? globalThis.browser
  : (typeof globalThis.chrome !== 'undefined' ? globalThis.chrome : null);

let socket = null;
let connectionContext = null;
let reconnectTimer = null;
let consentGranted = false;
let consentStopped = false;
let consentGeneration = 0;
let pairingController = null;
let optionsOpened = false;
// DNR operations already in flight cannot be cancelled. A replacement policy
// must run after them, even when it belongs to a different socket generation.
let policyQueue = Promise.resolve();
let consentQueue = Promise.resolve();

function persistConsent(decision, generation) {
  const pending = consentQueue.then(async () => {
    if (decision === 'accepted' && generation !== consentGeneration) return false;
    await setConsentDecision(api, decision);
    if (decision === 'accepted' && generation === consentGeneration) {
      consentStopped = false;
      bootstrap();
      return true;
    }
    return decision === 'declined';
  });
  consentQueue = pending.catch(() => {});
  return pending;
}

const diagnostic = (event, details = {}) => console.debug('[pomotroid-focus]', event, details);

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



function ownsConnection(context) {
  return consentGranted && context.active && socket === context.connection;
}

function retireConnection(context, reconnect = true) {
  if (!context.active) return;
  const current = socket === context.connection;
  context.active = false;
  clearTimeout(context.deadline);
  clearInterval(context.heartbeat);
  context.deadline = null;
  context.heartbeat = null;
  if (current) {
    socket = null;
    connectionContext = null;
    if (reconnect) scheduleReconnect();
  }
}

function closeConnection(context, reconnect = true) {
  retireConnection(context, reconnect);
  try { context.connection.close(); } catch {}
}

function stopSharing() {
  consentGeneration++;
  consentStopped = true;
  consentGranted = false;
  pairingController?.abort();
  pairingController = null;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (connectionContext) closeConnection(connectionContext, false);
}

function authenticationFailed(context, reason) {
  if (!ownsConnection(context)) return;
  diagnostic('authentication_failed', { reason });
  closeConnection(context);
}

function authenticationDeadline(context, reason) {
  clearTimeout(context.deadline);
  context.deadline = setTimeout(() => authenticationFailed(context, reason), 5000);
}

async function connect() {
  const generation = consentGeneration;
  if (!consentGranted) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const { token, profile_id, port } = await getStorage(['token', 'profile_id', 'port']);
  if (!consentGranted || generation !== consentGeneration) return;
  diagnostic('credentials_checked', { token_present: !!token, profile_present: !!profile_id, port: port || 1421 });
  if (!token || !profile_id) {
    console.log('[pomotroid-focus] Missing token or profile_id. Configure in extension options.');
    return;
  }
  
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const wsUrl = `ws://127.0.0.1:${port || 1421}/focus-browser`;
  diagnostic('socket_connecting', { port: port || 1421 });
  let connection;
  try {
    connection = new WebSocket(wsUrl);
  } catch {
    scheduleReconnect();
    return;
  }
  if (connectionContext) retireConnection(connectionContext, false);
  socket = connection;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const context = {
    connection, profile_id, active: true, established: false, phase: 'opening',
    auth: null, deadline: null, heartbeat: null, lastAckedRevision: 0,
    receiveQueue: Promise.resolve(), sendQueue: Promise.resolve()
  };
  connectionContext = context;

  connection.onopen = async () => {
    if (!ownsConnection(context)) return;
    diagnostic('socket_open');
    authenticationDeadline(context, 'challenge_timeout');
    try {
      context.auth = createClientAuth(token, [profile_id]);
      context.phase = 'challenge';
      connection.send(JSON.stringify(context.auth.init()));
      diagnostic('auth_init_sent', { version: 3 });
    } catch {
      authenticationFailed(context, 'auth_unavailable');
    }
  };

  connection.onmessage = (event) => {
    if (!ownsConnection(context)) return;
    context.receiveQueue = context.receiveQueue.then(async () => {
      if (!ownsConnection(context)) return;
      if (context.phase === 'challenge') {
        const response = await context.auth.acceptChallenge(JSON.parse(event.data));
        if (!ownsConnection(context)) return;
        connection.send(JSON.stringify(response));
        context.phase = 'policy';
        authenticationDeadline(context, 'first_policy_timeout');
        diagnostic('server_authenticated', { version: 3 });
        return;
      }
      if (context.phase !== 'policy' && context.phase !== 'established') throw new Error('unexpected_message');
      const msg = await context.auth.decode(event.data);
      if (!ownsConnection(context)) return;
      if (!context.established) {
        context.established = true;
        context.phase = 'established';
        clearTimeout(context.deadline);
        context.deadline = null;
        // ACKs and DNR errors for this very first policy must be sendable.
        startHeartbeat(context);
        diagnostic('authentication_succeeded', { version: 3 });
      }
      if (msg.type === 'policy') {
        diagnostic('policy_received', { revision: msg.revision, active: msg.active, domain_count: msg.domains?.length || 0 });
        policyQueue = policyQueue.then(() => applyPolicy(msg, context));
        await policyQueue;
      }
    }).catch(() => authenticationFailed(context, context.established ? 'invalid_frame' : 'invalid_handshake'));
    return context.receiveQueue;
  };

  connection.onclose = (event) => {
    if (!ownsConnection(context)) return;
    diagnostic('socket_closed', { code: event.code, wasClean: event.wasClean });
    retireConnection(context);
  };

  connection.onerror = () => {
    if (!ownsConnection(context)) return;
    diagnostic('socket_error');
    closeConnection(context);
  };
}

function scheduleReconnect() {
  if (!consentGranted) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

function sendAuthenticated(context, payload) {
  context.sendQueue = context.sendQueue.then(async () => {
    if (!ownsConnection(context) || !context.established || context.connection.readyState !== WebSocket.OPEN) return;
    const wire = await context.auth.encode(payload);
    if (!ownsConnection(context) || context.connection.readyState !== WebSocket.OPEN) return;
    context.connection.send(wire);
    if (payload.type === 'ack') diagnostic('ack_sent', { revision: payload.revision });
    if (payload.type === 'heartbeat') diagnostic('heartbeat_sent', { revision: payload.revision });
  }).catch(() => authenticationFailed(context, 'send_failed'));
  return context.sendQueue;
}

function startHeartbeat(context) {
  clearInterval(context.heartbeat);
  context.heartbeat = setInterval(() => {
    if (!ownsConnection(context) || !context.established) return;
    sendAuthenticated(context, {
      type: 'heartbeat', revision: context.lastAckedRevision, profile_id: context.profile_id
    });
  }, 2000);
}

async function applyPolicy(policy, context) {
  if (!ownsConnection(context)) return;
  const { revision, active, domains } = policy;
  let stage = 'get_rules';
  try {
    const newRules = active && domains && domains.length > 0 ? rulesForPolicy(domains) : [];
    const existingRules = await api.declarativeNetRequest.getDynamicRules();
    if (!ownsConnection(context)) return;
    const removeRuleIds = existingRules.map(r => r.id);
    if (newRules.length > 0 || removeRuleIds.length > 0) {
      stage = 'update_rules';
      // Recheck ownership directly before every mutation, not only after decode.
      if (!ownsConnection(context)) return;
      await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: newRules });
      if (!ownsConnection(context)) return;
    }
    diagnostic('rules_applied', { revision, rule_count: newRules.length });

    if (newRules.length > 0 && api.tabs && api.tabs.query) {
      stage = 'query_tabs';
      const tabs = await api.tabs.query({});
      if (!ownsConnection(context)) return;
      for (const tab of tabs) {
        if (!ownsConnection(context)) return;
        if (tab.url && isUrlBlocked(tab.url, domains) && api.tabs.update) {
          const blockedUrl = api.runtime.getURL('blocked.html?url=' + encodeURIComponent(tab.url));
          try {
            await api.tabs.update(tab.id, { url: blockedUrl });
          } catch {}
        }
      }
    }

    if (!ownsConnection(context)) return;
    context.lastAckedRevision = revision;
    await sendAuthenticated(context, { type: 'ack', revision, profile_id: context.profile_id });
  } catch {
    if (!ownsConnection(context)) return;
    diagnostic('policy_failed', { revision, stage });
    closeConnection(context);
  }
}

if (api && api.runtime && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'connection:status') {
      respond?.({
        connected: Boolean(connectionContext?.active && connectionContext?.established),
        connecting: Boolean(connectionContext?.active && !connectionContext?.established),
      });
      return false;
    }
    if (msg.type === 'consent:begin') respond(consentGeneration);
    if (msg.type === 'consent:stop') {
      stopSharing();
      persistConsent('declined', consentGeneration)
        .then(() => respond?.({ ok: true }), () => respond?.({ ok: false }));
      return true;
    }
    if (msg.type === 'consent:accept') {
      persistConsent('accepted', msg.generation)
        .then(ok => respond?.({ ok }), () => respond?.({ ok: false }));
      return true;
    }
    if (msg.type === 'reconnect' && consentGranted) {
      if (connectionContext) closeConnection(connectionContext, false);
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      connect();
    }
  });
}

if (api?.storage?.onChanged) api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.focus_data_consent) return;
  if (changes.focus_data_consent.newValue?.decision !== 'accepted') stopSharing();
});
if (api?.permissions?.onRemoved) api.permissions.onRemoved.addListener((removed) => {
  if (removed.permissions?.includes('nativeMessaging') || removed.data_collection?.some(type => REQUIRED_DATA.includes(type))) {
    stopSharing();
    persistConsent('declined', consentGeneration).catch(() => {
      diagnostic('consent_persistence_failed');
      if (api.runtime?.openOptionsPage) Promise.resolve(api.runtime.openOptionsPage()).catch(() => {});
    });
  }
});

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
  const generation = consentGeneration;
  let state;
  try {
    state = await getConsentState(api);
  } catch {
    stopSharing();
    diagnostic('consent_unavailable');
    return;
  }
  if (generation !== consentGeneration || consentStopped) return;
  if (state.decision !== 'accepted') {
    if (state.decision === 'pending' && !optionsOpened && api?.runtime?.openOptionsPage) {
      optionsOpened = true;
      try { await api.runtime.openOptionsPage(); } catch {}
    }
    return;
  }
  consentGranted = true;
  diagnostic('bootstrap');
  if (api?.runtime?.connectNative && !pairingController) {
    const controller = new AbortController();
    pairingController = controller;
    const paired = await tryNativePairing({
      connectNative: api.runtime.connectNative.bind(api.runtime),
      storage: api.storage?.local,
      signal: controller.signal,
      keepOpen: true,
      onPortClosed: () => {
        if (pairingController === controller) pairingController = null;
      },
      onDiagnostic: ({ event, ...details }) => diagnostic(event, details),
    });
    if (!paired && pairingController === controller) pairingController = null;
  }
  if (consentGranted && generation === consentGeneration) await connect();
}

bootstrap();
