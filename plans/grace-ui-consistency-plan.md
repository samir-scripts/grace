# grace. UI consistency and accessibility implementation

Goal: preserve the compact timer-first design while making themes readable, controls opaque, branding consistent, extension setup clear, and navigation motion coordinated.

Architecture: resolve existing theme JSON into complete semantic colors on the frontend. Publish an allowlisted appearance snapshot through typed IPC; native messaging serves appearance independently of pairing credentials. Reuse current stores, consent state, and native window sizing.

## Constraints

- Visible brand is `grace.`; internal IDs, binary name, database paths, browser IDs, and upstream attribution stay compatible.
- No new component framework or animation dependency; Mona Sans stays bundled.
- Theme files use documented hex colors; unsafe CSS and alpha values are excluded from appearance snapshots.
- Native acceptance requires the current packaged app; browser fixtures cannot establish native behavior.
- Preserve the pre-existing dirty working tree. Changes are left uncommitted to avoid including unrelated ongoing work.

## Batches

- [x] 1: Complete theme resolution, stale-property cleanup, opaque roles, bundled foreground repair, shared focus styles and control styling. Unit tests cover all bundled theme contrast pairs and theme switching.
- [x] 2: Visible branding in desktop metadata, app surfaces, localized copy, companion metadata and notifications. Internal identity and attribution preserved; existing artwork retained.
- [x] 3: Companion layout, consent-first advanced pairing, authenticated connection display, local font, appearance-only native lookup, validated cache and visible-page refresh. Existing signed artifact remains unchanged.
- [x] 4: Statistics easing and timing tokens, concurrent destination entrance/native resize, generation cancellation, live OS motion preference, retained native resize target and default motion-test registration.
- [ ] 5: Release acceptance. Browser and Rust evidence recorded below; fresh signed companion and current-build native checks remain required.

## Verification evidence (2026-11-10)

- Theme unit regressions observed failing before implementation, passing afterward (5 tests).
- `npm run check`: 0 errors, 0 warnings.
- Final `npm test` exits 0 with local server permission: 6 unit tests, 64 extension tests, and 16 motion/rendered-contrast tests pass. The opt-in screenshot capture is skipped in the normal suite and passes separately with `GRACE_CAPTURE_LAYOUTS=1`.
- Final prescribed Rust tests exit 0 with socket permission: 156 library tests pass plus integration suites; native/guest-only cases remain ignored or filtered as documented. Linux data-path regression passes.
- Final direct `npx vite build` exits 0 (frontend compilation only).
- `npm run build` stops at the signed Gecko provenance guard: changed companion manifest/source requires a fresh signed artifact. Guard retained; direct Vite build is not release acceptance.
- Clippy fails on 12 existing findings in focus modules and the composition root. No warning suppression was added.

Rendered fixture screenshots: [timer](evidence/grace-ui-2026-11-10/timer.png), [compact](evidence/grace-ui-2026-11-10/compact.png), [enlarged](evidence/grace-ui-2026-11-10/enlarged.png), [settings](evidence/grace-ui-2026-11-10/settings.png), [statistics](evidence/grace-ui-2026-11-10/stats.png). These use mocked IPC, not the native guest. Solarized Light/Dark/custom actual settings-label contrast is checked against rendered opaque surfaces with reduced motion to avoid sampling transitional colors. Timer round text uses readable foreground while dial arcs retain round colors.

## Native baseline attempt and remaining gates

Located Tart at `.superpowers/sdd/safe-gecko-network-prototype-plan/tart.app/Contents/MacOS/tart`. Started and stopped the empty `grace-acceptance-20261110-a`, then the acceptance-report guest `grace-acceptance-7c36512e-4971-4d40-8e87-d6cbca8758fa`. Located its prior bundle at `/Users/admin/grace-acceptance/7c36512e-4971-4d40-8e87-d6cbca8758fa/Grace.app`. Mouse input reached Finder; keyboard navigation did not complete and typing returned `noWindowsAvailable`. Both guests were stopped; the clean baseline was not modified. This is guest-access evidence only, not an app UI pass.

