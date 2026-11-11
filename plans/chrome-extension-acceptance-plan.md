# Chrome unpacked extension validation

## Goal and decisions

Validate the unpacked companion against packaged Grace in an owned disposable Tart clone. Chrome Web Store publishing and Windows/Linux acceptance are deferred. The approved chat plan is the specification; Terra owns setup/contracts, Luna owns bounded tests/documentation, and the parent owns guest orchestration and evidence. Existing Firefox/Zen setup and active-focus mutation guards are preserved.

## Implementation ledger

- [x] Prepare Chrome through typed IPC, returning its canonical absolute bundled directory and registering the native host. Reject the old external-CRX install command for Chrome.
- [x] Display explicit manual Load unpacked instructions and a prepared message. Do not equate a Chrome policy file with an installed extension; authenticated profile connection supplies readiness.
- [x] Package tests compare ZIP and unpacked payloads byte-for-byte and reject credential files/symlinks without replacing existing output.
- [x] Real Chromium tests stop/wake the MV3 worker and restart a persistent browser profile; retained DNR rules are checked before renewed authentication and policy ACK.
- [x] Existing authentication regressions cover stale/tampered frames and failed rule updates without successful ACKs.
- [x] Add explicit Chromium integration and guarded disposable native bridge commands. Ordinary `npm test` does not prove native acceptance.
- [x] Add Chrome guest provisioning, owned empty profiles, official download/signing verification and sanitized collection. Tests keep native scenarios blocked by default.
- [x] Provision official Chrome in a fresh clone; preserve the baseline and all existing guests.
- [ ] Complete packaged-app native acceptance and reproduce the old setup defect through its UI.

Ruling: the external-CRX defect was corrected from source evidence and regression tests before a packaged-UI reproduction. Guest input failed, and guest-only System Events inspection timed out; neither is a native acceptance pass. The old packaged bundle was transferred and opened successfully, but no installation or enforcement behavior was established.

## Observed checks (2026-11-11)

- `npm run check`: passed, zero errors/warnings.
- `npm test`: passed; browser setup suite includes eight tests. Initial restricted attempt could not bind localhost; rerun with local server access passed.
- Required Rust suite: passed, including 162 library tests and the new policy-presence regression; configured ignored/skipped tests remain excluded. Initial restricted run had three loopback failures; unrestricted rerun passed.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`: passed.
- `npm run test:guest-focus`: 32 Python and seven Node tests passed.
- `npm run test:chrome-integration`: two Chromium tests passed, including worker/browser restart checks.
- Packaged debug Tauri build: passed. Its initial build preceded the final inventory-only policy-status correction; the final package also passed after that correction. Its hashes are recorded in `evidence/chrome-acceptance-2026-11-11/final-artifacts.json`, and it was transferred under the guest run’s `final/Grace.app`.
- Guest native bridge invocation initially failed with `spawn cargo ENOENT`; no Rust toolchain is installed in the baseline. Follow-up prebuilt fixture validation is recorded below.

## Guest evidence and remaining acceptance

Run: `62698990-30f2-488d-b1c5-b7a4d3cd3f51`, clone `grace-acceptance-62698990-30f2-488d-b1c5-b7a4d3cd3f51`, baseline `pomotroid-zen-clean`, Tart 2.41.1. Chrome 157.0.8103.51, macOS 15.7.7, fixed companion ID `ddiojihepmbimcfoefnebpolgaljlcfn`. Official universal stable DMG and installed bundle passed strict signature and Google designated-identity verification. Exact hashes and all initially blocked scenarios are in [provision evidence](evidence/chrome-acceptance-2026-11-11/provision.json).

Native UI blocker: CUA could capture the guest desktop, but input returned `noWindowsAvailable`. The existing guest UI harness also timed out after 20 seconds while inspecting the app. No permissions or TCC database were bypassed. These checks remain blocked: Load unpacked, automatic native pairing, consent and assignment, existing/fresh HTTP/HTTPS blocking and controls, work/break reapplication, restarts/disconnect retry, natural/emergency release, withdrawal and real extension appearance/keyboard acceptance. Browser fixtures cannot substitute for these checks.

Resume with the owned run and normal guest permission prompts once input works. Prepare Chrome in the final packaged app, load the displayed folder through `chrome://extensions`, consent in options, assign the connected profile and run every scenario in the provision report. Correlate native state, authenticated ACK and controlled navigation. Preserve passed/failed/blocked/inconclusive classifications; stop only the owned clone afterward.

## Guest integration follow-up

The owned guest installed locked npm dependencies and Playwright Chromium. `npm run test:chrome-integration` passed both tests inside Tart, including MV3 worker and persistent browser restart. This exercises Chromium, not the official Google Chrome UI.

Because Cargo is absent from the baseline, the matching arm64 `focus_bridge_fixture` was built from current source on the host and transferred to the owned run. `POMOTROID_BRIDGE_FIXTURE_BINARY` accepts only a canonical executable owned file inside that exact guest run. With that fixture, the guest native bridge suite passed all three tests: ownership guard, prebuilt-path validation, and actual Rust bridge apply/release with worker reconnect. This is bridge/DNR evidence with fixture pairing credentials, not automatic native pairing or packaged-app acceptance. Review also moved the development build behind the guest guard, so invoking the guest script on the host runs only harmless helper checks and skips native execution.

Final guest command `npm run test:chrome-guest-bridge`, with the guarded prebuilt path supplied through the runner, passed 3/3 with zero skips. Sanitized test summaries, final app/fixture hashes and relevant source hashes are committed-ready evidence beside the provision report. The final clone was stopped; baseline and prior guests remain stopped and were not modified. No changes were committed or published.
