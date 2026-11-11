import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { mount } from 'svelte';
import '../../src/app.css';
import BrowserSetup from '../../src/lib/components/settings/BrowserSetup.svelte';
import { applyTheme } from '../../src/lib/stores/theme';
import { setLocale } from '../../src/lib/locale.svelte';
const [dark, light] = await Promise.all(['/themes/pomotroid.json', '/themes/pomotroid-light.json'].map(async (url) => (await fetch(url)).json()));

const mode = new URLSearchParams(location.search).get('icon') || 'success';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=';
const calls: string[] = [];
let openedUrl: unknown;
let openedWith: unknown;
const openAttempts: unknown[] = [];
const params = new URLSearchParams(location.search);
let profiles = [
  { profile_id: 'one', browser: 'chrome', is_required: false, is_connected: false, last_seen_secs_ago: 0 },
  { profile_id: 'two', browser: 'chrome', is_required: false, is_connected: true, last_seen_secs_ago: 0 },
  { profile_id: 'three', browser: 'firefox', is_required: false, is_connected: false, last_seen_secs_ago: 0 },
];
mockWindows('main');
mockIPC((cmd, args) => {
  calls.push(cmd);
  if (cmd === 'focus_browsers_list') return [
    { kind: 'chrome', name: 'Google Chrome', catalog_id: 'chrome', executable_path: '/chrome', policy_path: null, is_installed: true, is_extension_installed: true, is_default: true },
    { kind: 'firefox', name: 'Mozilla Firefox', catalog_id: 'firefox', executable_path: '/firefox', policy_path: null, is_installed: true, is_extension_installed: false, is_default: false },
    { kind: 'zen', name: 'Zen Browser', catalog_id: null, executable_path: '/zen', policy_path: null, is_installed: true, is_extension_installed: false, is_default: false },
  ];
  if (cmd === 'focus_browser_setup_get') return { token: '', port: 0, profiles };
  if (cmd === 'focus_chrome_extension_install') {
    if (params.has('registrationError')) throw new Error('Registration failed');
    return 'https://chromewebstore.google.com/detail/example';
  }
  if (cmd === 'plugin:opener|open_url') { openedUrl = args && 'url' in args ? args.url : undefined; openedWith = args && 'with' in args ? args.with : undefined; openAttempts.push(openedWith); if (params.has('stableFallback') && openedWith === 'google-chrome') throw new Error('Chrome command unavailable'); return; }
  if (cmd === 'focus_app_icon') {
    if (mode === 'reject') throw new Error('icon unavailable');
    if (mode === 'null') return null;
    return mode === 'error' ? 'data:image/png;base64,broken' : png;
  }
  throw new Error(`Unexpected command ${cmd}`);
}, { shouldMockEvents: true });
(window as any).__browserSetupTest = {
  calls() { return calls; },
  openedUrl() { return openedUrl; },
  openedWith() { return openedWith; },
  openAttempts() { return openAttempts; },
  disconnect() { profiles = profiles.map((p) => ({ ...p, is_connected: false })); },
  locale(language: string) { setLocale(language); },
  theme(mode: 'dark' | 'light') {
    applyTheme(mode === 'dark' ? dark : light);
  },
};
(window as any).__browserSetupTest.theme('dark');
mount(BrowserSetup, { target: document.getElementById('root')!, props: { isLocked: params.has('locked') } });
