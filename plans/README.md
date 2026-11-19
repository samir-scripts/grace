[Chrome companion release](chrome-companion-release-plan.md) — historical acceptance plan. The owner-approved [experimental beta policy](experimental-beta-release-plan.md) supersedes its Windows/Ubuntu x64 runtime hold for the beta only; stable promotion still requires contributor evidence.

# Implementation plans

[Typography refinement](typography-refinement-plan.md) — owner accepted the isolated Inter/JetBrains preview. [PR #10](https://github.com/samir-scripts/grace/pull/10) merged to `dev` after its CI gates passed; this is not a release. The [before/after evidence](evidence/typography-refinement/README.md) belongs to the preview.

[Experimental betas and branded pages](experimental-beta-release-plan.md) — desktop 1.7.2-beta.1 and branded website/privacy pages published. The beta bundles signed Firefox 1.1.1. Windows/Ubuntu x64 runtime remains unverified for the beta; stable promotion still requires reviewed acceptance against the exact packages.

[macOS Chrome acceptance through Tart](chrome-tart-acceptance-plan.md) — passed actual packaged Chrome acceptance on macOS, including forced app recovery; evidence collected and clone stopped.

[Documentation and native demos](grace-documentation-refresh.md) — reviewed desktop guide and historical local recordings.

Chrome 1.1.4 was submitted for automatic publication on November 17, 2026, and the Web Store build paired during the first nightly's scoped macOS smoke. [Submission record](evidence/chrome-store-1.1.4/README.md)

[First published nightly](https://github.com/samir-scripts/grace/releases/tag/v1.7.2-nightly.20261119) — manual prerelease from `dev` merge `912ba89`, with signed packages built at metadata child `6796b03` by [Release](https://github.com/samir-scripts/grace/actions/runs/44448779483). In a disposable macOS ARM64 guest the DMG launched, preserved Glass/font settings across relaunch, and paired with Web Store Chrome 1.1.4 and signed Firefox 1.1.5 for a blocking round and natural restoration. This was not an in-place upgrade, Intel, or Windows/Ubuntu x64 runtime test. The stable updater feed was unchanged.

The nightly bundles AMO-signed Firefox 1.1.5 (SHA-256 `43b0d9ab3e9d8f597297c058ad0e6316e3fa6898a0f49f39dae41e4ec41a20f5`). Strict signed packaging and Chrome integration passed. The Chrome 1.1.4 ZIP matched all 23 submitted entries. [Companion integration](https://github.com/samir-scripts/grace/pull/12)

The dedicated macOS preview at `a79270b` retained Glass transparency at 0%, 50% and 100% across relaunches. Compact controls, draft retention, keyboard dismissal and date navigation were exercised. The follow-up at `ed98c5b` verified picker focus restoration and chart navigation in the packaged app. The Linux opaque fallback was checked on ARM64 at `a79270b`. Windows and Ubuntu x64 runtime acceptance remains open. [Packaged desktop checks](https://github.com/samir-scripts/grace/pull/14)

[Desktop UI repair evidence](evidence/ui-repair-2026-11-17/README.md) records local macOS and Linux ARM64 checks; it does not certify the public beta or a nightly.

[macOS companion pairing](evidence/macos-pairing-2026-11-17/README.md) records Grace 1.7.1 with Chrome Web Store 1.1.2 and signed Firefox and Zen 1.1.4.

[Chrome extension release readiness](chrome-extension-release-readiness-plan.md) — macOS and Linux ARM64 packaged Chrome matrices passed on disposable guests; Linux x64 and Windows have not been tested. A custom Chrome data directory cannot discover the default native-host registration. Historical submission status is superseded by the dated records above.

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