- [ ] Obtain fresh signed Firefox companion and matching provenance; rerun full production build without bypassing its guard.
- [ ] Package current source and record executable/source identities in disposable guest.
- [ ] Inspect default/compact/enlarged timer, settings, statistics, dropdown and emergency surfaces across light/dark/auto/custom themes.
- [ ] Verify native window resize/drag, live motion disable, shortcuts, localized text and theme updates before window visibility.
- [ ] Verify signed Firefox/Zen and Chromium appearance lookup, consent, connection, withdrawal and compatibility with existing pairing.
- [ ] Windows/Linux native acceptance separately; macOS evidence cannot establish those platforms.

## Review corrections

- Resolve Linux native-host data paths from absolute `XDG_DATA_HOME` before home fallback.
- Guard asynchronous theme refreshes against out-of-order completion; resolve using current settings after loading.
- Filter extra custom keys at typed appearance IPC boundary and native reader/writer.
- Keep pre-consent appearance requests entirely separate from pairing configuration reads.


## Development startup follow-up (2026-11-10)

Reproduced `npm run tauri dev` failing in `predev`, before Vite/Rust startup: the default companion builder rejected the previously signed Firefox archive because its manifest no longer matched the updated source. Added an explicit `--development` packaging mode for `predev` and missing-dist Cargo debug fallback. It packages current unsigned source without altering the canonical signed artifact/provenance. Default and `--require-signed` verification remain strict; combining development and release flags is rejected.

Verification: 10 signed/unsigned packaging tests pass, including stale-artifact preservation and flag-conflict regressions. Actual `npm run tauri dev` started Vite at localhost:1420, completed Cargo's dev build, and launched `target/debug/pomotroid`. This does not establish signed extension installation or the native UI acceptance matrix above.


## Visual hierarchy and statistics follow-up (2026-11-10)

User screenshots exposed overly strong structural borders. Decorative separators now use a subtle opaque canvas mix independently of accessible control/focus outlines. Secondary surfaces, hover and selected colors stay closer to the canvas; the sidebar uses the same canvas throughout. Light-theme primary buttons retain readable white labels on a contrast-adjusted accent. Text contrast remains >=4.5 and control boundary roles >=3; a regression pins quieter decorative separators.

Fixed a slider regression from the opaque-control pass: range input overlays had obscured their separate colored fills. The solid track/fill now live beneath the interactive thumb layer, with an explicit visible keyboard-focus outline. Browser tests observed the pre-fix failure and now confirm fill visibility and thumb-center alignment at minimum, midpoint and maximum.

Statistics opens at 720x480 instead of the settings window's 840x520. Tabs shrink/wrap safely, statistic groups stack at compact sizes, values wrap, and charts/heatmap preserve readable dimensions with horizontal scrolling only when needed. All three tabs fit at preferred size without vertical scrolling; narrow layouts retain vertical scrolling instead of clipping. Opaque muted text replaces translucent empty-state captions.

Verification: final `npm test` exits 0 (7 unit, 66 companion, 17 motion/rendered UI and 1 statistics matrix tests; 2 opt-in capture cases skipped). Statistics matrix covers all three tabs at 720x480, 840x520, 360x478, 240x240 and 1200x800. `npm run check` has 0 errors/warnings, five focused Rust window-sizing tests pass, and direct Vite frontend compilation passes. Current light/dark/custom settings and preferred statistics screenshots are in the evidence directory. Native resize appearance remains a separate, unverified acceptance gate.


## Batch 5 execution (2026-11-10)

See [native acceptance and signing automation report](grace-ui-batch5-report.md) for current executable identity, native UI observations, interrupted-resize fixes, compact-titlebar and accessibility repairs, and restored guest state. Strict Clippy now passes. Companion version 1.1.0 and automated unlisted signing are prepared; account email verification is required before storing real API credentials or obtaining the new signed artifact. Batch 5 remains open for signed-package/native platform gates.


## Browser icons and theme-aware badges (2026-11-10)

