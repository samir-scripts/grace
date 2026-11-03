import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import {
  activeView,
  activeSettingsSection,
  toggleView,
  showTimerView,
  openSettingsSection,
} from './navigation.ts';

test('navigation store transitions in-place and toggles views correctly', () => {
  // Initial state
  showTimerView();
  assert.equal(get(activeView), 'timer');
  assert.equal(get(activeSettingsSection), 'timer');

  // Toggle settings: timer -> settings
  toggleView('settings');
  assert.equal(get(activeView), 'settings');

  // Toggle settings again: settings -> timer
  toggleView('settings');
  assert.equal(get(activeView), 'timer');

  // Switch directly from timer -> stats
  toggleView('stats');
  assert.equal(get(activeView), 'stats');

  // Switch directly from stats -> settings
  toggleView('settings');
  assert.equal(get(activeView), 'settings');

  // Open specific settings section
  openSettingsSection('appearance');
  assert.equal(get(activeView), 'settings');
  assert.equal(get(activeSettingsSection), 'appearance');

  // showTimerView resets view without erasing chosen settings section
  showTimerView();
  assert.equal(get(activeView), 'timer');
  assert.equal(get(activeSettingsSection), 'appearance');
});
