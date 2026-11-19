# AGENTS.md

## Project and working approach

Grace is an offline-first, themeable Pomodoro desktop app and focus blocker: **Tauri 2 + Rust**, **SvelteKit + Svelte 5 + TypeScript**, and SQLite. It is an independent fork of Pomotroid that adds authenticated browser focus blocking, native application interception, emergency exit safeguards, and a 3-branch CI/CD workflow (`dev`, `stage`, `release`).

Before changing behavior, trace the route/component → typed IPC wrapper → Rust command → owning module. Reuse existing patterns, keep changes narrow, and verify the affected desktop behavior. Frontend-only rendering cannot prove native IPC, tray, audio, or window behavior.

For a cross-layer change, start with the [architecture guide](docs/architecture.md) and verify the linked owner in source. For user-visible changes, update the relevant task in the [user guide](docs/user-guide.md).

## Plans and Roadmaps

Before multi-step work, check `plans/README.md` and the relevant master plan and subplans in `plans/`. They record completed work, verification evidence, remaining steps, and blockers across sessions. Update their progress as work lands; do not repeat completed steps or treat planned checks as passing evidence.

## Entry points

| Entry | Responsibility |
| --- | --- |
| `src-tauri/src/main.rs` → `pomotroid_lib::run()` | Desktop executable entry. Preserve the Windows release subsystem attribute. |
| `src-tauri/src/lib.rs` → `run()` | Tauri composition root: plugins, DB/defaults, managed state, timer/audio/tray, theme watcher, shortcuts, optional WebSocket server, platform window lifecycle, and command registration through `generate_handler!`. |
| `src/app.html` | SvelteKit HTML shell. |
| `src/routes/+layout.ts` | Disables SSR; this is a static desktop SPA, not a Node server. |
| `src/routes/+layout.svelte` | Shared layout and context-menu suppression. |
| `src/routes/+page.svelte` (`/`, window `main`) | Composes the timer, settings and statistics views; initializes state, shortcuts, resizing and compact mode. |
| `src/lib/stores/navigation.ts` | Active timer/settings/statistics view and navigation within `main`. |
| `src/lib/components/Titlebar.svelte` | Switches views and exposes main-window controls. |
| `src/lib/ipc/index.ts` | Typed frontend command/event boundary. |
| `src-tauri/src/commands.rs` | Rust IPC handlers, including timer, settings, sessions/stats, audio, diagnostics and updates. |
| `src-tauri/src/websocket/mod.rs` → `start()` | Optional external-control entry at `127.0.0.1:<configured port>/ws`, using axum. Preserve opt-in and loopback binding. |

Build/development entry points:

- `package.json`: authoritative npm scripts and frontend dependencies.
- `vite.config.js`: SvelteKit + Paraglide plugins, fixed development port 1420, Tauri host/HMR configuration.
- `svelte.config.js`: static adapter, `index.html` fallback and `$paraglide` alias.
- `src-tauri/tauri.conf.json`: native window, build hooks, bundle, CSP and updater configuration.
- `src-tauri/build.rs`: build version/SHA metadata and `tauri_build::build()`.
- `.github/workflows/build.yml`, `.github/workflows/nightly.yml`, `.github/workflows/release.yml`, `.github/workflows/codeql-analysis.yml`: CI, nightly drafts, release and security analysis.

## Core modules

### Frontend

| Location | Responsibility |
| --- | --- |
| `src/lib/components/Timer.svelte` | Timer composition and event-driven UI; `TimerDial.svelte`, `TimerDisplay.svelte`, `TimerFooter.svelte`, and `MiniControls.svelte` render its surfaces. |
| `src/lib/stores/timer.ts`, `src/lib/stores/settings.ts` | Shared reactive frontend timer/settings state. Rust owns timing and persistence. |
| `src/lib/types.ts` | TypeScript mirrors of serialized Rust data, with snake_case field names. |
| `src/lib/stores/theme.ts` | `applyTheme()` sets CSS custom properties on `:root`. |
| `src/lib/utils/theme.ts` | Active theme resolution, including OS light/dark preference. |
| `src/lib/stores/appearance.ts`, `src/lib/stores/windowMaterial.ts` | Interface style/font and acknowledged native material lifecycle. |
| `src/lib/components/settings/SettingsView.svelte`, `AppearanceCustomization.svelte` in the same directory | Settings composition and independent style/font/transparency controls. |
| `src/lib/components/settings/sections/` | Timer, appearance, notifications, shortcuts, system and about settings. |
| `src/lib/components/stats/` | Daily, weekly and yearly statistics views. |
| `src/lib/utils/localShortcuts.ts` | Focused-window keyboard shortcuts, distinct from Rust global shortcuts. |
| `src/lib/utils/platform.ts` | Platform-specific UI decisions. |
| `src/lib/locale.svelte.ts`, `src/lib/utils/locale.ts` | Reactive locale switching and locale resolution. |
| `src/app.css`, `static/fonts/`, `static/themes/` | Global tokens, embedded typography and bundled theme assets. |

