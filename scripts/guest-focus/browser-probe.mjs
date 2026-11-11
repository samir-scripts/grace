import { homedir } from 'node:os';
import { readFile, readdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

const root = '/Users/admin/grace-acceptance';
const defaultTargets = {
  blocked: ['https://example.com/', 'https://youtube.com/', 'https://www.youtube.com/',
    'https://instagram.com/', 'https://m.instagram.com/', 'https://reddit.com/', 'https://old.reddit.com/'],
  allowed: ['https://example.org/', 'https://example.org/?next=https://reddit.com/r/all']
};

export function normalizeTargets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'allowed,blocked' || !Array.isArray(value.blocked) || !Array.isArray(value.allowed) || value.blocked.length + value.allowed.length > 256 || value.blocked.length + value.allowed.length === 0) throw Error('invalid target lists');
  const normalize = list => list.map(raw => {
    if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw)) throw Error('target must be an HTTP(S) URL');
    const url = new URL(raw);
    const host = url.hostname;
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isIP(host) || host === 'localhost' || host.endsWith('.localhost') || host.length > 253 || !host.includes('.') || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw Error('invalid public target host');
    return url.href;
  });
  const result = { blocked: normalize(value.blocked), allowed: normalize(value.allowed) };
  if (new Set([...result.blocked, ...result.allowed]).size !== result.blocked.length + result.allowed.length) throw Error('duplicate target URL');
  return result;
}


export function targetSetHash(targets) {
  return createHash('sha256').update(JSON.stringify(normalizeTargets(targets))).digest('hex');
}

export function targetKey(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete('probe_nonce');
  return parsed.href;
}

export function classifyExisting(url, uuid, original, ack) {
  try {
    const page = new URL(url);
    if (ack && uuid && page.protocol === 'moz-extension:' && page.hostname === uuid && page.pathname === '/blocked.html' && page.searchParams.get('url') === original) return 'blocked-existing';
  } catch {}
  return 'inconclusive';
}

export function reacquireContext(contexts, uuid, original) {
  const matches = contexts.filter(item => typeof item.context === 'string' &&
    (item.url === original || (uuid && classifyExisting(item.url, uuid, original, true) === 'blocked-existing')));
  return matches.length === 1 ? matches[0].context : null;
}

export function classify(phase, baselineLoaded, observation, ack, target, mode = 'public') {
  const loaded = !observation.error && typeof observation.title === 'string' && observation.title.trim() &&
    typeof observation.url === 'string' && /^https?:\/\//i.test(observation.url) && observation.sameHost &&
    (mode !== 'controlled' || observation.markerMatched === true);
  if (phase === 'work' && !baselineLoaded) return 'inconclusive';
  if (phase === 'work' && target) {
    if (!ack) return 'inconclusive';
    if (/\bNS_ERROR_ABORT\b/.test(observation.error || '') && (mode !== 'controlled' || observation.proxyRequested === false)) return 'blocked-observed';
    return loaded ? 'loaded' : 'inconclusive';
  }
  return loaded ? 'loaded' : 'inconclusive';
}

export function activeAck(text, freshOffset = 0) {
  const connections = new Map();
  let position = 0;
  for (const line of text.split('\n')) {
    const fresh = position >= freshOffset;
    position += Buffer.byteLength(line) + 1;
    let m;
    if ((m = line.match(/hello_accepted connection=([0-9a-f-]+) version=3\b/))) connections.set(m[1], {});
    else if ((m = line.match(/policy_sent connection=([0-9a-f-]+) revision=(\d+) active=(true|false)\b/))) {
      if (connections.has(m[1])) connections.set(m[1], { revision: m[2], active: fresh && m[3] === 'true', ack: false });
    } else if ((m = line.match(/ack_received connection=([0-9a-f-]+) revision=(\d+)\b/))) {
      const state = connections.get(m[1]);
      if (state?.active && state.revision === m[2]) state.ack = true;
      else if (state && BigInt(m[2]) > BigInt(state.revision || 0)) state.active = false;
    } else if ((m = line.match(/(?:socket_closed|authentication_failed) connection=([0-9a-f-]+)/))) connections.delete(m[1]);
    else if (/\b(?:apply_failed|lease_failed|policy_released)\b/.test(line)) connections.clear();
    else if ((m = line.match(/policy_sent revision=(\d+) participants=(\d+)/))) {
      for (const connection of connections.keys()) connections.set(connection, { revision: m[1], active: fresh && Number(m[2]) > 0, ack: false });
    }
  }
  for (const [connection, state] of connections) if (state.active && state.ack) return { connection, revision: state.revision };
  return null;
}

