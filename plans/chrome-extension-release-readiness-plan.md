# Chrome Extension Release Readiness Implementation Plan

**Goal:** Align Chrome identity, make privacy access public, and prove packaged integration before submission.

**Architecture:** Keep store draft `cgibenlmgmblmalggjalnoaikjkdnoid`; use its public key for development and its ID for native authorization. Change the existing support Site access only.

**Tech stack:** Chrome Manifest V3, JavaScript, Rust/Tauri 2, Playwright, Sites.

**Spec:** User-approved implementation plan in the Codex chat, 2026-11-12.

## Constraints and review focus

- Preserve Chrome 116+, protocol 3, consent, authentication and loopback-only communication.
- No IPC/type changes; preserve Firefox/Safari payloads and signed Gecko provenance.
- Test identity consistency, registration replacement, automatic pairing without pasted credentials, reconnect enforcement, and authenticated release.
- Use disposable test environments; never record real credentials. All three operating systems must pass; unavailable is blocked, never passed.
- Keep distribution Private during acceptance. Prepare public-release details but do not submit.

## Task 1: Align Chrome identity

- [x] Obtain draft public key and verify derived store ID.
- [x] Add failing Node identity regression and native-host store-origin regression.
- [x] Align Chrome manifest key, Rust default ID, desktop-bridge assertion and README.
- [x] Rebuild extensions; verify source/output parity and unchanged non-Chrome payloads.
- [x] Run extension/native tests and isolated registration replacement check.
- [x] Inspect staged filenames/secret exclusions and commit focused change.

## Task 2: Public privacy/support access

- [x] Verify ownership and existing site `appgprj_6af49858b00081919997d66b177f6353`.
- [x] Set access to Public without replacing collaborators or redeploying.
- [x] Verify anonymous `/` and `/privacy.html` content, success responses and no login redirect.
- [x] Confirm store draft URLs and record evidence.

## Task 3: Packaged Chrome behavior

- [x] Run npm check/test, isolated Chromium tests, Rust tests with documented exclusion, and Clippy.
- [x] Build production macOS app/DMG with signed Firefox guard enabled. Windows/Linux packages require their native build environments.
- [ ] On macOS, Windows and Linux, load aligned extension in actual Google Chrome with current packaged Grace.
- [ ] Through normal packaged settings, register native host, accept consent, pair automatically and assign profile.
- [ ] Verify policy ACK, existing/fresh HTTP/HTTPS and subdomain blocking, and allowed controls.
- [ ] Restart Chrome and Grace independently; verify reconnect without duplicate profiles or weakened policy.
- [ ] Verify natural completion and authorized emergency release restore navigation.
- [ ] Verify withdrawal/disconnect preserves protected rules; authenticated reconnect/release restores access.
- [ ] Record versions, hashes and each scenario result. Store-installed acceptance remains separate after Google approval.

## Task 4: Submission handoff

- [x] Link this plan from plans/README.md; update results as work lands.
- [x] Add reviewer setup instructions without credentials; saved pending-candidate guidance in store draft (485/500 characters).
- [x] Keep distribution Private; prepare Public distribution instructions for eventual submission.
- [x] Build and inspect Chrome upload ZIP from verified output.
- [x] Review diff/evidence; stop without submitting. Readiness remains blocked until all platform gates pass.

## Execution evidence and rulings

- Baseline: checkout `feat/window-title-and-drag-region`, commit `dbdbdb70bd84cbf0cda3a0c3b8f1f12b625ddecb`; only pre-existing untracked `docs/` present. User explicitly chose this checkout.
- Prior same-source baseline in this chat: npm test passed 115 tests, two optional captures skipped; two isolated Chromium tests passed. Fresh post-change checks are required below.
- Pre-flight: Tasks 1/3 share extension ID and generated artifacts; Tasks 2/4 share deployed URLs. No conflicting interfaces.
- Ruling: Work in the user-selected checkout; preserve unrelated untracked docs and nested Site repository. No new worktree or dependency install is needed.
- Ruling: Task 3 cannot be completed by headless Chromium or historical Zen evidence. Current environment inventory lacks disposable OS guests; record actual native acceptance as blocked while completing code, packaging, and public access.

### Observed checks (2026-11-12)

- Node identity regression failed with old unpacked ID, then passed with the store public key. Rust origin and re-registration regressions also failed with old ID, then all 7 native-messaging tests passed. Registration replacement runs in a temporary-home subprocess on macOS/Linux; Windows registry runtime verification remains separate.
- `npm run extensions:build -- --require-signed` passed; Chrome source/dist parity passed. All 17 non-Chrome source/artifact hashes unchanged and generated Firefox XPI exactly matches signed artifact bytes.
- `npm run check`: 0 errors/warnings. `npm test`: 116 passed, 2 optional capture tests skipped. Isolated Chromium blocking/options tests: 2 passed. These do not prove packaged native pairing.
- Public Site access changed custom → public (revision 4). Anonymous support and privacy requests returned 200 with expected content and no login gate, cookies or authorization headers. `/privacy.html` redirects to canonical `/privacy`; this is accepted, not treated as a login redirect. Browser visually confirmed privacy content. Store support/privacy fields match these URLs. Evidence: [anonymous requests](evidence/chrome-public-access-2026-11-12.json).

