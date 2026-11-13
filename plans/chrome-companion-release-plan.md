# Finish and Release the Grace Chrome Companion

Approved implementation plan, 2026-11-12.

## Goal and constraints
Complete Chrome packaging/onboarding, repair Windows signed-source correspondence and universal macOS native-host bundling, pass exact-revision PR checks, and promote through dev, stage, release. Preserve store identity cgibenlmgmblmalggjalnoaikjkdnoid, protocol 3, signed Gecko bytes, current UI and protected-session recovery. Publish desktop downloads before submitting the existing item for Public automatic publication after Google approval.

## Tasks
- [x] Reconcile Chrome packaging, diagnostics, typed IPC and setup controls.
- [x] Add Windows exact-byte checkout and universal macOS helper plus Chromium CI coverage; remote packaging proof pending.
- [x] Pass local gates and independent review; push feature PR and follow exact-commit checks.
- [x] Merge tested development PR and promote to stage.
- [ ] Complete packaged Windows and Linux x64 acceptance.
- [ ] Promote accepted candidate to release, publish desktop packages, finish store assets and submit.

## Release hold
Windows and Linux x64 disposable packaged acceptance capacity is unavailable. CI cannot substitute. Stop at staging until these gates pass. macOS and Linux ARM64 historical evidence must not be relabeled as final-candidate evidence.

## Decisions and evidence
- Ruling: selectively port Chrome files; older branch contains obsolete identity and removes current recovery/UI work.
- Ruling: source checkout and its nested Site remain untouched; copy existing tracked setup edits plus Linux evidence into isolated feat/chrome-companion-release.
- One store identity serves both unpacked and release packages. Native config gains additive protocol_version=3.
- Desktop remains 1.7.1; Chrome remains 1.1.0 if byte-identical to current draft, otherwise 1.1.1.
- Pre-flight: Chrome wrappers require protocol_version and scoped opener IPC; packaging must preserve shared Gecko source bytes.

### Local verification
- npm check: 0 errors/warnings. npm test: 142 passed, 2 optional captures skipped.
- Chromium integration: 2 passed. Rust: 214 passed, 19 opt-in ignored, documented accessibility exclusion. Clippy with warnings denied passed.
- Red/green: Chrome packaging lacked ZIP/wrappers; setup lacked Install Chrome Companion control; native framing lacked protocol version; shared Gecko helper missing. All corresponding regressions now pass.
- Universal helper: 4 tests passed; checks both executables before bundling and stops on missing inputs/build/architecture failures. Native universal CI is still pending.

- Signed-guarded production frontend build passed. Unchanged shared Firefox/Safari/signed source confirmed by Git diff.
- Windows checkout experiment: core.autocrlf=true reproduced strict Gecko payload failure without attributes, then passed with exact-byte attributes.
- Chrome ZIP byte-identical to the previously uploaded branch build: SHA-256 cab4de203380ea19d23a336ab195bb18de4e0de68976ce5f81de2469cbb869bf. Keep 1.1.0.
- Built-in browser inspected setup at 330×700: readable feedback and controls, no horizontal overflow. This uses mocked IPC, not packaged native acceptance.

### Independent review and fixes
- Review found two P2 issues: relative Cargo output paths and Chrome diagnostics continuing after withdrawal when consent persistence fails or is delayed.
- Both fixed with observed red/green regressions. Relative Cargo targets now resolve from src-tauri and an absolute override is passed consistently. Chrome withdrawal immediately aborts/latches diagnostics, including messages from another options page; stale accepted writes cannot resume them. A fresh acceptance request plus persisted acceptance is required.
- Review fix changed Chrome payload: candidate is now Chrome 1.1.1; earlier 1.1.0 byte-parity evidence is superseded. Gecko remains 1.1.0, with unchanged signed bytes.
- Final local checks after fixes: npm check 0 errors/warnings; npm test 146 passed, 2 optional captures skipped; Chromium 2 passed; signed-guarded frontend build passed. Earlier native source tests remain 214 passed, 19 ignored; no native behavior changes in this fix pass.
- Final Chrome ZIP: 21 allowlisted package files, SHA-256 133ebfe4a7a472caaf3398cf95973ee15f7b5ec9322e1be7727c35122dd75b93.
- Review boundaries: Windows registry/opener, actual universal bundling/signing/updater, native browser/recovery/tray/window/audio behavior, all localized layouts and store-installed behavior are not proven by local fixtures. Required native acceptance remains a release hold. Custom data directories remain unsupported. Pre-existing Mozilla registration and Windows unregister behavior are unchanged. No deferred minor findings.