async function owned(path, directory = false) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || info.uid !== process.getuid() || (directory ? !info.isDirectory() : !info.isFile()) || await realpath(path) !== path) throw Error(`unsafe path: ${path}`);
  return info;
}

function parseArgs(args) {
  if (args.length % 2) throw Error('expected --run-id UUID --phase baseline|work|released --pass isolated|matching --log PATH [--mode public|controlled]');
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--run-id', '--phase', '--pass', '--log', '--mode', '--retain-existing', '--targets'].includes(args[i]) || values[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('invalid arguments');
    values[args[i]] = args[i + 1];
  }
  values['--mode'] ||= 'public';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(values['--run-id'] || '') || !['baseline', 'work', 'released'].includes(values['--phase']) || !['isolated', 'matching'].includes(values['--pass']) || !['public', 'controlled'].includes(values['--mode']) || !values['--log'] || (values['--retain-existing'] && !['true', 'false'].includes(values['--retain-existing']))) throw Error('invalid run ID, phase, pass, mode, log or retain-existing');
  return values;
}

async function controlledProxy(targets) {
  const requests = [];
  const allowed = new Set(targets.map(target => { const url = new URL(target); url.protocol = 'http:'; return url.origin; }));
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url);
      const nonce = url.searchParams.get('probe_nonce');
      if (req.method !== 'GET' || url.protocol !== 'http:' || !allowed.has(url.origin) || !/^[0-9a-f-]{36}$/.test(nonce || '')) throw Error('invalid request');
      requests.push(nonce);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
      res.end(`<!doctype html><title>grace-probe-${nonce}</title><p>grace-probe-${nonce}</p>`);
    } catch {
      res.writeHead(403, { connection: 'close' });
      res.end();
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  return { server, requests, port: server.address().port };
}

async function bidi() {
  const socket = new WebSocket('ws://127.0.0.1:9222/session');
  let next = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.type === 'error') entry.reject(Error(`${message.error}: ${message.message}`));
    else entry.resolve(message.result);
  });
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => { socket.close(); fail(Error('BiDi connection timed out')); }, 20_000);
    socket.addEventListener('open', () => { clearTimeout(timer); ok(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); fail(Error('BiDi connection failed')); }, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 20_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send };
}

async function observe(send, requested, retain = false) {
  let context;
  try {
    ({ context } = await send('browsingContext.create', { type: 'tab' }));
    await send('browsingContext.navigate', { context, url: requested, wait: 'complete' });
    const tree = await send('browsingContext.getTree', { root: context });
    const value = await send('script.evaluate', { expression: 'document.title', target: { context }, awaitPromise: false, resultOwnership: 'none' });
    const url = tree.contexts?.[0]?.url || '';
    const title = value.result?.value || '';
    const sameHost = new URL(url).hostname.replace(/^www\./, '') === new URL(requested).hostname.replace(/^www\./, '');
    return { url, title, sameHost, ...(retain ? { context } : {}) };
  } catch (error) {
    return { error: String(error.message || error), ...(retain && context ? { context } : {}) };
  } finally {
    if (context && !retain) await send('browsingContext.close', { context }).catch(() => {});
  }
}