### Rust (`src-tauri/src/`)

| Module | Responsibility |
| --- | --- |
| `timer/mod.rs` | Tauri-managed `TimerController`, `TimerSnapshot`, coordination and frontend event synchronization. |
| `timer/engine.rs` | Background timer engine. |
| `timer/sequence.rs` | `SequenceState`, round advancement and round counters. |
| `settings/mod.rs`, `settings/defaults.rs` | `Settings`, SQLite key mappings, typed load/save and default seeding. |
| `db/mod.rs`, `db/migrations.rs`, `db/queries.rs` | SQLite connection, schema migrations, session persistence and statistics queries. |
| `audio/mod.rs` | rodio playback and custom sound-file management; audio may be unavailable without preventing startup. |
| `notifications/mod.rs` | OS notifications. |
| `shortcuts/mod.rs` | Global shortcut registration through tauri-plugin-global-shortcut. |
| `themes/mod.rs`, `themes/watcher.rs` | Bundled/custom theme loading and custom-directory watching. |
| `window_material.rs`, `window_view.rs` | Native Glass capability/accessibility policy and per-view window sizing. |
| `fonts/mod.rs` | Local custom-font import, storage and reads. |
| `focus/controller.rs`, `focus/browser.rs`, `focus/browser_auth.rs`, `focus/enforcer/`, `focus/escape.rs` | Focus lifecycle, authenticated browser integration, app enforcement and emergency exit. |
| `tray/mod.rs` | Tray icon/menu, timer display and tiny-skia icon rendering. |
| `websocket/mod.rs` | Optional axum WebSocket control and event broadcasts. |

## Contracts and change rules

### IPC and state synchronization

Route backend commands and event subscriptions through `src/lib/ipc/index.ts`; keep `invoke()` out of components. Register new Rust commands in `src-tauri/src/lib.rs`. Fallible commands use `Result<T, String>`; some timer commands return snapshots or unit directly.

`src-tauri/capabilities/default.json` covers the **main** window. Review permissions when adding native/plugin APIs and grant only the required capabilities; custom command registration and plugin permission grants are separate concerns.

| Rust event | Payload |
| --- | --- |
| `timer:tick` | `{ elapsed_secs, total_secs }`, every second while running |
| `timer:paused`, `timer:resumed` | `{ elapsed_secs }` |
| `timer:round-change`, `timer:reset` | Full Rust `TimerSnapshot` / frontend `TimerState` |
| `settings:changed` | Full `Settings` |
| `themes:changed` | `Theme[]` |
| `sessions:cleared` | No data |

Keep `src/lib/types.ts` and consumers synchronized with serialized Rust structures. Clean up event listeners on unmount. Settings changes propagate through shared state and remain consistent when switching views.

### Settings, persistence and timer

- SQLite settings are string key/value pairs. Some DB keys differ from struct fields (for example `work_rounds` → `long_break_interval`); inspect the mappings before writing settings.
- **Durations are stored and exposed in seconds.** Migration 2 converted legacy minute keys; do not reintroduce a minutes conversion at the IPC boundary.
- **Volume is stored as 0–100**, converted to **0.0–1.0** in Rust `Settings` and frontend state.
- New settings require defaults, typed loading, TypeScript fields, UI/IPC callers, and any needed live-application side effects in `settings_set`. The persistence function accepts key/value pairs; not every setting has a dedicated match arm.
- Add schema changes as a new `MIGRATION_N` and corresponding version-gated step in `db/migrations.rs::run()`; preserve existing-user data.
- The timer runs in a background thread. Keep `SequenceState.work_rounds_total` synchronized with `Settings.long_break_interval` through `TimerController::apply_settings()`. Preserve running/paused/idle semantics when reconfiguring durations.
- Verify session recording and statistics when changing completion, skip, restart or reset behavior.

### Themes and localization

Built-in themes are JSON in `static/themes/`; custom themes live in `{app_data_dir}/themes/`. Each has `name` and `colors` (CSS custom-property keys with `--` prefixes). The Rust watcher emits `themes:changed`; apply changes through the existing theme store and resolver.

Paraglide configuration lives in `project.inlang/settings.json`; **message sources are `src/messages/{locale}.json`**. Run `npm run paraglide:compile` after message changes to regenerate `src/paraglide/`. Import messages from `$paraglide/messages.js`; use `setLocale()` from `src/lib/locale.svelte.ts` for reactive locale changes rather than Paraglide's setter directly. Treat generated output as generated, not hand-maintained source.

## Secrets and signing

