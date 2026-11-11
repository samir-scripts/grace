# Graph Report - grace  (2026-11-04)

## Corpus Check
- 226 files · ~100,988 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 5, .xml 2, .woff2 2)

## Summary
- 2313 nodes · 4140 analysis edges (4544 exported relationship records) · 196 communities (94 shown, 102 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 86 edges (avg confidence: 0.79)
- Token cost: host/subagent token usage unavailable; zero counters are placeholders.

## Community Hubs (Navigation)
- Architecture and Focus Plans
- Audio and Theme Loading
- Focus Controller and Validation
- Browser Bridge and Leases
- Native Tray Controls
- Desktop Initialization and Updates
- Focus Persistence and Migrations
- Settings and Enforcement Contracts
- Background Timer Engine
- Session Settings and Stores
- External Timer WebSocket
- Titlebar and Session Selection
- Native Window Sizing
- Desktop IPC Commands
- Focus State Machine
- Timer Controls and Preferences
- Windows Process APIs
- Windows Application Discovery
- Build and Test Workflow
- Tauri Package Dependencies
- Timer Enforcement Integration
- Focused Keyboard Controls
- Emergency Release IPC
- Daily and Weekly Statistics
- Statistics Database Queries
- Application Process Monitor
- System Settings and Locale
- Appearance and Theme Resolution
- Global Keyboard Shortcuts
- Notification and Sound Settings
- Motion Test Fixtures
- Code Security Analysis
- Emergency Escape Dialog
- Enterprise Browser Policy
- Native Host Registration
- Installed Application Picker
- macOS Application Discovery
- Dependency Update Configuration
- Browser Setup UI and IPC
- Yearly Statistics Heatmap
- Native Enforcement Errors
- Pomodoro Round Sequence
- Application Catalog
- Firefox Extension Manifest
- Emergency Hold Timing
- Desktop Platform Commands
- Passphrase Hashing
- Companion Identity and Blocking
- Tooltip Interaction
- Native Enforcer Interface
- Native Messaging Framing Tests
- Browser Inventory and Status
- Statistics Seed Utility
- Chrome Extension Manifest
- Browser Test Tooling
- Companion Unit Test Helpers
- Enforcer Watchdog Lease
- Frontend Development Dependencies
- Release Artifact Publishing
- Hosts File Enforcement
- Safari Extension Manifest
- Release Pipeline Steps
- TypeScript Compiler Configuration
- Policy Merge Regression Tests
- Release Build Matrix
- Package Metadata
- macOS Bundle Configuration
- macOS Process Enforcement
- Disposable Native App Tests
- Frontend Build Scripts
- Frontend Runtime Dependencies
- Browser Detection Regression Tests
- Release Job Configuration
- Browser Extension Packaging
- Build Version Metadata
- Emergency Hold Errors
- Tauri Window Configuration
- Desktop Bundle Resources
- Native Pairing and Bootstrap
- Companion Options Storage
- Global Shortcut Capture
- Windows Installer Configuration
- Browser Identity Regression Tests
- Paraglide Locale Configuration
- Linux Bundle Configuration
- Companion Setup Documentation
- Windows Release Job
- Release Changelog Job
- Native Window Permissions
- Browser Policy Mutation IPC
- Statistics IPC Contracts
- Companion Domain Rules
- Release Publishing Job
- Static Svelte Adapter
- Windows COM Catalog
- Guarded Timer Actions
- OS Notification Dispatch
- Tauri Build Hooks
- Blocked Page Rendering
- Package Author Metadata
- Vite and Localization Plugins
- Automatic Update Configuration
- Installer Window Position
- Package Module
- Package Module
- Package Module
- Bump Version Module
- New Release Cycle Module
- +Layout Module
- Defaults Module
- Cargo Module

## God Nodes (most connected - your core abstractions)
1. `FocusController` - 62 edges
2. `EnforcerError` - 52 edges
3. `TimerController` - 35 edges
4. `BrowserBridge` - 28 edges
5. `setSetting()` - 24 edges
6. `FocusStateMachine` - 21 edges
7. `DbState` - 20 edges
8. `spawn()` - 18 edges
9. `TrayState` - 18 edges
10. `with` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Rust focus enforcement authority` --semantically_similar_to--> `Route to native ownership trace`  [INFERRED] [semantically similar]
  plans/focus-sessions-master-plan.md → AGENTS.md
- `Typed focus IPC and stores contract` --semantically_similar_to--> `Typed IPC and cross-window synchronization`  [INFERRED] [semantically similar]
  plans/subplans/06-ipc-contract-stores.md → AGENTS.md
- `Firefox and Zen share Mozilla native host manifest` --conceptually_related_to--> `Mozilla identity chooses Zen markers then Firefox fallback`  [INFERRED]
  src-tauri/src/focus/native_messaging.rs → extensions/focus/browser-identity.js
- `detects_identity_not_display_name()` --calls--> `browsers_from_catalog()`  [INFERRED]
  src-tauri/tests/browser_detector.rs → src-tauri/src/focus/browser_detector.rs
- `discovers_real_installed_browsers()` --calls--> `detect_installed_browsers()`  [INFERRED]
  src-tauri/tests/browser_detector.rs → src-tauri/src/focus/browser_detector.rs

## Import Cycles
- 2-file cycle: `src-tauri/src/timer/mod.rs -> src-tauri/src/tray/mod.rs -> src-tauri/src/timer/mod.rs`
- 2-file cycle: `src-tauri/src/timer/mod.rs -> src-tauri/src/websocket/mod.rs -> src-tauri/src/timer/mod.rs`

## Hyperedges (group relationships)
- **Rust-owned focus profile/state/enforcement/IPC flow** — plans_subplans_01_db_and_persistence_focus_repository, plans_subplans_03_state_machine_escape_state_escape, plans_subplans_04_native_enforcers_macos_windows_native_enforcers, plans_subplans_05_timer_controller_interception_controller_barrier, plans_subplans_06_ipc_contract_stores_focus_ipc [EXTRACTED 1.00]
- **Focus session selector, settings and emergency UI surfaces** — plans_subplans_07_ui_selector_titlebar_session_selector, plans_subplans_08_ui_settings_sessions_sessions_settings, plans_subplans_09_ui_emergency_exit_escape_dialog [EXTRACTED 1.00]
- **Companion installation, native pairing, identity, hello and policy ACK are separate stages** — src_lib_components_settings_browsersetup_policy_gated_install_remove_button, src_tauri_src_commands_native_host_executable_resolution, src_tauri_src_commands_shared_firefox_xpi_resolution, extensions_focus_native_pairing_native_connect_request, src_tauri_src_focus_native_messaging_native_config_reply, extensions_focus_native_pairing_persistent_pairing_credentials, extensions_focus_browser_identity_mozilla_family_browser_identity, extensions_focus_background_authenticated_hello, extensions_focus_background_policy_dynamic_rule_application, extensions_focus_background_ack_after_successful_policy_application [INFERRED 0.95]

## Communities (196 total, 102 thin omitted)

### Community 0 - "Architecture and Focus Plans"
Cohesion: 0.05
Nodes (50): Least required native/plugin capabilities, Current offline-first desktop architecture, Paraglide source and reactive locale pipeline, Replaced Electron/Vue implementation, Settings persistence units and mappings, Theme watcher and resolver pipeline, Rust timer and sequence authority, Typed IPC and cross-window synchronization (+42 more)

### Community 1 - "Audio and Theme Loading"
Cohesion: 0.05
Nodes (37): ALERT_LONG_BREAK, ALERT_SHORT_BREAK, ALERT_WORK, audio_thread(), AudioCue, LongBreakAlert, ShortBreakAlert, Tick (+29 more)

### Community 2 - "Focus Controller and Validation"
Cohesion: 0.07
Nodes (28): chrono_now_secs(), controller_with_rules(), FailingEnforcer, recovery_retry_can_release_and_clear_the_journal(), setup_test_controller(), test_break_acquire_retry_advances_round_once(), test_break_preference_releases_current_policy(), test_cannot_delete_only_profile() (+20 more)

### Community 3 - "Browser Bridge and Leases"
Cohesion: 0.06
Nodes (30): browser(), BROWSER_LEASE_SECS, BROWSER_PORT_DEFAULT, BROWSER_PROTOCOL_VERSION, BrowserBridge, BrowserConfig, BrowserKind, Chrome (+22 more)

### Community 4 - "Native Tray Controls"
Cohesion: 0.05
Nodes (26): appindicator_available(), arc_segment(), build_arc_path(), CENTER, create_tray(), destroy_tray(), parse_hex_color(), RADIUS (+18 more)

### Community 5 - "Desktop Initialization and Updates"
Cohesion: 0.05
Nodes (46): @tauri-apps/plugin-log@^2.8.0, @tauri-apps/plugin-log, availableUpdate, handleInstall(), releaseUrl, updateError, UpdateState, updateState (+38 more)

### Community 6 - "Focus Persistence and Migrations"
Cohesion: 0.07
Nodes (22): all_tables_created(), current_version(), legacy_database(), MIGRATION_1, MIGRATION_2, MIGRATION_3, MIGRATION_4, MIGRATION_5 (+14 more)

### Community 7 - "Settings and Enforcement Contracts"
Cohesion: 0.07
Nodes (43): EnforcementErrorCode, ApplyFailed, AuthorizationDenied, AuthorizationRequired, HelperUnavailable, InvalidTarget, LeaseLost, ProtocolMismatch (+35 more)

### Community 8 - "Background Timer Engine"
Cohesion: 0.08
Nodes (48): collect_until_complete(), drain(), drift_complete_within_tolerance(), elapsed_secs_increments_monotonically(), EngineHandle, fires_correct_number_of_ticks_and_completes(), pause_stops_ticks_and_resume_continues(), Phase (+40 more)

### Community 9 - "Session Settings and Stores"
Cohesion: 0.06
Nodes (44): enf, handleRetry(), isRetrying, activeProfile, clearPassphrase(), confirmDiscard(), createNewProfile(), domainInput (+36 more)

### Community 10 - "External Timer WebSocket"
Cohesion: 0.07
Nodes (29): broadcast_paused(), broadcast_reset(), broadcast_resumed(), broadcast_round_change(), broadcast_started(), ElapsedPayload, getstate_no_timer_state_sends_nothing(), getstate_sends_state_reply() (+21 more)

### Community 11 - "Titlebar and Session Selection"
Cohesion: 0.08
Nodes (29): activeProfile, handleSelect(), isLocked, isOpen, { onEmergencyClick }, openSettingsSessions(), profiles, Props (+21 more)

### Community 12 - "Native Window Sizing"
Cohesion: 0.08
Nodes (23): animate_frame_macos(), animate_resize_fallback(), apply_view_size(), DEFAULT_TIMER_HEIGHT, DEFAULT_TIMER_WIDTH, InnerState, optimal_view_logical_size(), RESIZE_GENERATION (+15 more)

### Community 13 - "Desktop IPC Commands"
Cohesion: 0.11
Nodes (28): audio_clear_custom(), audio_get_custom_info(), audio_set_custom(), check_update(), cue_to_name_key(), cue_to_stem(), focus_native_host_register(), get_log_dir() (+20 more)

### Community 14 - "Focus State Machine"
Cohesion: 0.10
Nodes (20): FocusError, InvalidTransition, NoActiveProfile, SessionLocked, FocusPhase, LongBreak, ShortBreak, Work (+12 more)

### Community 15 - "Timer Controls and Preferences"
Cohesion: 0.07
Nodes (32): toggleAnimations(), handleVolumeInput(), toggle(), toggleSetting(), checkTrusted(), onFocus(), requestAccess(), setLocalShortcut() (+24 more)

### Community 17 - "Windows Application Discovery"
Cohesion: 0.07
Nodes (5): icon(), OwnedIcon, read_shortcut(), render(), wide()

### Community 18 - "Build and Test Workflow"
Cohesion: 0.07
Nodes (34): name, runs-on, steps, name, runs-on, steps, name, runs-on (+26 more)

### Community 19 - "Tauri Package Dependencies"
Cohesion: 0.07
Nodes (34): dependencies, @tauri-apps/api@^2, @tauri-apps/plugin-opener@^2, description, devDependencies, svelte@^5.0.0, svelte-check@^4.0.0, @sveltejs/adapter-static@^3.0.6 (+26 more)

### Community 20 - "Timer Enforcement Integration"
Cohesion: 0.10
Nodes (11): timer_get_state(), timer_reset(), timer_restart_round(), timer_skip(), timer_toggle(), build_snapshot(), listen_events(), ListenContext (+3 more)

### Community 21 - "Focused Keyboard Controls"
Cohesion: 0.08
Nodes (23): listening, MODIFIER_KEYS, Props, { value = '', onchange }, state, { isCompact = false, uiScale = 1 }, Props, state (+15 more)

### Community 22 - "Emergency Release IPC"
Cohesion: 0.11
Nodes (14): focus_enforcement_retry(), focus_escape_cancel_hold(), focus_escape_pulse_hold(), focus_escape_start_hold(), focus_escape_submit_passphrase(), focus_passphrase_clear(), focus_passphrase_set(), focus_preferences_set_unblock_breaks() (+6 more)

### Community 23 - "Daily and Weekly Statistics"
Cohesion: 0.07
Nodes (24): byHour, hasData, hourLabels, maxHour, { today }, days, hasData, maxRounds (+16 more)

### Community 24 - "Statistics Database Queries"
Cohesion: 0.16
Nodes (28): complete_session(), compute_streak(), compute_streak_active_today(), compute_streak_active_until_midnight(), compute_streak_broken(), compute_streak_empty(), compute_streak_longest_across_break(), DailyStats (+20 more)

### Community 25 - "Application Process Monitor"
Cohesion: 0.14
Nodes (12): ApplicationMonitor, force_only_after_grace_period(), monitor_retries_transient_failure_and_terminates_relaunches(), pid_reuse_does_not_inherit_force_request(), process(), ProcessBackend, Processes, Reconciler (+4 more)

### Community 26 - "System Settings and Locale"
Cohesion: 0.10
Nodes (20): confirmingClear, confirmingReset, handleClear(), handleReset(), langOpen, LANGUAGES, localPort, selectedLabel (+12 more)

### Community 27 - "Appearance and Theme Resolution"
Cohesion: 0.12
Nodes (23): animationsSaveError, darkIsActive, darkThemes, lightIsActive, lightThemes, openPicker, osDark, savingAnimations (+15 more)

### Community 28 - "Global Keyboard Shortcuts"
Cohesion: 0.12
Nodes (12): apply_new_settings(), fire_action(), parse_code(), parse_ctrl_f1(), parse_shortcut(), register_all(), ShortcutAction, Reset (+4 more)

### Community 29 - "Notification and Sound Settings"
Cohesion: 0.10
Nodes (22): CUE_LIST, CueKey, localVolume, longBreakAlert, longBreakAlertError, pickAudio(), refreshAudioInfo(), restoreAudio() (+14 more)

### Community 30 - "Motion Test Fixtures"
Cohesion: 0.09
Nodes (24): FocusSnapshot, Settings, LocalShortcutState, controller, currentFocus, currentSettings, currentTimer, defaultSettings (+16 more)

### Community 31 - "Code Security Analysis"
Cohesion: 0.08
Nodes (24): name, runs-on, steps, strategy, jobs, analyze, language, name (+16 more)

### Community 32 - "Emergency Escape Dialog"
Cohesion: 0.11
Nodes (24): attemptId, beginHold(), endHold(), handleKeydown(), handleKeyup(), handlePassphraseSubmit(), holdProgress, holdSecondsLeft (+16 more)

### Community 34 - "Enterprise Browser Policy"
Cohesion: 0.13
Nodes (16): CHROME_DEFAULT_UPDATE_URL, CHROME_EXTENSION_ID, FIREFOX_EXTENSION_ID, generate_chrome_external_config(), generate_firefox_policy(), install_browser_enterprise_policy(), is_policy_installed(), is_policy_installed_at_path() (+8 more)

### Community 35 - "Native Host Registration"
Cohesion: 0.12
Nodes (16): DEFAULT_CHROME_EXT_ID, DEFAULT_FIREFOX_EXT_ID, get_chrome_manifest_dir(), get_config_path(), get_mozilla_manifest_dir(), HOST_NAME, MAX_MESSAGE_BYTES, NativeOutboundMessage (+8 more)

### Community 36 - "Installed Application Picker"
Cohesion: 0.11
Nodes (21): catalog, closePicker(), errorMessage, fetchIcon(), filteredApps, handleKeydown(), iconCache, isLoading (+13 more)

### Community 37 - "macOS Application Discovery"
Cohesion: 0.13
Nodes (8): bundle_string(), bundle_without_icon_returns_none(), discover(), icon(), malformed_bundle_is_warning_not_catalog_failure(), read_bundle(), MAX_ICON_BYTES, walk_candidates()

### Community 38 - "Dependency Update Configuration"
Cohesion: 0.09
Nodes (22): patterns, update-types, async-runtime, inlang, serde, svelte, tauri, patterns (+14 more)

### Community 39 - "Browser Setup UI and IPC"
Cohesion: 0.14
Nodes (22): browserSetup, handleInstall(), handleRefreshAll(), handleRemove(), { isLocked = false, activeSessionId = '', editingSessionId = '' }, isRefreshing, loadBrowsers(), mutating (+14 more)

### Community 40 - "Yearly Statistics Heatmap"
Cohesion: 0.09
Nodes (20): buildGridForYear(), currentYear, dowFmt, firstYear, fmtDate(), { grid, months, weekCount }, GRID_W, GridCell (+12 more)

### Community 41 - "Native Enforcement Errors"
Cohesion: 0.16
Nodes (13): EnforcerError, InvalidTarget, LeaseLost, NotAuthorized, PlatformUnsupported, ProcessTerminationFailed, ApplicationBackend, failure() (+5 more)

### Community 42 - "Pomodoro Round Sequence"
Cohesion: 0.20
Nodes (17): both_breaks_disabled_pure_work_loop(), four_work_rounds_cycle(), long_breaks_disabled_short_breaks_fire_normally(), long_breaks_disabled_substitutes_short_break(), reset_returns_to_initial_state(), RoundType, LongBreak, ShortBreak (+9 more)

### Community 43 - "Application Catalog"
Cohesion: 0.22
Nodes (14): app(), ApplicationCatalog, cache(), CatalogCache, icon(), InstalledApplication, list(), native_catalog_smoke() (+6 more)

### Community 44 - "Firefox Extension Manifest"
Cohesion: 0.11
Nodes (18): background, scripts, type, browser_specific_settings, gecko, declarative_net_request, rule_resources, description (+10 more)

### Community 45 - "Emergency Hold Timing"
Cohesion: 0.16
Nodes (9): EscapeHandler, HoldAttempt, MAX_PULSE_GAP, PASSPHRASE_ATTEMPT_EXPIRY, PassphraseAttempt, REQUIRED_HOLD_DURATION, test_hold_lifecycle(), test_passphrase_two_step_verification() (+1 more)

### Community 46 - "Desktop Platform Commands"
Cohesion: 0.11
Nodes (8): accessibility_request(), accessibility_trusted(), app_version(), focus_app_icon(), focus_apps_list(), focus_browser_setup_get(), focus_browsers_list(), tray_supported()

### Community 47 - "Passphrase Hashing"
Cohesion: 0.15
Nodes (6): hash_passphrase(), MIN_PASSPHRASE_CHARS, SecurityError, HashingFailed, PassphraseTooShort, test_passphrase_min_length_and_argon2()

### Community 48 - "Companion Identity and Blocking"
Cohesion: 0.26
Nodes (10): applyPolicy(), bootstrap(), connect(), diagnostic(), getSelfInfo(), getStorage(), scheduleReconnect(), startHeartbeat() (+2 more)

### Community 49 - "Tooltip Interaction"
Cohesion: 0.12
Nodes (14): delay(), actualPlacement, flipped, positioned, Props, show(), { text, delay = 600, placement = 'above', children }, tooltipEl (+6 more)

### Community 50 - "Native Enforcer Interface"
Cohesion: 0.20
Nodes (4): default_hosts_path(), HostsFileError, MockEnforcer, SystemEnforcer

### Community 51 - "Native Messaging Framing Tests"
Cohesion: 0.14
Nodes (5): generate_chrome_manifest(), generate_mozilla_manifest(), chrome_native_host_authorizes_valid_extension_identity(), test_chrome_native_manifest_format(), test_firefox_zen_native_manifest_format()

### Community 52 - "Browser Inventory and Status"
Cohesion: 0.28
Nodes (8): installedBrowsers, browsers_from_catalog(), compute_policy_path(), detect_installed_browsers(), get_default_browser(), InstalledBrowser, launch_browser(), validate_url_for_launch()

### Community 53 - "Statistics Seed Utility"
Cohesion: 0.23
Nodes (6): default_db_path(), generate_sessions(), main(), make_session(), seed(), summarise()

### Community 54 - "Chrome Extension Manifest"
Cohesion: 0.13
Nodes (14): background, service_worker, type, description, host_permissions, key, manifest_version, minimum_chrome_version (+6 more)

### Community 55 - "Browser Test Tooling"
Cohesion: 0.15
Nodes (5): chromeExtPath, __dirname, firefoxExtPath, playwright@^1.64.1, playwright

### Community 56 - "Companion Unit Test Helpers"
Cohesion: 0.19
Nodes (5): generateChromePolicy(), generateFirefoxPolicy(), __dirname, __filename, projectRoot

### Community 58 - "Frontend Development Dependencies"
Cohesion: 0.13
Nodes (15): devDependencies, prettier@^3.8.4, prettier-plugin-svelte@^4.1.1, svelte@^5.56.3, @sveltejs/adapter-static@^3.0.6, @types/node@^25.9.3, typescript@~6.0.3, vite@^8.0.16 (+7 more)

### Community 59 - "Release Artifact Publishing"
Cohesion: 0.14
Nodes (14): with, body, cache, draft, fetch-depth, files, if-no-files-found, name (+6 more)

### Community 60 - "Hosts File Enforcement"
Cohesion: 0.27
Nodes (11): apply_hosts_file(), HOSTS_TAG_BEGIN, HOSTS_TAG_END, HostsError, ReadFailed, WriteFailed, inject_hosts_block(), remove_hosts_block() (+3 more)

### Community 61 - "Safari Extension Manifest"
Cohesion: 0.15
Nodes (12): background, service_worker, type, description, host_permissions, manifest_version, name, options_ui (+4 more)

### Community 62 - "Release Pipeline Steps"
Cohesion: 0.27
Nodes (13): steps, steps, steps, steps, CI, GPG_PASSPHRASE, GPG_PRIVATE_KEY, env (+5 more)

### Community 63 - "TypeScript Compiler Configuration"
Cohesion: 0.15
Nodes (12): ./.svelte-kit/tsconfig.json, compilerOptions, allowJs, checkJs, esModuleInterop, forceConsistentCasingInFileNames, moduleResolution, resolveJsonModule (+4 more)

### Community 64 - "Policy Merge Regression Tests"
Cohesion: 0.18
Nodes (3): unmerge_firefox_policies(), test_policy_unmerges_and_preserves_foreign_entries(), test_policy_unmerges_to_none_when_only_focus_installed()

### Community 65 - "Release Build Matrix"
Cohesion: 0.17
Nodes (11): name, needs, runs-on, jobs, build-macos, name, on, push (+3 more)

### Community 66 - "Package Metadata"
Cohesion: 0.17
Nodes (12): scripts, build, check, check:watch, dev, extensions:build, format, paraglide:compile (+4 more)

### Community 67 - "macOS Bundle Configuration"
Cohesion: 0.17
Nodes (12): x, y, x, y, macOS, applicationFolderPosition, appPosition, windowSize (+4 more)

### Community 68 - "macOS Process Enforcement"
Cohesion: 0.24
Nodes (3): ApplicationBackend, MacOSEnforcer, process_identity()

### Community 69 - "Disposable Native App Tests"
Cohesion: 0.29
Nodes (3): blocked_app_relaunch_is_stopped_until_release(), Fixture, wait_for_exit()

### Community 70 - "Frontend Build Scripts"
Cohesion: 0.20
Nodes (9): description, @tauri-apps/cli@^2, homepage, @tauri-apps/cli, license, name, repository, type (+1 more)

### Community 71 - "Frontend Runtime Dependencies"
Cohesion: 0.20
Nodes (10): dependencies, @inlang/paraglide-js@^2.19.0, @tauri-apps/api@^2.11.0, @tauri-apps/plugin-dialog@^2.7.1, @tauri-apps/plugin-notification@^2.3.3, @tauri-apps/plugin-opener@^2, @tauri-apps/api, @tauri-apps/plugin-opener (+2 more)

### Community 73 - "Release Job Configuration"
Cohesion: 0.28
Nodes (9): env, name, needs, runs-on, env, env, TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD (+1 more)

### Community 74 - "Browser Extension Packaging"
Cohesion: 0.22
Nodes (6): browsers, createZipFromDirectory(), getFiles(), distDir, rootDir, sharedDir

### Community 75 - "Build Version Metadata"
Cohesion: 0.44
Nodes (8): DescribeInfo, extract_json_str_field(), format_fallback_from_sha(), format_version(), main(), parse_describe(), read_base_version(), run_git()

### Community 76 - "Emergency Hold Errors"
Cohesion: 0.22
Nodes (6): EscapeError, AttemptExpired, AttemptNotFound, HoldInterrupted, InvalidPassphrase, PassphraseMismatch

### Community 77 - "Tauri Window Configuration"
Cohesion: 0.22
Nodes (8): app, security, windows, identifier, productName, $schema, csp, version

### Community 78 - "Desktop Bundle Resources"
Cohesion: 0.22
Nodes (9): bundle, active, category, copyright, icon, longDescription, resources, shortDescription (+1 more)

### Community 79 - "Native Pairing and Bootstrap"
Cohesion: 0.32
Nodes (5): getStorage(), setStorage(), tryNativePairing(), NativeInboundMessage, Connect

### Community 80 - "Companion Options Storage"
Cohesion: 0.25
Nodes (5): autoBadge, profileIdInput, saveBtn, statusDiv, tokenInput

### Community 81 - "Global Shortcut Capture"
Cohesion: 0.29
Nodes (5): codeToKey(), listening, onKeydown(), Props, { value = '', onchange }

### Community 82 - "Windows Installer Configuration"
Cohesion: 0.25
Nodes (8): windows, displayLanguageSelector, headerImage, installerIcon, installMode, nsis, wix, language

### Community 84 - "Paraglide Locale Configuration"
Cohesion: 0.29
Nodes (6): baseLocale, locales, modules, plugin.inlang.messageFormat, pathPattern, $schema

### Community 85 - "Linux Bundle Configuration"
Cohesion: 0.29
Nodes (7): bundleMediaFramework, linux, depends, appimage, deb, rpm, depends

### Community 86 - "Companion Setup Documentation"
Cohesion: 0.60
Nodes (5): Browser companion enforcement, Stable unpacked Chrome identity, Pairing diagnostic privacy, Managed browser force-install policies, Temporary Firefox and Safari limits

### Community 87 - "Windows Release Job"
Cohesion: 0.33
Nodes (6): name, needs, outputs, runs-on, build-windows, installer_hash

### Community 88 - "Release Changelog Job"
Cohesion: 0.33
Nodes (6): name, outputs, runs-on, changelog, notes, version

### Community 89 - "Native Window Permissions"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 90 - "Browser Policy Mutation IPC"
Cohesion: 0.40
Nodes (4): focus_browser_extension_install(), focus_browser_extension_remove(), focus_browser_profile_require(), resolve_extension_dist_dir()

### Community 92 - "Companion Domain Rules"
Cohesion: 0.90
Nodes (3): canonicalDomains(), isUrlBlocked(), rulesForPolicy()

### Community 93 - "Release Publishing Job"
Cohesion: 0.40
Nodes (5): release, name, needs, runs-on, steps

### Community 96 - "Guarded Timer Actions"
Cohesion: 0.40
Nodes (5): TimerAction, Reset, RestartRound, Skip, Toggle

### Community 98 - "Tauri Build Hooks"
Cohesion: 0.40
Nodes (5): build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist

### Community 99 - "Blocked Page Rendering"
Cohesion: 0.50
Nodes (3): params, rawUrl, targetEl

### Community 100 - "Package Author Metadata"
Cohesion: 0.50
Nodes (4): author, email, name, url

### Community 102 - "Automatic Update Configuration"
Cohesion: 0.50
Nodes (4): plugins, updater, endpoints, pubkey

### Community 103 - "Installer Window Position"
Cohesion: 0.67
Nodes (3): windowPosition, x, y

## Ambiguous Edges - Review These
- `README WebSocket protocol` → `Opt-in loopback WebSocket control`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to
- `README unsigned release note` → `Linux release artifact GPG verification`  [AMBIGUOUS]
  README.md · relation: conceptually_related_to

## Knowledge Gaps
- **599 isolated node(s):** `version`, `package-ecosystem`, `directory`, `interval`, `day` (+594 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 997 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **102 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FocusController` connect `Emergency Release IPC` to `Focus Controller and Validation`, `Focus Persistence and Migrations`, `Background Timer Engine`, `Emergency Hold Timing`, `Desktop IPC Commands`, `Passphrase Hashing`, `Focus State Machine`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `version`, `package-ecosystem`, `directory` to the rest of the system?**
  _599 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Architecture and Focus Plans` be split into smaller, more focused modules?**
  _Cohesion score 0.05242566510172144 - nodes in this community are weakly interconnected._
- **Why does `removeBrowserExtension()` connect `Browser Setup UI and IPC` to `Browser Policy Mutation IPC`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Should `Audio and Theme Loading` be split into smaller, more focused modules?**
  _Cohesion score 0.05384615384615385 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `README WebSocket protocol` and `Opt-in loopback WebSocket control`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `README unsigned release note` and `Linux release artifact GPG verification`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
## Scope and evidence limits

Snapshot of the current uncommitted working tree, not just HEAD. 208 detected code files and 18 current documents were selected; 9 code files also received manual semantic boundary extraction. Archived OpenSpec prose proposals (metadata file nodes remain), images, audio, generated output, dependencies and build directories were excluded. File-only nodes record existence, not complete behavior. AST symbol extraction represented 140 code files. IPC, native messaging and WebSocket links need current-source confirmation. EXTRACTED describes source evidence; it does not mean the installed extension was exercised.

Token cost: exact host-agent and subagent usage is unavailable. The generated 0 input/output counters are placeholders, not a zero-cost claim. AST extraction used no model API.

`graphify-out/` was written into the working tree and is not currently ignored. No application source was changed by this mapping task.

Graph health counters: `{"dangling_endpoint_edges": 445, "missing_endpoint_edges": 0, "self_loop_edges": 1, "directed_same_endpoint_collapsed_edges": 385, "undirected_same_endpoint_collapsed_edges": 387}`. See graph-health.txt for details. graph.json retains original links to preserve parallel relationship evidence; community analysis may collapse same-endpoint relationships.

Raw extraction flagged 445 dangling endpoint references and 1 self-loop; the built export synthesizes reference nodes and has zero unresolved link endpoints. This makes the map navigable, not complete or independently validated. Community analysis collapses 385 same-endpoint relationships; exported links preserve their separate evidence where available.
