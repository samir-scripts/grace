const ROLES = ['background', 'background-light', 'foreground', 'foreground-darker', 'hover', 'selected', 'border', 'separator', 'button', 'button-text', 'status-error', 'status-success', 'status-warning'];
export const APPEARANCE_KEY = 'focus_appearance';

export function validateAppearance(value) {
  if (!value || value.type !== 'appearance' || value.version !== 1 || typeof value.animations_enabled !== 'boolean' || !value.colors || typeof value.colors !== 'object') return null;
  const colors = {};
  for (const role of ROLES) {
    const color = value.colors[`--color-${role}`];
    if (typeof color !== 'string' || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return null;
    colors[`--color-${role}`] = color;
  }
  return { type: 'appearance', version: 1, colors, animations_enabled: value.animations_enabled };
}

export function applyAppearance(document, value) {
  const appearance = validateAppearance(value);
  if (!appearance) return false;
  for (const [role, color] of Object.entries(appearance.colors)) document.documentElement.style.setProperty(`--${role.slice(8)}`, color);
  document.documentElement.dataset.animations = appearance.animations_enabled ? 'enabled' : 'disabled';
  return true;
}

export function fetchAppearance(connectNative, timeoutMs = 2000) {
  return new Promise(resolve => {
    let port, timer, done = false;
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { port?.disconnect(); } catch {}
      resolve(value);
    };
    try {
      port = connectNative('com.splode.pomotroid');
      port.onMessage.addListener(message => finish(validateAppearance(message)));
      port.onDisconnect.addListener(() => finish(null));
      timer = setTimeout(() => finish(null), timeoutMs);
      port.postMessage({ type: 'appearance_get' });
    } catch { finish(null); }
  });
}
