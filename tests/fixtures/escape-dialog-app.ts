import { mockIPC } from '@tauri-apps/api/mocks';
import { mount } from 'svelte';
import App from './escape-dialog-app.svelte';
let resolveStart: (id: string) => void;
const calls: string[] = [];
mockIPC((cmd) => {
  calls.push(cmd);
  if (cmd === 'focus_escape_start_hold') return new Promise<string>((resolve) => { resolveStart = resolve; });
  if (cmd === 'focus_escape_cancel_hold') return;
  if (cmd === 'focus_escape_pulse_hold') return false;
  throw new Error(`Unexpected command ${cmd}`);
});
(window as any).escapeTest = { resolveStart: () => resolveStart('pending-id'), calls };
mount(App, { target: document.getElementById('root')! });
