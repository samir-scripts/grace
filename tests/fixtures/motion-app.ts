import { mockWindows, mockIPC } from '@tauri-apps/api/mocks';
import { mount } from 'svelte';
import type { Settings, Theme, TimerState, FocusSnapshot, DetailedStats, HeatmapStats } from '$lib/types';
import { emit } from '@tauri-apps/api/event';
import { activeView } from '$lib/stores/navigation';

declare global {
  interface Window {
    __motionTest?: MotionTestController;
  }
}

const defaultSettings: Settings = {
  short_breaks_enabled: true,
  long_breaks_enabled: true,
  auto_start_work: false,
  auto_start_break: false,
  tray_icon_enabled: false,
  min_to_tray: false,
  min_to_tray_on_close: false,
  notifications_enabled: false,
  always_on_top: false,
  break_always_on_top: false,
  volume: 1.0,
  tick_sounds_during_work: false,
  tick_sounds_during_break: false,
  shortcut_toggle: 'Control+F1',
  shortcut_reset: 'Control+F2',
  shortcut_skip: 'Control+F3',
  shortcut_restart: 'Control+F4',
  websocket_enabled: false,
  websocket_port: 1314,
  theme_mode: 'dark',
  theme_light: 'Pomotroid Light',
  theme_dark: 'Pomotroid',
  dial_countdown: true,
  language: 'en',
  verbose_logging: false,
  check_for_updates: true,
  global_shortcuts_enabled: false,
  local_shortcut_toggle: ' ',
  local_shortcut_reset: 'ArrowLeft',
  local_shortcut_skip: 'ArrowRight',
  local_shortcut_volume_down: 'ArrowDown',
  local_shortcut_volume_up: 'ArrowUp',
  local_shortcut_mute: 'm',
  local_shortcut_fullscreen: 'F11',
  animations_enabled: true,
};

// Check query param or sessionStorage override
const urlParams = new URLSearchParams(window.location.search);
const storedPref = sessionStorage.getItem('motion-test-animations-enabled');
let currentAnimationsEnabled = storedPref !== null
  ? storedPref === 'true'
  : (urlParams.get('animations') !== 'false');

let currentSettings: Settings = {
  ...defaultSettings,
  animations_enabled: currentAnimationsEnabled,
};

let currentTimer: TimerState = {
  round_type: 'work',
  previous_round_type: '',
  elapsed_secs: 30,
  total_secs: 120,
  is_running: false,
  is_paused: true,
  work_round_number: 1,
  work_rounds_total: 4,
  session_work_count: 0,
};

let currentFocus: FocusSnapshot = {
  status: 'idle',
  current_phase: null,
  active_profile: null,
  current_work_round: 0,
  total_work_rounds: 0,
  is_locked: false,
  blocking_active: false,
  unblock_during_breaks: false,
  enforcement: {
    state: 'inactive',
    applications_active: false,
    websites_active: false,
    error_code: null,
  },
};

const pomotroidDark: Theme = {
  name: 'Pomotroid',
  is_custom: false,
  colors: {
    '--color-long-round': '#0bbddb',
    '--color-short-round': '#05ec8c',
    '--color-focus-round': '#ff4e4d',
    '--color-background': '#2f384b',
    '--color-background-light': '#3d4457',
    '--color-background-lightest': '#9ca5b5',
    '--color-foreground': '#f6f2eb',
    '--color-foreground-darker': '#c0c9da',
    '--color-foreground-darkest': '#dbe1ef',
    '--color-accent': '#05ec8c',
  },
};

const pomotroidLight: Theme = {
  name: 'Pomotroid Light',
  is_custom: false,
  colors: {
    '--color-long-round': '#6aaec4',
    '--color-short-round': '#3a7d58',
    '--color-focus-round': '#c84840',
    '--color-background': '#f5f0e8',
    '--color-background-light': '#ede6db',
    '--color-background-lightest': '#c4bdb5',
    '--color-foreground': '#2f384b',
    '--color-foreground-darker': '#55647a',
    '--color-foreground-darkest': '#8899b0',
    '--color-accent': '#3a7d58',
  },
};

const themes: Theme[] = [pomotroidDark, pomotroidLight];

// Calculate local YYYY-MM-DD
const now = new Date();
const localYear = now.getFullYear();
const localMonth = String(now.getMonth() + 1).padStart(2, '0');
const localDay = String(now.getDate()).padStart(2, '0');
const todayStr = `${localYear}-${localMonth}-${localDay}`;

