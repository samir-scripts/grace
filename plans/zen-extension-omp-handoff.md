# Zen installed-extension diagnosis: OMP handoff

> For OMP agents: continue the existing approved Zen diagnosis effort with `systematic-debugging`, then `executing-plans`. Review this map and the existing session-local `zen-extension-diagnosis-plan.md` before edits. This handoff supplies investigation tasks; it does not establish a runtime root cause or grant permission to modify the personal browser installation.

**Goal:** reproduce the reported installed-extension failure, identify the first failing boundary, apply one evidence-backed repair, and verify actual Zen and Firefox acceptance and blocking.

**Architecture:** Svelte Settings calls typed IPC; Rust manages native-host registration, enterprise policy, authenticated loopback browser control and enforcement. The companion pairs through native messaging or stored credentials, identifies its browser, connects to the dedicated WebSocket bridge and acknowledges DNR rule revisions. Rust waits for acknowledgements before starting its application monitor.

**Stack:** Tauri 2/Rust, Svelte 5/TypeScript, Gecko MV3 WebExtension, native messaging, axum WebSocket bridge.

**Specification:** the user's reported installed-extension failure and existing OMP session `01a1a401-c92e-77eb-a6e1-3da510d1ff47`, “TIMER: Diagnose and fix Zen extension.” Current status: **not ready to merge**.

## Constraints

- Preserve all pre-existing uncommitted changes. Do not reset, clean, stage the whole tree, or commit unrelated Rust/UI/settings changes.
- Do not run website enforcement against the personal desktop. An empty blocked-app list is insufficient isolation: Rust automatically adds installed browsers without a connected companion to the application-monitor target list.
- A separate browser profile alone cannot contain bundle-ID process termination, application-bundle policy writes, or user-wide native-host registration. Use a disposable macOS guest or explicitly disposable machine for the full flow.
- Keep browser control at `127.0.0.1:<port>/focus-browser`, default 1421. This is distinct from the optional external timer `/ws` server.
- Keep tokens, profile identifiers, browsing URLs and native stdout payloads out of shared logs. Native stdout must remain framed protocol only; diagnostics belong on stderr.
- Keep temporary development installation and persistent signed installation as separate acceptance results. Do not disable signing enforcement as a release acceptance shortcut.
- Treat EXTRACTED as source evidence, INFERRED as an inference, and AMBIGUOUS as unresolved. None proves installed runtime behavior.

## Project map and tools

Use `graphify-out/graph.html` for navigation, `graphify-out/GRAPH_REPORT.md` for communities and limitations, and `graphify-out/graph.json` for machine queries. The map covers 208 detected code files and 18 current architecture/plan documents; AST symbols cover 140 code files, with file nodes for the remainder. Browser boundary links have additional semantic extraction. Archived proposals and media assets are excluded. See `graphify-out/graph-health.txt` before treating paths as complete.

```sh
graphify query "tryNativePairing detectBrowserKind applyPolicy" --budget 5000
graphify explain "tryNativePairing"
graphify path "connect()" "detectBrowserKind()"
```

If a query misses a dynamic boundary, inspect current source. Regenerate changed-code edges with `graphify update .`; semantic boundary changes require re-extraction too. Do not rebuild over a larger graph without checking the shrink guard.

| Surface / boundary | Owning files and symbols | What to inspect |
| --- | --- | --- |
| Composition | `src-tauri/src/lib.rs::run`, `src-tauri/src/main.rs` | Persistent BrowserBridge and FocusController construction; command registration |
| Session UI | `src/lib/components/settings/sections/SessionsSection.svelte`, `BrowserSetup.svelte::handleInstall` | Registers native host, then asks Rust to install policy, then refreshes status |
| Typed IPC | `src/lib/ipc/index.ts` | `listInstalledBrowsers`, `registerNativeHost`, `installBrowserExtension`, `getBrowserSetup`, `requireBrowserProfile` |
| Native commands | `src-tauri/src/commands.rs` | `resolve_extension_dist_dir`, `focus_native_host_register`, `focus_browser_extension_install`, `focus_browser_setup_get` |
| Browser inventory | `src-tauri/src/focus/browser_detector.rs` | `browsers_from_catalog`, `compute_policy_path`, `detect_installed_browsers` |
| Enterprise policy | `src-tauri/src/focus/enterprise_policy.rs` | Install/merge/remove policy; `is_policy_installed_at_path` only checks policy presence |
| Native host | `src-tauri/src/focus/native_messaging.rs`, `src-tauri/src/bin/pomotroid-native-host.rs` | Executable registration, Mozilla allowed extension ID, config path, framed I/O |
| Companion startup | `extensions/focus/background.js::bootstrap`, `native-pairing.js::tryNativePairing` | Native config → storage → connection, or stored credentials after native failure |
| Browser identity | `extensions/focus/browser-identity.js::detectBrowserKind` | Gecko `getBrowserInfo().zen` object, UA fallback, Firefox fallback |
| Browser bridge | `src-tauri/src/focus/browser.rs` | `handle_socket`, `BrowserBridge::apply_blocking`, `effective_blocked_apps`, lease health |
| Rule enforcement | `extensions/focus/background.js::applyPolicy`, `policy.js::rulesForPolicy` | DNR update, existing-tab redirect, revision ACK/error |
| Timer integration | `src-tauri/src/timer/mod.rs`, `focus/controller.rs` | Guarded start, apply/release, recovery, supervisor |
| Process enforcement | `focus/enforcer/apps.rs`, `focus/enforcer/macos.rs` | ApplicationMonitor and bundle-ID termination; full-flow guest only |
| Packaging | `scripts/build-browser-extensions.mjs`, `extensions/firefox/manifest.json`, `src-tauri/tauri.conf.json` | Unsigned ZIP/XPI generation, Gecko ID, bundled extension resources and native host |
| Other modules | `timer/`, `db/`, `settings/`, `themes/`, `audio/`, `tray/`, `websocket/`, routes `/`, `/settings`, `/stats` | See AGENTS.md and graph communities; avoid unrelated changes |

