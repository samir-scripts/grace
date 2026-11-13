[Chrome companion release](chrome-companion-release-plan.md) — promoted through reviewed dev PR to stage; release held for Windows/Linux x64 packaged acceptance.

# Implementation plans

[macOS Chrome acceptance through Tart](chrome-tart-acceptance-plan.md) — passed actual packaged Chrome acceptance on macOS, including forced app recovery; evidence collected and clone stopped.

[Chrome extension release readiness](chrome-extension-release-readiness-plan.md) — macOS and Linux ARM64 packaged Chrome matrices passed on disposable guests; Linux x64 and Windows have not been tested. A custom Chrome data directory cannot discover the default native-host registration. Store stays Private and unsubmitted.

[grace. UI consistency and accessibility](grace-ui-consistency-plan.md) — implementation and verification ledger. [Batch 5 native/signing report](grace-ui-batch5-report.md): native development checks, Clippy and production build pass; signed 1.1.0 is approved and a packaged Zen update/reconnect passed; Firefox 115 support is retained with its consent fallback; pre-consent appearance and remaining browser acceptance are open.

[Reproducible Tart Zen/Discord acceptance](tart-focus-acceptance-plan.md) — implemented and verified in batches. [Evidence report](tart-focus-acceptance-report.md) records two-clone provisioning, native website/Discord checks, completion/reset repairs, explicit inconclusive cases and existing Clippy blockers.

[Zen installed-extension diagnosis / OMP handoff](zen-extension-omp-handoff.md) — active follow-up. Source identity correction is distinct from installed-extension acceptance; real Zen/Firefox enforcement verification remains outstanding. Project map: `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.html`.

[Zen diagnosis and unsigned network alternatives](zen-network-alternatives-report.md) — current evidence, guest-only prototype outline, and outstanding acceptance gates.

[Gecko companion CSP repair plan](zen-gecko-csp-repair-plan.md) — AMO unlisted version 1.0.0 is approved. Signed guest Firefox/Zen persistence and partial active enforcement are verified. [Native guest assistance](native-guest-assistance-2026-11-08.md) verified packaged Firefox 115.44 pause/retry, emergency hold and natural final/domain restoration, but exposed a protected-session Command-Q escape now handed to OMP. Correct-passphrase UI, earlier Firefox 115 compatibility and broader enforcement gates remain open; see the latest acceptance section.

[Focus Sessions master plan](focus-sessions-master-plan.md) — completed.

## Progress

- Plan persistence and agent guidance: completed.
- [x] [01-db-and-persistence](subplans/01-db-and-persistence.md)
- [x] [02-domain-validation-security](subplans/02-domain-validation-security.md)
- [x] [03-state-machine-escape](subplans/03-state-machine-escape.md)
- [x] [04-native-enforcers-macos-windows](subplans/04-native-enforcers-macos-windows.md)
- [x] [05-timer-controller-interception](subplans/05-timer-controller-interception.md)
- [x] [06-ipc-contract-stores](subplans/06-ipc-contract-stores.md)
- [x] [07-ui-selector-titlebar](subplans/07-ui-selector-titlebar.md)
- [x] [08-ui-settings-sessions](subplans/08-ui-settings-sessions.md)
- [x] [09-ui-emergency-exit](subplans/09-ui-emergency-exit.md)
- [x] [10-e2e-system-tests](subplans/10-e2e-system-tests.md)

- Focus startup follow-up: browser participants are checked before applications are closed; the Rust bridge is exercised with an isolated Chromium extension, and the macOS application monitor has an opt-in disposable GUI fixture. Native timer-window and other-platform end-to-end checks remain outstanding.

## Execution decisions

- Existing uncommitted AGENTS.md migration is preserved; implementation uses feature/focus-sessions in this workspace.
- Rust monotonic time, not frontend elapsed milliseconds, authorizes emergency holds.
- Cargo accepts one test filter per command; run validation and security filters separately. TypeScript uses boolean, not bool.
- Native hosts-file blocking has DNS/connection coverage limits; do not claim encrypted DNS or established sockets are blocked. Privileged runtime checks require authorization.
- Progress below records only observed evidence, not expected results.
