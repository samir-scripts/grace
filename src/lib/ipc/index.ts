// Typed wrappers around Tauri invoke() and listen().
// All backend communication goes through this module.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import type {
  TimerState,
  Settings,
  Theme,
  CustomAudioInfo,
  DetailedStats,
  HeatmapStats,
  UpdateInfo,
  FocusProfile,
  FocusSnapshot,
  ApplicationCatalog,
  BrowserKind,
  BrowserSetupInfo,
  InstalledBrowser,
} from '$lib/types';

// --- Timer commands ---

export const timerToggle = () => invoke<void>('timer_toggle');
export const timerReset = () => invoke<void>('timer_reset');
export const timerRestartRound = () => invoke<void>('timer_restart_round');
export const timerSkip = () => invoke<void>('timer_skip');
export const getTimerState = () => invoke<TimerState>('timer_get_state');

// --- Settings commands ---

export const getSettings = () => invoke<Settings>('settings_get');
/** Save a single setting key/value pair and receive the full updated settings. */
export const setSetting = (key: string, value: string) =>
  invoke<Settings>('settings_set', { key, value });
export const resetSettings = () => invoke<Settings>('settings_reset_defaults');
export const reloadShortcuts = () => invoke<void>('shortcuts_reload');

// --- Theme commands ---

export const getThemes = () => invoke<Theme[]>('themes_list');

// --- Notification commands ---

export const notificationShow = (title: string, body: string) =>
  invoke<void>('notification_show', { title, body });

// --- Window commands ---

export const setWindowVisibility = (visible: boolean) =>
  invoke<void>('window_set_visibility', { visible });
export const setWindowViewSize = (
  view: 'timer' | 'settings' | 'stats',
  animate?: boolean
) => invoke<void>('window_set_view_size', { view, animate });

// --- Audio commands ---

export const getCustomAudioInfo = () => invoke<CustomAudioInfo>('audio_get_custom_info');

/** Copy `srcPath` to the config dir for `cue`; returns the display name. */
export const setCustomAudio = (cue: string, srcPath: string) =>
  invoke<string>('audio_set_custom', { cue, srcPath });

/** Delete the custom file for `cue` and revert to the built-in sound. */
export const clearCustomAudio = (cue: string) => invoke<void>('audio_clear_custom', { cue });

/** Open a native file picker filtered to audio formats. Returns a path or null. */
export const openAudioFilePicker = (): Promise<string | null> =>
  dialogOpen({
    multiple: false,
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg'] }],
  }) as Promise<string | null>;

// --- Diagnostic log commands ---

/** Open the application log directory in the OS file manager. */
export const openLogDir = () => invoke<void>('open_log_dir');

/** Return the resolved log directory path as a string. */
export const getLogDir = () => invoke<string>('get_log_dir');

/** Return the compile-time build version string (e.g. `1.0.0-dev.80+20b2d87`). */
export const appVersion = () => invoke<string>('app_version');

// --- Sessions commands ---

export const clearSessionHistory = () => invoke<void>('sessions_clear');

// --- Stats commands ---

/** Daily + weekly data + streak in one call (Today and This Week tabs). */
export const statsGetDetailed = () => invoke<DetailedStats>('stats_get_detailed');

/** Heatmap entries + lifetime totals (All Time tab). */
export const statsGetHeatmap = () => invoke<HeatmapStats>('stats_get_heatmap');

// --- Platform commands ---
export const accessibilityTrusted = () => invoke<boolean>('accessibility_trusted');
export const accessibilityRequest = () => invoke<boolean>('accessibility_request');
/** Returns true if the system tray is usable on this platform/install.
 *  On Linux this probes for libayatana-appindicator3 / libappindicator3 at
 *  runtime; on macOS and Windows it always returns true. */
export const traySupported = () => invoke<boolean>('tray_supported');

// --- Updater commands ---

/** Check for an available update. Returns update info or null if already up to date. */
export const checkUpdate = () => invoke<UpdateInfo | null>('check_update');

/** Download, install, and immediately relaunch with the pending update. */
export const installUpdate = () => invoke<void>('install_update');

// --- Event listeners ---

export const onTimerTick = (
  cb: (payload: { elapsed_secs: number; total_secs: number }) => void
): Promise<UnlistenFn> =>
  listen<{ elapsed_secs: number; total_secs: number }>('timer:tick', (e) => cb(e.payload));

export const onTimerPaused = (
  cb: (payload: { elapsed_secs: number }) => void
): Promise<UnlistenFn> => listen<{ elapsed_secs: number }>('timer:paused', (e) => cb(e.payload));

