// Shared TypeScript types mirroring Rust structs (must stay in sync with Rust serde output).

export type RoundType = 'work' | 'short-break' | 'long-break';

/** Mirrors Rust `TimerSnapshot` — emitted via timer:tick / timer:round-change events
 *  and returned by the `timer_get_state` IPC command. */
export interface TimerState {
  round_type: RoundType;
  previous_round_type: string; // round type before this one; "" on first round
  elapsed_secs: number;
  total_secs: number;
  is_running: boolean;
  is_paused: boolean;
  work_round_number: number; // current work round (1-based)
  work_rounds_total: number; // total work rounds before long break
  session_work_count: number; // monotonic focus round count since last reset
}

/** Mirrors Rust `Settings` struct returned by `settings_get`. */
export interface Settings {
  short_breaks_enabled: boolean;
  long_breaks_enabled: boolean;
  auto_start_work: boolean;
  auto_start_break: boolean;
  tray_icon_enabled: boolean;
  min_to_tray: boolean;
  min_to_tray_on_close: boolean;
  notifications_enabled: boolean;
  dnd_enabled: boolean;
  always_on_top: boolean;
  break_always_on_top: boolean;
  volume: number; // 0.0–1.0
  tick_sounds_during_work: boolean;
  tick_sounds_during_break: boolean;
  shortcut_toggle: string;
  shortcut_reset: string;
  shortcut_skip: string;
  shortcut_restart: string;
  websocket_enabled: boolean;
  websocket_port: number;
  theme_mode: string; // 'auto' | 'light' | 'dark'
  theme_light: string;
  theme_dark: string;
  dial_countdown: boolean;
  animations_enabled: boolean;
  language: string; // 'auto' | 'en' | 'es' | 'fr' | 'de' | 'ja'
  verbose_logging: boolean;
  check_for_updates: boolean;
  global_shortcuts_enabled: boolean;
  local_shortcut_toggle: string;
  local_shortcut_reset: string;
  local_shortcut_skip: string;
  local_shortcut_volume_down: string;
  local_shortcut_volume_up: string;
  local_shortcut_mute: string;
  local_shortcut_fullscreen: string;
}

/** Returned by `check_update` — describes an available update. */
export interface UpdateInfo {
  version: string;
  body: string | null;
  date: string | null;
}

/** Mirrors Rust `CustomAudioInfo` — null means the built-in sound is active. */
export interface CustomAudioInfo {
  work_alert: string | null;
  short_break_alert: string | null;
  long_break_alert: string | null;
}

/** Mirrors Rust `Theme` struct. Color keys include the `--` CSS var prefix. */
export interface Theme {
  name: string;
  colors: Record<string, string>; // keys like "--color-background", "--color-focus-round"
  is_custom: boolean;
}

// ---------------------------------------------------------------------------
// Stats types — mirror Rust structs in commands.rs / queries.rs
// ---------------------------------------------------------------------------

export interface DailyStats {
  rounds: number;
  focus_mins: number;
  completion_rate: number | null; // null when no sessions started today
  by_hour: number[]; // 24 entries, index = hour of day
}

export interface DayStat {
  date: string; // "YYYY-MM-DD"
  rounds: number;
}

export interface HeatmapEntry {
  date: string; // "YYYY-MM-DD"
  count: number;
}

export interface StreakInfo {
  current: number;
  longest: number;
}

/** Returned by stats_get_detailed — Today + This Week + streak in one call. */
export interface DetailedStats {
  today: DailyStats;
  week: DayStat[];
  streak: StreakInfo;
}

/** Returned by stats_get_heatmap — heatmap entries + lifetime totals. */
export interface HeatmapStats {
  entries: HeatmapEntry[];
  total_rounds: number;
  total_hours: number;
  longest_streak: number;
}

/** Focus Session Distraction Blocking types */
export interface InstalledApplication {
  id: string;
  name: string;
  identifier: string;
  platform: string;
  path: string;
}

export interface ApplicationCatalog {
  applications: InstalledApplication[];
  warnings: string[];
}

export interface AppTarget {
  id: string;
  name: string;
  identifier: string;
  platform: 'macos' | 'windows' | 'all';
}

export interface FocusProfile {
  id: string;
  name: string;
  work_secs: number;
  short_break_secs: number;
  long_break_secs: number;
  work_rounds: number;
  blocked_apps: AppTarget[];
  blocked_domains: string[];
  revision: number;
}

export type FocusStatus = 'idle' | 'preparing' | 'active' | 'releasing' | 'recovery_required';
export type FocusPhase = 'work' | 'short_break' | 'long_break';

export type EnforcementState =
  | 'inactive' | 'preparing' | 'active' | 'failed' | 'releasing' | 'recovery_required';
export type EnforcementErrorCode =
  | 'helper_unavailable' | 'authorization_required' | 'authorization_denied'
  | 'unsupported_platform' | 'invalid_target' | 'apply_failed' | 'release_failed'
  | 'lease_lost' | 'protocol_mismatch';
export interface EnforcementStatus {
  state: EnforcementState;
  applications_active: boolean;
  websites_active: boolean;
  error_code: EnforcementErrorCode | null;
}

export type BrowserKind = 'chrome' | 'firefox' | 'safari' | 'zen';

export interface InstalledBrowser {
  kind: BrowserKind;
  name: string;
  catalog_id: string | null;
  executable_path: string;
  policy_path: string | null;
  is_installed: boolean;
  is_extension_installed: boolean;
  is_default?: boolean;
}

export interface ConnectedProfileInfo {
  profile_id: string;
  browser: BrowserKind | null;
  is_required: boolean;
  is_connected: boolean;
  last_seen_secs_ago: number;
}

export interface BrowserSetupInfo {
  token: string;
  port: number;
  profiles: ConnectedProfileInfo[];
}

export interface FocusSnapshot {
  status: FocusStatus;
  current_phase: FocusPhase | null;
  active_profile: FocusProfile | null;
  current_work_round: number;
  total_work_rounds: number;
  is_locked: boolean;
  blocking_active: boolean;
  unblock_during_breaks: boolean;
  enforcement: EnforcementStatus;
}
