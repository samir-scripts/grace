import { writable } from 'svelte/store';

export type AppView = 'timer' | 'settings' | 'stats';
export type SettingsSectionId =
  | 'timer'
  | 'appearance'
  | 'notifications'
  | 'shortcuts'
  | 'system'
  | 'about';

export const activeView = writable<AppView>('timer');
export const activeSettingsSection = writable<SettingsSectionId>('timer');

export function toggleView(view: 'settings' | 'stats'): void {
  activeView.update((current) => (current === view ? 'timer' : view));
}

export function showTimerView(): void {
  activeView.set('timer');
}

export function openSettingsSection(section: SettingsSectionId): void {
  activeSettingsSection.set(section);
  activeView.set('settings');
}