export const onTimerResumed = (
  cb: (payload: { elapsed_secs: number }) => void
): Promise<UnlistenFn> => listen<{ elapsed_secs: number }>('timer:resumed', (e) => cb(e.payload));

export const onRoundChange = (cb: (state: TimerState) => void): Promise<UnlistenFn> =>
  listen<TimerState>('timer:round-change', (e) => cb(e.payload));

export const onTimerReset = (cb: (state: TimerState) => void): Promise<UnlistenFn> =>
  listen<TimerState>('timer:reset', (e) => cb(e.payload));

export const onSettingsChanged = (cb: (settings: Settings) => void): Promise<UnlistenFn> =>
  listen<Settings>('settings:changed', (e) => cb(e.payload));

export const onThemesChanged = (cb: (themes: Theme[]) => void): Promise<UnlistenFn> =>
  listen<Theme[]>('themes:changed', (e) => cb(e.payload));

export const onSessionsCleared = (cb: () => void): Promise<UnlistenFn> =>
  listen<void>('sessions:cleared', () => cb());

// --- Focus Session commands ---

export const getInstalledApplications = () =>
  invoke<ApplicationCatalog>('focus_apps_list');
export const getInstalledApplicationIcon = (id: string) =>
  invoke<string | null>('focus_app_icon', { id });

export const getFocusSnapshot = () => invoke<FocusSnapshot>('focus_snapshot_get');
export const getFocusProfiles = () => invoke<FocusProfile[]>('focus_profiles_get');
export const saveFocusProfile = (profile: FocusProfile) =>
  invoke<FocusProfile>('focus_profile_save', { profile });
export const deleteFocusProfile = (id: string) =>
  invoke<boolean>('focus_profile_delete', { id });
export const selectFocusProfile = (id: string) =>
  invoke<void>('focus_profile_select', { id });
export const setFocusUnblockBreaks = (unblock: boolean) =>
  invoke<void>('focus_preferences_set_unblock_breaks', { unblock });
export const setFocusPassphrase = (passphrase: string) =>
  invoke<void>('focus_passphrase_set', { passphrase });
export const clearFocusPassphrase = () =>
  invoke<void>('focus_passphrase_clear');
export const startEmergencyHold = () =>
  invoke<string>('focus_escape_start_hold');
export const pulseEmergencyHold = (attemptId: string) =>
  invoke<boolean>('focus_escape_pulse_hold', { attemptId });
export const cancelEmergencyHold = (attemptId: string) =>
  invoke<void>('focus_escape_cancel_hold', { attemptId });
export const submitEmergencyPassphrase = (passphrase: string) =>
  invoke<boolean>('focus_escape_submit_passphrase', { passphrase });

export const getBrowserSetup = () =>
  invoke<BrowserSetupInfo>('focus_browser_setup_get');
export const requireBrowserProfile = (profileId: string, browser: BrowserKind, isRequired: boolean) =>
  invoke<void>('focus_browser_profile_require', { profileId, browser, isRequired });
export const retryFocusEnforcement = () =>
  invoke<void>('focus_enforcement_retry');
export const listInstalledBrowsers = () =>
  invoke<InstalledBrowser[]>('focus_browsers_list');
export const registerNativeHost = () =>
  invoke<void>('focus_native_host_register');
export const installBrowserExtension = (browser: BrowserKind) =>
  invoke<void>('focus_browser_extension_install', { browser });
export const removeBrowserExtension = (browser: BrowserKind) =>
  invoke<void>('focus_browser_extension_remove', { browser });

export const onFocusChanged = (cb: (snapshot: FocusSnapshot) => void): Promise<UnlistenFn> =>
  listen<FocusSnapshot>('focus:changed', (e) => cb(e.payload));

/** Publish only resolved appearance; no browser identity or pairing state. */
export const publishAppearance = (colors: Record<string, string>, animationsEnabled: boolean) =>
  invoke<void>('appearance_publish', {
    colors: Object.fromEntries(Object.entries(colors).filter(([key]) => [
      'background', 'background-light', 'background-lightest', 'foreground', 'foreground-darker',
      'foreground-darkest', 'accent', 'focus-round', 'short-round', 'long-round', 'hover', 'selected',
      'border', 'separator', 'button', 'button-text', 'status-error', 'status-success', 'status-warning'
    ].some(role => key === `--color-${role}`))),
    animationsEnabled,
  });
