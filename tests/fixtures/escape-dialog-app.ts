import { mockIPC } from '@tauri-apps/api/mocks';
import { mount } from 'svelte';
import App from './escape-dialog-app.svelte';
let resolveStart: (id: string) => void;
let holdComplete = false;
let settlePassphrase: (outcome: 'reject' | 'success') => void;
const calls: string[] = [];
mockIPC((cmd, args) => {
  calls.push(cmd);
  if (cmd === 'focus_escape_start_hold') {
    const { promise, resolve } = Promise.withResolvers<string>();
    resolveStart = resolve;
    return promise;
  }
  if (cmd === 'focus_escape_cancel_hold') return;
  if (cmd === 'focus_escape_pulse_hold') return holdComplete;
  if (cmd === 'focus_escape_submit_passphrase') {
    const matches = !!args && typeof args === 'object' && 'passphrase' in args &&
      args.passphrase === 'synthetic fixture passphrase for emergency exit';
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    settlePassphrase = (outcome) => {
      if (outcome === 'reject') reject(new Error('Synthetic verification rejection'));
      else resolve(matches);
    };
    return promise;
  }
  throw new Error(`Unexpected command ${cmd}`);
});
const escapeTest = {
  resolveStart: () => resolveStart('pending-id'),
  finishHold: () => { holdComplete = true; },
  finishPassphrase: (outcome: 'reject' | 'success') => settlePassphrase(outcome),
  calls,
};
Object.assign(window, { escapeTest });
mount(App, { target: document.getElementById('root')! });