async function companionUuid(work) {
  try {
    const profile = join(work, 'profile');
    await owned(profile, true);
    const inventoryPath = join(profile, 'extensions.json'), prefsPath = join(profile, 'prefs.js');
    await owned(inventoryPath); await owned(prefsPath);
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
    const addon = inventory.addons.find(item => item.id === 'focus@pomotroid.local');
    if (!addon || !addon.active || addon.userDisabled || addon.appDisabled || ![1, 2].includes(addon.signedState) || !addon.location || ['temporary', 'app-temporary'].includes(addon.location)) return null;
    const prefs = await readFile(prefsPath, 'utf8');
    const match = prefs.match(/^user_pref\("extensions\.webextensions\.uuids",\s*("(?:\\.|[^"\\])*")\);$/m);
    const uuid = match && JSON.parse(JSON.parse(match[1]))['focus@pomotroid.local'];
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid || '') ? uuid : null;
  } catch { return null; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.platform !== 'darwin' || process.env.POMOTROID_DISPOSABLE_GUEST !== '1' || homedir() !== '/Users/admin' || process.getuid() === 0) throw Error('requires an opted-in non-root admin macOS guest');
  const run = args['--run-id'], phase = args['--phase'], pass = args['--pass'], mode = args['--mode'];
  const markerPath = '/Users/admin/.grace-disposable-guest.json';
  await owned(markerPath);
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  if (marker.run_id !== run || typeof marker.vm_name !== 'string' || !marker.vm_name.trim()) throw Error('guest marker mismatch');
  const work = join(root, run);
  await owned(work, true);
  let selectedTargets = defaultTargets;
  if (args['--targets']) {
    const path = resolve(args['--targets']);
    if (!path.startsWith(work + '/')) throw Error('targets file must be inside the owned work directory');
    await owned(path);
    selectedTargets = JSON.parse(await readFile(path, 'utf8'));
  }
  selectedTargets = normalizeTargets(selectedTargets);
  const targets = [...selectedTargets.blocked, ...selectedTargets.allowed];
  const targetHash = targetSetHash(selectedTargets);
  const provisionPath = join(work, 'provision.json');
  await owned(provisionPath);
  const provision = JSON.parse(await readFile(provisionPath, 'utf8'));
  if (provision.run_id !== run || provision.vm_name !== marker.vm_name || provision.pass !== pass) throw Error('provision record mismatch');
  if (pass === 'matching' && provision.enabled_extensions_complete !== true) throw Error('matching pass blocked: enabled extension setup is incomplete');
  const log = resolve(args['--log']);
  const logStat = await owned(log);
  const logContent = await readFile(log, 'utf8');
  let baseline = null;
  if (phase === 'work' || phase === 'released') {
    const names = (await readdir(work)).filter(name => name.startsWith(`browser-baseline-${pass}-${mode}-`) && name.endsWith('.json')).sort().reverse();
    if (names.length) {
      const path = join(work, names[0]);
      await owned(path);
      baseline = JSON.parse(await readFile(path, 'utf8'));
      if (baseline.run_id !== run || baseline.pass !== pass || baseline.mode !== mode || baseline.target_hash !== targetHash || baseline.log.path !== log || baseline.log.ino !== logStat.ino || logStat.size < baseline.log.offset) baseline = null;
    }
  }
  const ack = baseline ? activeAck(logContent, baseline.log.offset) : null;
  const result = { run_id: run, vm_name: marker.vm_name, pass, phase, mode, target_hash: targetHash, targets: selectedTargets, timestamp_utc: new Date().toISOString(), log: { path: log, ino: logStat.ino, offset: logStat.size }, active_ack: phase === 'work' ? ack : null, observations: [], existing_tabs: [], native_acceptance: 'blocked', pending: ['Native timer, selected profile and release require UI evidence.', 'Retained tabs require review if unavailable or extension identity cannot be verified.'] };
  let connection, proxy, sessionStarted = false;
  try {
    if (mode === 'controlled') proxy = await controlledProxy(targets);
    connection = await bidi();
    const capabilities = proxy ? { alwaysMatch: { proxy: { proxyType: 'manual', httpProxy: `127.0.0.1:${proxy.port}` } } } : {};
    await connection.send('session.new', { capabilities });
    sessionStarted = true;
    if (phase !== 'baseline' && Array.isArray(baseline?.existing_tabs)) {
      const uuid = await companionUuid(work);
      let contexts = [];
      try { contexts = (await connection.send('browsingContext.getTree')).contexts || []; } catch {}
      for (const tab of baseline.existing_tabs) {
        if (!tab.context || !tab.original_url || tab.classification !== 'loaded') continue;
        const context = reacquireContext(contexts, uuid, tab.original_url);
        const item = { original_context: tab.context, context, original_url: tab.original_url, classification: 'inconclusive' };
        if (!context) {
          item.error = 'Retained tab missing or ambiguous';
          result.existing_tabs.push(item);
          continue;
        }
        try {
          const tree = await connection.send('browsingContext.getTree', { root: context });
          item.url = tree.contexts?.[0]?.url || '';
          try {
            const value = await connection.send('script.evaluate', { expression: 'document.title', target: { context }, awaitPromise: false, resultOwnership: 'none' });
            item.title = value.result?.value || '';
          } catch { item.title = null; }
          if (phase === 'work') {
            const currentStat = await owned(log);
            const currentAck = currentStat.ino === baseline.log.ino && currentStat.size >= baseline.log.offset ? activeAck(await readFile(log, 'utf8'), baseline.log.offset) : null;
            item.classification = classifyExisting(item.url, uuid, tab.original_url, ack && currentAck && ack.connection === currentAck.connection && ack.revision === currentAck.revision);
          } else {
            const reload = new URL(tab.original_url);
            if (proxy) reload.searchParams.set('probe_nonce', randomUUID());
            await connection.send('browsingContext.navigate', { context, url: reload.href, wait: 'complete' });
            const restored = await connection.send('browsingContext.getTree', { root: context });
            const value = await connection.send('script.evaluate', { expression: 'document.title', target: { context }, awaitPromise: false, resultOwnership: 'none' });
            item.restored_url = restored.contexts?.[0]?.url || '';
            item.restored_title = value.result?.value || '';
            const nonce = reload.searchParams.get('probe_nonce');
            const restoredObservation = { url: item.restored_url, title: item.restored_title, sameHost: new URL(item.restored_url).hostname === reload.hostname, markerMatched: !proxy || (proxy.requests.includes(nonce) && item.restored_title === `grace-probe-${nonce}` && item.restored_url === reload.href) };
            item.classification = classify('released', true, restoredObservation, false, true, mode);
          }
        } catch (error) { item.error = String(error.message || error); }
        finally { if (phase === 'released') await connection.send('browsingContext.close', { context }).catch(() => {}); }
        result.existing_tabs.push(item);
      }
    }
    for (const publicUrl of targets) {
      const nonce = randomUUID();
      const parsed = new URL(publicUrl);
      if (proxy) { parsed.protocol = 'http:'; parsed.searchParams.set('probe_nonce', nonce); }
      const url = parsed.href;
      const retain = phase === 'baseline' && args['--retain-existing'] === 'true' && selectedTargets.blocked.slice(0, 2).includes(publicUrl);
      const observation = await observe(connection.send, url, retain);
      if (proxy) {
        observation.proxyRequested = proxy.requests.includes(nonce);
        observation.markerMatched = observation.proxyRequested && observation.title === `grace-probe-${nonce}` && observation.url === url;
      }
      const target = selectedTargets.blocked.includes(publicUrl);
      const previouslyLoaded = baseline?.observations?.some(item => targetKey(item.requested) === targetKey(url) && item.classification === 'loaded') || false;
      const currentStat = await owned(log);
      const currentAck = baseline && currentStat.ino === baseline.log.ino && currentStat.size >= baseline.log.offset ? activeAck(await readFile(log, 'utf8'), baseline.log.offset) : null;
      const matchingAck = ack && currentAck && ack.connection === currentAck.connection && ack.revision === currentAck.revision;
      const classification = classify(phase, previouslyLoaded, observation, matchingAck, target, mode);
      result.observations.push({ requested: url, ...observation, classification });
      if (retain && observation.context) {
        if (classification === 'loaded') result.existing_tabs.push({ context: observation.context, requested: url, original_url: observation.url, title: observation.title, classification });
        else await connection.send('browsingContext.close', { context: observation.context }).catch(() => {});
      }
    }
  } catch (error) {
    result.error = String(error.message || error);
  } finally {
    if (connection) {
      if (sessionStarted) await connection.send('session.end').catch(() => {});
      connection.socket.close();
    }
    if (proxy) {
      result.proxy_requests = proxy.requests;
      proxy.server.closeAllConnections();
      await new Promise(resolve => { proxy.server.close(resolve); setTimeout(resolve, 1000).unref(); });
      for (const item of result.observations) {
        const nonce = new URL(item.requested).searchParams.get('probe_nonce');
        if (proxy.requests.includes(nonce) && item.proxyRequested === false) {
          item.proxyRequested = true;
          if (item.classification === 'blocked-observed') item.classification = 'inconclusive';
        }
      }
    }
  }
  const destination = join(work, `browser-${phase}-${pass}-${mode}-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.json`);
  await writeFile(destination, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(destination);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Browser probe blocked: ${error.message}`); process.exitCode = 1; });
}
