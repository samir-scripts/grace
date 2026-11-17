import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { mount } from 'svelte';
import BrowserSetup from '../../src/lib/components/settings/BrowserSetup.svelte';
import '../../src/app.css';

const assignments: unknown[] = [];
let profiles = [{ profile_id: 'one', browser: null as string | null, is_required: true, is_connected: false, last_seen_secs_ago: 0 }];
mockWindows('main');
mockIPC((command, args) => {
  if (command === 'focus_browsers_list') return [
    { kind: 'chrome', name: 'Google Chrome', catalog_id: null, is_installed: true, is_extension_installed: false, is_default: false },
    { kind: 'firefox', name: 'Mozilla Firefox', catalog_id: null, is_installed: true, is_extension_installed: false, is_default: false },
    { kind: 'edge', name: 'Microsoft Edge', catalog_id: null, is_installed: false, is_extension_installed: false, is_default: false },
  ];
  if (command === 'focus_browser_setup_get') return { token: '', port: 0, profiles };
  if (command === 'focus_browser_profile_require') {
    if (!args || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array || typeof args.browser !== 'string') throw new Error('Invalid assignment');
    assignments.push(args);
    profiles = [{ ...profiles[0], browser: args.browser }];
    return;
  }
  throw new Error(`Unexpected command ${command}`);
}, { shouldMockEvents: true });
Object.assign(window, { __assignments: assignments });
mount(BrowserSetup, { target: document.getElementById('root')!, props: { isLocked: new URLSearchParams(location.search).has('locked') } });