- Keep real keys and credentials out of assistant and tool output, logs, errors, screenshots, clipboard, command-line arguments, artifacts, reports and tests. Use placeholders in examples; sanitize script output and errors before displaying or retaining them. Do not dump environments, credential files or credential-bearing HTTP responses; use redacted presence checks.
- Never stage, commit or push real secrets on any branch, including ignored, force-added or already tracked files. Before any commit, inspect tracked and staged **file names** and use `git check-ignore` to confirm secret files are ignored; resolve any exposure before proceeding without printing values.
- Store AMO signing credentials only in an owner-readable ignored `.env.amo.local` (mode `0600` or stricter) or a secure environment secret store. `scripts/sign-firefox.mjs` reads those sources; do not put credentials in its arguments. Verify signing source archives exclude environment files and other secrets before submission.

## Preserve the application aesthetic

The timer dial is the visual focus. Extend the existing compact desktop design rather than introducing a generic dashboard or a new design system.

- Reuse `src/app.css` tokens, round colors, component spacing and transition timing. See [appearance defaults and material behavior](THEMES.md). Prefer theme variables and derived chrome colors over hardcoded foreground/background values.
- Keep the custom titlebar and platform-specific behavior. On macOS native decorations remain enabled with an overlay titlebar for event handling/tiling; other platforms disable decorations in Rust setup. Do not apply a blanket decorations-off change.
- Compact mode is `w < 300 || h < 300`: hide the regular label/footer/play-pause layout while retaining the dial and `MiniControls`. Preserve intentional bottom whitespace and scaling behavior.
- Apply `uiScale` using CSS `zoom` on `.timer`, not `transform: scale`.
- Slider fill/thumb alignment uses `calc(frac * (100% - 14px) + 7px)`.
- Apply the active theme before showing `main` to avoid a white flash. Preserve light, dark, automatic and custom-theme behavior across views.
- For UI changes, inspect the actual surface before and after: default timer size, compact size, enlarged window, settings and stats where affected. Check keyboard focus/shortcuts, readable contrast, localized text fit and motion accessibility. Native drag/resize/close behavior requires Tauri, not only a browser preview.

## Skills to use

Use installed skills by name and read their current instructions before acting; skill availability depends on the agent environment. The project does not bundle or install these skills.

| Trigger | Skill guidance |
| --- | --- |
| Starting work / choosing a workflow | **Superpowers**: `using-superpowers` routes to relevant process skills. Use `brainstorming` for new features/design work, `writing-plans` for multi-step implementation, and `executing-plans` for an agreed plan. |
| Architecture, dependencies, entry points or cross-module tracing | **`graphify`**: query `graphify-out/graph.json` if present; build/update a graph when requested or when broad structural analysis warrants it. For a targeted lookup with no graph, use source inspection. Preserve EXTRACTED/INFERRED/AMBIGUOUS provenance; a graph is a map, not a substitute for current source. |
| New or reshaped UI | **`frontend-design`** for aesthetic intent; **`frontend-ui-engineering`** for Svelte implementation, accessibility and responsive behavior. The existing product aesthetic takes precedence over generic redesign suggestions. |
| UI critique, polish, theme consistency | **`impeccable`**, **`ui-ux-pro-max`** or **`ui-styling`**, as appropriate. Keep existing tokens/components; do not introduce a component framework merely because a skill mentions one. |
| Browser-rendered UI validation | **`browser-testing-with-devtools`** or **`webapp-testing`**; also exercise the actual Tauri app for native features. |
| Bug, regression or failing check | **`systematic-debugging`** before edits; **`test-driven-development`** for regression coverage where applicable. |
| IPC/type/module boundary changes | **`api-and-interface-design`**; preserve Rust/TypeScript parity and migrate affected callers together. |
| Reviewing and finishing changes | **`requesting-code-review`** and **`verification-before-completion`**; report only observed checks and explicit limitations. |
| Editing this guide | **`writing-for-agents`**; keep guidance source-backed and scoped, with one authoritative rule per concern. |

## Commands and verification

Run from the repository root:

```bash
npm run tauri dev            # Vite + native desktop app
npm run tauri build          # Production desktop build
npm run dev                  # Frontend-only Vite; native IPC unavailable
npm run build                # Static frontend production build
npm run check                # Paraglide compile + SvelteKit sync + Svelte/TS checks
npm test                     # Frontend unit + browser extension test suites
npm run test:native-glass    # Real macOS system WebKit regression
npm run test:guest-focus     # Guest tooling tests; does not boot a VM
npm run paraglide:compile    # Regenerate localization output
npm run format               # Prettier --write . (repository-wide; avoid unrelated churn)
cargo test --manifest-path src-tauri/Cargo.toml -- --skip test_accessibility_commands_callable
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

PRs merge to `dev`, then promote to `stage` for cross-platform artifact testing and to `release` for stable tags. The nightly workflow builds a reviewed `dev` commit separately. See [release process](CONTRIBUTING.md#release-process) and [verification commands](#commands-and-verification).