## Fresh evidence from this handoff run

- [x] Read current plans, inspected source across UI → IPC → Rust → companion protocol.
- [x] Installed Codex skills `using-superpowers`, `systematic-debugging`, `writing-plans`, `verification-before-completion` through skill-installer. OMP already has corresponding workflow skills and Graphify.
- [x] `node --test extensions/tests/browser-identity.test.mjs extensions/tests/native_pairing.test.mjs extensions/tests/policy.test.mjs extensions/tests/policies.test.mjs`: **20 passed, 0 failed**.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib effective_blocked_apps`: **3 passed, 0 failed**; existing compiler warnings remain.
- [x] Existing built Firefox XPI contains an identity module byte-for-byte equal to source. SHA-256: `60e2f40a3876e63e21447195b966ff2f40a8131a4237623fc2c70c9f7f85ea1e`. No `META-INF/` signature entries. The build script generates an unsigned archive.
- [x] Development native-host binary exists in `src-tauri/target/debug/`; packaged-app placement and launch remain unverified.
- [ ] No new Zen/Firefox installed-extension run, original screenshot reproduction, guest setup, signed package acceptance, website-blocking or restoration proof.

The earlier OMP report records successful build/type checks and native framing tests. Those were not rerun here. An initial Rust filter in this handoff run matched zero tests; only the corrected three-test run above counts as browser-target verification.

## Review focus

1. Policy JSON exists while the browser rejects or never loads the unsigned XPI: UI must not imply runtime acceptance.
2. Native host launches but never replies/disconnects: stored-credential fallback must not wait forever.
3. Development binary is present but the distributed app lacks an executable host at the registered absolute path.
4. Connected Zen must not become an automatic browser-termination target; explicitly selected Zen targets retain their intended semantics.
5. Rule ACK proves an API call completed; real blocked navigation, allowed navigation and restoration need independent observations.

## Work packets for the existing OMP agents

### Agent A: disposable environment and package acceptance

**Own:** environment/evidence only initially; packaging source changes only after a demonstrated failure. Coordinate shared files with Agent B.

- [ ] Provision a working disposable macOS guest. Recheck available tools by executing their version/list commands; a `which` result is insufficient. Tart is a candidate on supported Apple Silicon/macOS hosts, not a tool installed by this handoff. Verify available disk space and guest requirements before a large image download. Use the official [Tart quick start](https://tart.run/quick-start/).
- [ ] Install official Zen and Firefox builds inside the guest. Record OS/build, browser versions/channels, app paths, repository revision plus dirty patch provenance, app build and XPI hash. Keep host browsers/profiles and policies out of the guest.
- [ ] Use Mozilla `web-ext lint --source-dir extensions/dist/firefox` to identify manifest/API problems. Use `web-ext run --help` for the installed version's custom binary/profile options. [Official command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).
- [ ] First reproduce the actual application's install action on the generated unsigned package. Capture `about:policies` Active/Errors, add-on presence/enabled state in `about:addons` and `about:debugging`, and the exact error with a redacted screenshot. A policy entry alone is not acceptance.
- [ ] Separately load the temporary companion for transport diagnosis. Label it temporary; it cannot satisfy persistent installation acceptance.
- [ ] Obtain an AMO-signed package through the authorized owner workflow before persistent Firefox release acceptance. Self-distributed/unlisted signing is supported; do not invent AMO credentials or publish a listing. Mozilla documents signing requirements and options in [Signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/). Signing/submission is a separate external action; coordinate owner credentials and any agreement step.
- [ ] In the actual packaged Pomotroid app, inspect native-host presence, executable mode/architecture, registered absolute path, allowed ID `focus@pomotroid.local`, and config location. `tauri.conf.json` explicitly lists extension resources; do not assume that merely declaring a Cargo bin causes the native host to be shipped where `focus_native_host_register` searches. Verify the archive/app contents.

**Deliver:** environment inventory, package hashes, exact install result and first failed stage, with source changes only if root cause is established.

### Agent B: correlate the first failing boundary

**Own:** `background.js`, `native-pairing.js`, `browser-identity.js`, and corresponding tests; coordinate Rust/IPC changes through the main agent.

- [ ] Enable desktop Verbose Logging in the guest. Capture a single reproduction from install/startup through failure using extension inspector + Browser Console/native stderr + desktop logs. Record timestamps and policy revisions, redact tokens/URLs/profile IDs.
- [ ] Compare the observed stages with the table below. Stop at the first missing or failing boundary and test one hypothesis at a time.
- [ ] If native pairing stalls, demonstrate it with a port that neither replies nor disconnects. Source currently has no timeout around `tryNativePairing`, and `bootstrap` awaits it before calling `connect`. Only after this is observed as relevant, add a bounded timeout regression and late-message/single-settlement tests, then the smallest repair. Preserve callback and Promise storage behavior.
- [ ] If no native launch occurs, compare actual registration with browser-native-host resolution and executable permissions. Manual stored-token pairing is a diagnostic branch, not proof that auto-pairing works.
- [ ] If `hello_sent` reports Zen but Rust rejects it, inspect token/profile/protocol and capture only redacted reason codes. If identity is Firefox, inspect the actual runtime metadata of this Zen build; do not assume all forks expose identical fields.
- [ ] If a policy reaches the companion but fails, record DNR failure stage and browser API error locally; reduce to a minimal rule and test that browser/version. Do not weaken ACK validation or start app termination earlier.
- [ ] If the UI's installed status is misleading, add a failing regression at the detector/IPC/UI boundary for policy-present but companion-not-connected. Design status names around observed policy, connection and enforcement evidence; migrate Rust/TS types and all consumers together if changing the contract.

| Last observed stage | Investigate next |
| --- | --- |
| No `bootstrap` | Package rejected, background module failed, wrong extension/profile, inspector not attached |
| `native_attempt` only | Host path/launch, silent host, missing config, indefinite pairing wait |
| `native_failed` | Redacted reason: host not found/forbidden/not executable/storage failure; then stored credentials |
| `native_config_received` | Storage write and profile continuity |
| `credentials_checked` missing credentials | Auto-pairing or options storage; no WebSocket should be claimed |
| `socket_connecting` without open | Dedicated bridge listener, port, browser environment |
| `hello_sent` / `hello_rejected` | Browser identity, protocol 1, token/profile acceptance |
| `policy_received` / `policy_failed` | Rule APIs, existing-tab logic; stage is get_rules/update_rules/query_tabs |
| `ack_sent` without matching `ack_received` | Connection lifetime, revision/profile correlation, stale client |
| ACK received then start fails | Other required participants, monitor startup, controller rollback |
| Active but navigation succeeds | Real URL/subdomain/resource coverage, extension context, actual dynamic rules |

**Deliver:** redacted timeline, reproducible root-cause statement, regression showing red before repair and green after, and actual installed-browser retest.

### Agent C: independent acceptance and regression review

**Own:** evidence/review and new guest-only acceptance test; review shared edits before committing.

- [ ] Audit test names against implementation. The Firefox case in `extensions/tests/playwright-blocking.test.mjs` checks manifest/files and rule helpers; it does **not** launch Firefox. `src-tauri/tests/e2e_browser_onboarding.rs` uses a simulated WebSocket companion. `desktop-bridge.test.mjs` launches Chromium, not Zen/Firefox.
- [ ] Reuse the concepts in `src-tauri/examples/focus_bridge_fixture.rs` and `extensions/tests/desktop-bridge.test.mjs`, but keep the existing bridge fixture in the guest too: it calls real `apply_blocking`, which can auto-target unrelated installed browsers.
- [ ] For each actual Zen and Firefox installation, prove: accepted/enabled add-on → native automatic pairing → correct browser identity → authenticated connection → active policy revision → matching ACK → blocked existing/new navigation → unrelated allowed page → release → same site loads again.
- [ ] In the guest, test disconnect, browser restart, app restart/termination, break unblock/reapply and final/emergency release. Observe actual rule cleanup and recovery behavior. A 15-second server lease constant is not proof that disconnected companion DNR rules expire; inspect/test client-side behavior explicitly.
- [ ] Run narrow regression tests after each repair; run `npm run check` and affected Rust tests when UI/IPC/Rust changes warrant them. Build the distributed app and repeat native-host and extension-resource checks after packaging repairs.
- [ ] Finish with a matrix that distinguishes temporary, persistent signed, mocked protocol, Chromium and real Gecko results. Keep merge blocked for any missing required Zen/Firefox acceptance or unverified restoration behavior.

**Deliver:** independent acceptance matrix, explicit limitations and scoped diff review. Commit only owned/approved hunks after coordinating the dirty tree.

## Merge gate

- [ ] Original installed failure captured with redacted evidence and a demonstrated cause.
- [ ] Minimal repair has a meaningful regression and passes affected checks.
- [ ] Actual Zen and Firefox acceptance, pairing, blocking and restoration observed in a disposable environment.
- [ ] Packaged native host and signed-extension distribution path verified.
- [ ] Shared-source diff ownership resolved; no unrelated edits bundled.

Until those boxes have evidence, retain **not ready to merge**. This mapping/handoff does not clear the gate.
