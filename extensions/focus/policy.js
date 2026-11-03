export function canonicalDomains(domains) {
  const result = new Set();
  for (const raw of domains) {
    if (!raw || typeof raw !== 'string') continue;
    let d = raw.trim().toLowerCase();
    if (d.startsWith('http://')) d = d.slice(7);
    if (d.startsWith('https://')) d = d.slice(8);
    const slashIdx = d.indexOf('/');
    if (slashIdx !== -1) d = d.slice(0, slashIdx);
    const queryIdx = d.indexOf('?');
    if (queryIdx !== -1) d = d.slice(0, queryIdx);
    const colonIdx = d.indexOf(':');
    if (colonIdx !== -1) d = d.slice(0, colonIdx);
    if (d.startsWith('www.')) d = d.slice(4);
    if (d.length > 0 && d.includes('.')) {
      result.add(d);
    }
  }
  return Array.from(result).sort();
}

export function rulesForPolicy(domains) {
  const canonical = canonicalDomains(domains);
  return canonical.map((domain, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'websocket']
    }
  }));
}

export function isUrlBlocked(urlStr, domains) {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    const canonical = canonicalDomains(domains);
    for (const d of canonical) {
      if (host === d || host.endsWith('.' + d)) {
        return true;
      }
    }
  } catch {
    // Malformed URL
  }
  return false;
}
