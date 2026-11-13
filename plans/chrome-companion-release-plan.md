# Finish and Release the Grace Chrome Companion

Approved implementation plan, 2026-11-12.

## Goal and constraints
Complete Chrome packaging/onboarding, repair Windows signed-source correspondence and universal macOS native-host bundling, pass exact-revision PR checks, and promote through dev, stage, release. Preserve store identity cgibenlmgmblmalggjalnoaikjkdnoid, protocol 3, signed Gecko bytes, current UI and protected-session recovery. Publish desktop downloads before submitting the existing item for Public automatic publication after Google approval.

## Tasks
- [x] Reconcile Chrome packaging, diagnostics, typed IPC and setup controls.
- [x] Add Windows exact-byte checkout and universal macOS helper plus Chromium CI coverage; remote packaging proof pending.
- [ ] Pass local gates and independent review; push feature PR and follow exact-commit checks.
- [ ] Merge tested development PR and promote to stage.
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