### Windows build continuation
- Corrected candidate 73f30ac passed both Ubuntu quality gates and CodeQL. Windows reached Rust compilation, proving the signed-source checkout failure was repaired, then exposed an existing windows 0.62 BOOL import error.
- Narrow repair imports BOOL from windows::core, matching the installed WNDENUMPROC signature, and limits the unused fallback closure to macOS/Linux. Independent Terra review found no issue; focused browser-detector tests (5) and macOS Clippy passed. Fresh Windows CI remains required.

### Real macOS tool regression
- CI at 73f30ac compiled the universal application and created the helper, then rejected the lipo verification argument order. Corrected the input-before-command syntax.
- A real local macOS regression compiles tiny arm64/x86_64 Mach-O objects, exercises lipo through the helper, accepts universal binaries, and rejects a thin main before bundling. It failed before the fix and now passes; all 6 packaging tests pass. Independent Terra review found no issue.
- Full npm suite after this fix passed 147 tests with 2 optional captures skipped. Required Rust suite after Windows fix passed 214 with 19 opt-in ignored and documented accessibility exclusion. Final all-platform CI is still pending.

### Windows test harness portability
- Added a CRLF fixture for the Chrome options VM harness. It reproduced an import-stripping SyntaxError on Windows line endings; accepting CRLF fixed it. All 9 diagnostic tests pass, with independent Terra review finding no issue. Production extension bytes are unchanged.
- At 1cb0a6a, both Ubuntu quality gates, CodeQL, Linux packaging, Windows packaging and the push-run macOS universal package passed. The test-only portability follow-up still requires final exact-head CI before promotion.

### Reviewed staging promotion
- Feature head 7dd768ad58a7e1bea39e19cf23995dcfb286d152 passed all PR checks: both quality gates, CodeQL, both Linux x64 builds, both Windows x64 builds and both macOS universal builds. Runs: 43368622286 (PR), 43368614806 (push), 43368622291 (CodeQL).
- PR #2 merged into dev as 57fd50040c01368f3007101546085d6f72a8370b. Stage fast-forwards existing local stage history from this dev merge; this follow-up changes only plans/evidence. No force push or branch deletion.
- Local full universal app/DMG build passed; packaged app and native host both contain x86_64 and arm64. CI DMG inspection at preceding application revision 1cb0a6a independently confirmed both binaries and Chrome 1.1.1 without executing the application.
- Staging automation runs on the resulting stage commit; its live GitHub checks are the authoritative result for that build. A successful package build does not count as native acceptance.
- STOP: disposable Windows and Linux x64 packaged runtime capacity remains unavailable. Final-candidate native acceptance, matching public downloads, Public store distribution and automatic publication after review remain pending. Store draft stays Private/unsubmitted; remote release is not created or pushed.

### Post-merge CodeQL push repair
- Feature PR CodeQL passed, but dev/stage push analyses failed while uploading results: Resource not accessible by integration. The workflow requested no explicit token permissions. GitHub permits PR SARIF uploads specially; normal branch pushes need security-events write.
- Owner explicitly approved contents read, actions read and security-events write for the analyze job after automatic approval review requested authorization. No repository-wide defaults, credentials, triggers or analysis checks change. Independent Terra review confirmed the scope.
- The repeated dev/stage failures are the observed regression. A reviewed CI follow-up PR and successful push analyses are required before the staging checkpoint is considered green. Application source and extension payload remain unchanged.


### Superseding experimental beta policy (2026-11-13)
The owner explicitly replaced the Windows/Ubuntu x64 packaged-runtime publication hold with an experimental beta waiver. Those platforms remain **unverified / deferred to contributors**, never passed. The new plan is [experimental betas and branded pages](experimental-beta-release-plan.md). Automated quality gates, signed Gecko correspondence, packaging verification and independent code review remain required. Stable publication requires reviewed reports matching tested source and actual package hashes. No first-party x64 packaged runtime checks or new x64 VMs are authorized in this work.
