import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { mount } from 'svelte';
import { focusProfiles } from '../../src/lib/stores/focus';
import SessionsSection from '../../src/lib/components/settings/sections/SessionsSection.svelte';
import '../../src/app.css';

mockWindows('main');
mockIPC((command) => {
  if (command === 'focus_browsers_list') return [];
  if (command === 'focus_apps_list') return { applications: [], warnings: [] };
  if (command === 'focus_browser_setup_get') return { token: '', port: 0, profiles: [] };
  throw new Error(`Unexpected command ${command}`);
}, { shouldMockEvents: true });
const base = { work_secs: 1500, short_break_secs: 300, long_break_secs: 900, work_rounds: 4, blocked_apps: [], blocked_domains: [], revision: 1 };
focusProfiles.set([{ ...base, id: 'one', name: 'Alpha' }, { ...base, id: 'two', name: 'Beta' }]);
mount(SessionsSection, { target: document.getElementById('root')! });