- [x] Browser detection carries an optional catalog ID through Rust/TypeScript; native PNG icons reuse the existing allowlisted, cached application-icon command. Missing IDs, missing icons, command failures and image decode failures use a neutral globe.
- [x] Default remains neutral; Installed uses an accent tint and Active uses the selected theme short-round palette with contrast-adjusted text. Badge spacing is 8px with wrapping; Active includes a connection dot. Both badge pairs meet >=4.5:1 text contrast across bundled and tested custom themes.
- [x] Active means any matching browser profile is connected, independent of the default browser and extension policy installation. Connected profile rows use the same localized Active treatment; Offline is localized in all eight locales.
- [x] Six rendered regressions cover native-image success/null/rejection/decode failure, multiple profiles, refresh disconnect, live resolved theme changes, contrast and German text at 330px. Registered in the default npm test suite.

Observed verification: final `npm run check` reports 0 errors/warnings; `npm test` passes including the six new browser tests; prescribed Rust tests pass with loopback permission; `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` passes. Initial restricted runs failed on local sockets, then passed with permission. Independent change review found no actionable issues. Existing whitespace findings in unrelated browser/background files remain untouched.

A debug app was built with `npx tauri build --debug --bundles app --config '{"build":{"beforeBuildCommand":"npx vite build"}}'` for native-only inspection, leaving the normal signed production build command unchanged. This is development evidence, not signed release acceptance. Launched this bundle in the existing disposable Tart guest `grace-acceptance-7c36512e-4971-4d40-8e87-d6cbca8758fa`; opened settings and visually confirmed the actual installed Zen icon and themed Installed badge. Guest has Zen only, and its companion was offline: native Chrome icons and native Active/disconnect transitions remain unverified. Windows/Linux native acceptance remains separate. Guest stopped after inspection.

Evidence: [native Zen](evidence/grace-browser-badges-2026-11-10/native-zen.png), [mocked light](evidence/grace-browser-badges-2026-11-10/fixture-light.png), [mocked dark](evidence/grace-browser-badges-2026-11-10/fixture-dark.png). Fixture icons are intentional test images, not native-logo evidence.

## CI Chromium provisioning follow-up (2026-11-12)

Build / Test runs [43147211238](https://github.com/samir-scripts/grace/actions/runs/43147211238) and [43147205751](https://github.com/samir-scripts/grace/actions/runs/43147205751) failed when the motion suite launched Chromium: Playwright's `chromium_headless_shell-1248` executable was missing. Both workflows installed the npm package but omitted browser provisioning.

- [x] Added `npx playwright install --with-deps chromium` immediately after `npm ci` in Build / Test's `quality-gate` and Release's `release-check`. Packaging-only jobs are unchanged.
- [x] Parsed both workflows as YAML and checked that browser installation occurs once per quality gate, immediately after npm installation and before `npm test`, with no installation in other jobs. `git diff --check` passes.
- [x] Local macOS `npm run check` reports 0 errors and 0 warnings. Full `npm test` exits 0, including motion, statistics layout and browser setup. The initial restricted run could not bind the local test server (`EPERM`); rerunning with local browser/server access passed.
- [ ] Fresh Ubuntu installation and full CI quality-gate completion remain unverified. Local tests used existing browser binaries; they do not prove Linux dependency installation. No remote workflow was triggered and Rust checks were not rerun for this workflow-only change.


## Linux compilation guard follow-up (2026-11-12)

Both PR quality gates advanced beyond frontend tests after Chromium provisioning, then failed Linux Clippy with 13 diagnostics. Platform-only helpers and imports remained compiled on Linux; browser policy paths also contained Linux-only unreachable tails and an unused executable argument.

- [x] Guarded application-monitor internals and catalog replacement/normalization for macOS, Windows, or unit tests; guarded catalog traversal for its supported platform callers and the macOS backend import for macOS.
- [x] Split policy-path resolution into mutually exclusive platform implementations. Linux Firefox/Zen paths and unsupported application discovery/interception behavior are preserved. Added Linux policy-path and unsupported-monitor regression tests.
- [x] Local macOS `cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings` exits 0. Full `cargo test --locked --manifest-path src-tauri/Cargo.toml -- --skip test_accessibility_commands_callable` exits 0 with loopback access. The first restricted run failed three tests on socket permission errors; the permitted rerun passes. Luna review found no defects; `git diff --check` passes.
- [ ] Linux and Windows execution, including the new Linux-specific tests, remains pending. Only the macOS Rust target is installed and Docker daemon is stopped. No updated PR run has been triggered for these local changes; native enforcement acceptance remains separate.