- Rust full suite: 198 passed, 17 opt-in tests ignored; documented accessibility test excluded. `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` passed.
- `npm run tauri build -- --bundles app,dmg` passed through normal signed-extension guards; macOS app and DMG produced. App contains matching Chrome manifest and current native host. No Windows/Linux build or native acceptance claimed.
- Identity fix committed as `8f42595`. Build ran before that commit and embeds the previous base SHA with dirty identity changes; recorded artifact hashes identify exact binaries.
- Authorized commit was initially blocked by a pre-existing empty `.git/index.lock`, 1597 seconds old, with zero active Git processes. Moved it to a temporary backup and committed successfully; no index contents were discarded.
- Saved 485-character reviewer instructions in Chrome dashboard, confirmed by its saved notice; username/password left empty. Exact matching desktop candidate URL remains pending until release handoff. Full instructions: [reviewer setup](chrome-extension-reviewer-instructions.md). Distribution was not changed and nothing was uploaded/submitted.
- Chrome ZIP CRC, exact file allowlist and source-byte checks passed. Archive excludes hidden files, credentials, tests and unrelated distribution directories. Artifact hashes: [release artifacts](evidence/chrome-release-artifacts-2026-11-12.json).

### Native acceptance matrix — Windows/Linux blocked

Current macOS result: **passed** in the owned Tart clone using packaged source `c373d55`, macOS 15.7.7 (24G720) arm64 and actual Google Chrome 157.0.8103.79. [Runbook and results](chrome-tart-acceptance-plan.md), [artifact/runtime evidence](evidence/chrome-macos-tart-2026-11-12.json), [sanitized UI](evidence/chrome-macos-tart-ui-2026-11-12.txt).

| Scenario | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Actual Google Chrome / current packaged app | Passed | Blocked | Blocked |
| Native registration and automatic consent pairing | Passed | Blocked | Blocked |
| Existing/fresh HTTP/HTTPS, subdomains and allowed controls | Passed | Blocked | Blocked |
| Browser restart, forced app stop/relaunch and same profile reconnect | Passed | Blocked | Blocked |
| Natural completion and authorized emergency release | Passed | Blocked | Blocked |
| Withdrawal/disconnect retains rules; authenticated release restores access | Passed | Blocked | Blocked |

Browser restart exposed live lease cleanup; repaired in `34a266b`. Expanded actual Force Quit exposed startup cleanup; repaired in `c373d55` with journal restoration before initial browser policy, locked stopped recovery and explicit Retry. Recovery conservatively restarts the interrupted phase at its full duration because elapsed time is not persisted. Review findings were fixed with failing regressions, then the full Rust suite passed (212 passed, 19 opt-in ignored, documented accessibility exclusion), Clippy passed, and three current authenticated/native guest regressions passed. Production app/DMG build passed with signed Firefox guard; exact Chrome archive bytes remain unchanged. No IPC or protocol serialization changes.

Pinned baseline was restored without automatic pruning and never booted. Acceptance clone was collected and stopped; baseline remains unchanged/stopped. No usable Windows/Linux disposable desktop is available. CI/headless Chromium does not replace those gates. Store-installed acceptance remains separate after approval. OS reboot/power loss and app-update crash boundaries were not separately exercised.

### Final review

Independent whole-change review found no critical, important or minor code findings. Reviewer independently checked the four artifact sizes/hashes, ZIP integrity, exact archive allowlist, source/dist parity, identity regression and diff whitespace. Code repair is consistent; release remains blocked.

Review boundaries: native packaged scenarios and store-installed behavior were not judged as passed; live service changes and the historical full test runs rely on the recorded session evidence, not a second operation/rerun. Unrelated docs, nested Site source and credentials were excluded. No merge, push, upload, review submission or public store release was performed.

Next required input is disposable Windows and Linux native test capacity. After those scenarios pass, supply exact matching desktop candidate downloads, update the pending reviewer note, upload the verified ZIP, and select Public distribution at the separate release handoff.


### Current submission hold

macOS packaged acceptance is complete, including authorized crash recovery repair and final candidate reruns. Public privacy/support evidence remains recorded above. Windows/Linux native acceptance and exact matching public desktop candidate downloads remain outstanding; distribution stays Private and no upload/submission was performed. Historical identity artifact hashes are explicitly marked superseded by the current Tart evidence.

### Linux ARM64 and setup-controls follow-up

- The signed-guarded production DEB passed the normal-profile packaged Chrome matrix on disposable Tart Ubuntu 24.04.5 ARM64 with verified Chrome 157.0.8103.78; see [per-case evidence](evidence/chrome-linux-tart-2026-11-12.json). This is not Linux x64 or Windows evidence.
- Timer & Sessions now distinguishes an assigned companion from the browser policy marker and provides browser-specific removal instructions. Removing Grace setup does not revoke a companion's cached credentials: stop sharing or uninstall the companion first.
- Host checks after these changes: `npm run check` passed with zero errors and warnings; `npm test` passed with two optional captures skipped; Rust tests passed 212 with 19 ignored and the documented accessibility exclusion; Clippy passed. The Chrome store was not modified.
- An isolated custom Chrome `--user-data-dir` could not discover the native host because Grace registers the default Chrome data directory. The fresh standard guest profile paired automatically; custom-directory support remains unverified beyond that observed failure.
- Controlled HTTP and fresh HTTPS blocking, reconnect/retry and forced app recovery with retained active revision, protected tray Exit, natural completion and emergency release were observed with authenticated ACKs. The owned VM was stopped after release. The separate custom Chrome data-directory limitation remains open.


### Staged Chrome companion candidate

Chrome 1.1.1 adds immediate consent-withdrawal protection for diagnostics. The reviewed implementation passed all feature PR checks and merged through dev; see [current staging plan](chrome-companion-release-plan.md). Windows/macOS packaging blockers are repaired and cross-platform CI packages pass. Historical macOS/Linux ARM64 guest passes do not prove final-candidate native behavior. Windows and Linux x64 disposable packaged acceptance remain unavailable, so release promotion, public desktop downloads and Web Store submission remain held.

After all native gates pass, the owner has authorized Public distribution and automatic publication after Google approval. Until then preserve the existing Private draft and do not upload or submit the new candidate.