const detailedStats: DetailedStats = {
  today: {
    rounds: 3,
    focus_mins: 75,
    completion_rate: 100,
    by_hour: Array.from({ length: 24 }, (_, h) => (h === 12 ? 3 : 0)),
  },
  week: [{ date: todayStr, rounds: 3 }],
  streak: { current: 1, longest: 1 },
};

const heatmapStats: HeatmapStats = {
  entries: [{ date: todayStr, count: 3 }],
  total_rounds: 3,
  total_hours: 1.25,
  longest_streak: 1,
};

interface SettingsGetResolver {
  promise: Promise<Settings>;
  resolve: (val: Settings) => void;
  reject: (err: unknown) => void;
}
let settingsGetResolver: SettingsGetResolver | null = null;
let holdSettings = urlParams.get('hold_settings') === 'true';

interface SaveDeferred {
  promise: Promise<Settings>;
  resolve: (val: Settings) => void;
  reject: (err: unknown) => void;
  key: string;
  value: string;
}
let nextSaveDeferred: SaveDeferred | null = null;
let shouldHoldSave = false;
let nextSaveError: string | null = null;
let saveCount = 0;

function readField(obj: unknown, key: string): unknown {
  if (obj && typeof obj === 'object' && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

export const windowResizeCalls: Array<{ view: string; animate?: boolean; renderedBeforeResize?: boolean; paintedBeforeResize?: boolean }> = [];

let framesAfterViewChange = 0;
let initialViewLoaded = false;
activeView.subscribe(() => {
  if (!initialViewLoaded) {
    initialViewLoaded = true;
    return;
  }
  framesAfterViewChange = 0;
  requestAnimationFrame(() => {
    framesAfterViewChange++;
    requestAnimationFrame(() => {
      framesAfterViewChange++;
    });
  });
});

mockWindows('main');
mockIPC((cmd, args: unknown) => {
  if (cmd === 'settings_get') {
    if (holdSettings) {
      const { promise, resolve, reject } = Promise.withResolvers<Settings>();
      settingsGetResolver = { promise, resolve, reject };
      return promise;
    }
    return JSON.parse(JSON.stringify(currentSettings));
  }

  if (cmd === 'settings_set') {
    saveCount++;
    const keyVal = readField(args, 'key');
    const valVal = readField(args, 'value');
    const key = typeof keyVal === 'string' ? keyVal : '';
    const value = typeof valVal === 'string' ? valVal : '';
    if (shouldHoldSave) {
      shouldHoldSave = false;
      const { promise, resolve, reject } = Promise.withResolvers<Settings>();
      nextSaveDeferred = { promise, resolve, reject, key, value };
      return promise;
    }

    if (nextSaveError) {
      const err = nextSaveError;
      nextSaveError = null;
      throw new Error(err);
    }

    if (key === 'animations_enabled') {
      currentSettings.animations_enabled = value === 'true';
      sessionStorage.setItem('motion-test-animations-enabled', value);
    }
    emit('settings:changed', currentSettings).catch(() => {});
    return JSON.parse(JSON.stringify(currentSettings));
  }

  if (cmd === 'themes_list') {
    return JSON.parse(JSON.stringify(themes));
  }

  if (cmd === 'timer_get_state') {
    return JSON.parse(JSON.stringify(currentTimer));
  }

  if (cmd === 'timer_toggle') {
    currentTimer.is_running = !currentTimer.is_running;
    currentTimer.is_paused = !currentTimer.is_running;
    if (currentTimer.is_running) {
      emit('timer:resumed', { elapsed_secs: currentTimer.elapsed_secs }).catch(() => {});
    } else {
      emit('timer:paused', { elapsed_secs: currentTimer.elapsed_secs }).catch(() => {});
    }
    return;
  }

  if (cmd === 'timer_restart_round' || cmd === 'timer_skip' || cmd === 'timer_reset') {
    emit('timer:reset', currentTimer).catch(() => {});
    return;
  }

  if (cmd === 'focus_snapshot_get') {
    return JSON.parse(JSON.stringify(currentFocus));
  }
  if (cmd === 'focus_apps_list') {
    return { applications: [], warnings: [] };
  }


  if (cmd === 'focus_profiles_get') {
    return [];
  }

  if (cmd === 'focus_browsers_list') {
    return [];
  }

  if (cmd === 'focus_browser_setup_get') {
    return { token: 'test-only', port: 1314, profiles: [] };
  }

  if (cmd === 'focus_escape_start_hold') {
    return 'motion-test-hold';
  }

  if (cmd === 'focus_escape_pulse_hold') {
    return false;
  }

  if (cmd === 'focus_escape_cancel_hold') {
    return;
  }

  if (cmd === 'stats_get_detailed') {
    return JSON.parse(JSON.stringify(detailedStats));
  }

  if (cmd === 'stats_get_heatmap') {
    return JSON.parse(JSON.stringify(heatmapStats));
  }

  if (cmd === 'plugin:window|is_maximized') {
    return false;
  }

  if (cmd === 'plugin:window|show' || cmd === 'plugin:window|minimize' || cmd === 'plugin:window|close') {
    return;
  }

  if (cmd === 'plugin:log|log') {
    return;
  }

  if (cmd === 'window_set_view_size') {
    const viewVal = readField(args, 'view');
    const animVal = readField(args, 'animate');
    const targetElementMounted =
      viewVal === 'settings'
        ? !!document.querySelector('.settings-view')
        : viewVal === 'stats'
          ? !!document.querySelector('.stats-section')
          : !!(document.querySelector('.timer-outer') || document.querySelector('.dial'));
    const paintedBeforeResize = framesAfterViewChange > 0;
    windowResizeCalls.push({
      view: typeof viewVal === 'string' ? viewVal : '',
      animate: typeof animVal === 'boolean' ? animVal : undefined,
      renderedBeforeResize: targetElementMounted,
      paintedBeforeResize,
    });
    return;
  }

  if (cmd === 'accessibility_trusted' || cmd === 'tray_supported') {
    return false;
  }

  if (cmd === 'check_update') {
    return null;
  }

  console.warn('[motion-fixture] unhandled IPC command:', cmd, args);
  throw new Error(`Unhandled mock IPC command: ${cmd}`);
}, { shouldMockEvents: true });

export interface MotionTestController {
  emit: (event: string, payload: unknown) => Promise<void>;
  releaseSettings: (reject?: boolean) => void;
  holdNextSave: () => void;
  releaseSave: (reject?: boolean) => void;
  setNextSaveError: (msg: string) => void;
  getSaveCount: () => number;
  getWindowResizeCalls: () => Array<{ view: string; animate?: boolean; renderedBeforeResize?: boolean; paintedBeforeResize?: boolean }>;
  clearResizeCalls: () => void;
  setFocusSnapshot: (snap: FocusSnapshot) => Promise<void>;
}

const controller: MotionTestController = {
  emit: async (event: string, payload: unknown) => {
    if (event === 'settings:changed') {
      const partial = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      const merged = { ...currentSettings, ...partial };
      currentSettings = merged as Settings;
      await emit(event, merged);
      return;
    }
    await emit(event, payload);
  },
  releaseSettings: (reject = false) => {
    if (settingsGetResolver) {
      if (reject) settingsGetResolver.reject(new Error('Injected settings load failure'));
      else settingsGetResolver.resolve(JSON.parse(JSON.stringify(currentSettings)));
      settingsGetResolver = null;
    }
  },
  holdNextSave: () => {
    shouldHoldSave = true;
  },
  releaseSave: (reject = false) => {
    if (nextSaveDeferred) {
      if (reject) {
        nextSaveDeferred.reject(new Error('Injected save rejection'));
      } else {
        if (nextSaveDeferred.key === 'animations_enabled') {
          currentSettings.animations_enabled = nextSaveDeferred.value === 'true';
          sessionStorage.setItem('motion-test-animations-enabled', nextSaveDeferred.value);
        }
        emit('settings:changed', currentSettings).catch(() => {});
        nextSaveDeferred.resolve(JSON.parse(JSON.stringify(currentSettings)));
      }
      nextSaveDeferred = null;
    }
  },
  setNextSaveError: (msg: string) => {
    nextSaveError = msg;
  },
  getSaveCount: () => saveCount,
  getWindowResizeCalls: () => [...windowResizeCalls],
  clearResizeCalls: () => {
    windowResizeCalls.length = 0;
  },
  setFocusSnapshot: async (snap: FocusSnapshot) => {
    currentFocus = snap;
    await emit('focus:changed', currentFocus);
  },
};

window.__motionTest = controller;

// Mount the real SvelteKit +page component dynamically
import('../../src/routes/+page.svelte').then((mod) => {
  const App = mod.default;
  const target = document.getElementById('motion-root');
  if (target) {
    mount(App, { target });
  }
}).catch((err: unknown) => {
  console.error('[motion-fixture] failed to mount root page:', err);
});
