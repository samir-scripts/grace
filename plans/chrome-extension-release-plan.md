# Public Chrome companion release

## Goal and constraints

Easy-to-install public Chrome Web Store release with packaged Grace acceptance on macOS, Windows and Linux. Protocol 3 and minimum Chrome 116 stay unchanged. Only Google Chrome desktop is supported by this release claim. Preserve prior uncommitted Chromium acceptance work and Firefox/Zen behavior.

## Implementation ledger

- [x] Create an unpublished Chrome Web Store draft and obtain its assigned ID/public key.
- [x] Configure production identity in `extensions/chrome/release.json`; release packaging validates public key, derived ID, and HTTPS privacy/support configuration. Development identity is explicit only.
- [x] Add guarded typed store installation command; register production native origin before opening listing. Retain explicit unpacked preparation with package/origin match validation.
- [x] Surface Windows registry registration failures without dumping command output.
- [x] Public settings guide store install, consent, automatic pairing and profile assignment; all eight existing locales updated.
- [x] Add Chrome-only toolbar action and branded 16/32/48/128 icons without changing signed shared Gecko source.
- [x] Draft listing, permission explanations, reviewer instructions, migration and release checklist.
- [x] Publish public HTTPS support and privacy policy through Sites; deployment succeeded.
- [x] Store icon and real 1280×800 extension consent screenshot saved in draft.
- [x] Enable API, link dedicated service account, keep its private key owner-only/ignored, verify live status and draft upload.
- [x] Record local checks and independent review below.
- [ ] Build/verify production artifacts on all three platforms.
- [ ] Restricted store-installed acceptance on all three platforms, review approval and public launch.

## Identity and public pages

Draft extension ID: `cgibenlmgmblmalggjalnoaikjkdnoid`. Public-key derivation checked against this ID. Chrome Web Store draft creation succeeded, but no submission or publication has happened.

- Intended listing: https://chromewebstore.google.com/detail/cgibenlmgmblmalggjalnoaikjkdnoid (not public yet).
- Support: https://grace-chrome-support.springygranola16.chatgpt.site/
- Privacy: https://grace-chrome-support.springygranola16.chatgpt.site/privacy.html
- Site source is a separate nested repository under `docs/chrome-web-store/site`; deployment source revision `7f379e42c3b8236d8fe453168b1cbe25ee5a2a3c`.

## Rulings and external gates

- Ruling: a separate `--chrome-draft` bootstrap ZIP obtains the store identity; it never overwrites the final Chrome ZIP. Production builds fail closed on missing/mismatched identity or placeholder URLs.
- Ruling: toolbar behavior is Chrome-specific so the existing signed Firefox payload stays valid.
- Ruling: URL privacy language explicitly notes original tab URL can remain in blocked-page URL/history. No remote browsing-data transmission is claimed.
- Chrome API cannot create a first item or replace initial listing/privacy setup; browser dashboard use was necessary. Later status/upload operations will use API v2.
- The first unpublished store item uses Chrome extension version 1.1.0; future updates must increase its version. Firefox package remains unchanged.
- Existing macOS guest UI failure remains blocked. Passing fixtures do not prove native installation, automatic pairing, protected lifecycle or store installation.
- Windows/Linux production and native Chrome acceptance remain unverified on this macOS host.
- Release gate: retain restricted tester distribution and defer public publication until all-platform acceptance passes. Do not claim support for Edge, Brave or ChromeOS.

## Observed checks

- Packaging regression red/green: new release tests failed before implementation, then 7/7 passed.
- Chrome/Gecko package checks: 23/23 passed after adding synthetic store identity to Gecko test fixtures.
- Chromium integration: 2/2 passed with required local browser access; initial restricted browser launch failed.
- Agent frontend checks: Svelte/TypeScript check passed; browser setup 9/9 passed, including registration failure and locked guards.
- Agent Rust checks: required suite passed before the final configuration update; subsequent focused origin/identity tests 8/8 and Clippy passed. Final integrated suite pending.

## Final integrated evidence (2026-11-11)

- Public draft description includes explicit independent Pomotroid fork credit, official repository and https://pomotroid.app/ links; structure inspired by BlockSite, with original copy.
- Live API status returned the configured item ID. Production-identity upload returned `SUCCEEDED`; the helper has no publish operation.
- Draft listing category Workflow & Planning, English (United States), icon, screenshot, support URL, privacy explanations and policy URL saved. Distribution set to Private for trusted testers; no review or public publication requested.
- Private publishing key was generated locally. Only its RSA X509 public certificate was uploaded to Google. JSON credential is mode 0600, covered by `.env.*`, absent from tracked/staged files. No private key or token was printed or committed. Public certificate expires 2027-11-11; rotate before expiration.
- `npm test`: full suite passed after running sequentially. One run overlapping the production build timed out in the motion test; isolated motion check and final full rerun passed. Existing motion suite reports two skips.
- `npm run check`: zero errors/warnings. A fixture union-type error found in the first integrated check was corrected.
- Required Rust suite: 166 library tests plus integration suites passed, with configured native ignores/filter retained. Clippy passed.
- `npm run build` and production macOS arm64 `npm run tauri build`: passed. No Windows/Linux build or GUI acceptance is claimed.
- CI quality/release gates now install the Chromium test browser and run the dedicated Chromium integration suite. Subsequent CI execution and failures are recorded in the continuation below.
- Independent Terra review found Linux `google-chrome-stable` launch compatibility. The fallback now retries that executable after `google-chrome` fails; registration runs only once. Regression failed before the fix and the latest UI suite passed 10/10.

## Remaining release gates

- A compatible public desktop release-candidate download for each OS is still needed for store reviewers. Preparation is committed and pushed to `codex/chrome-public-release`; no merge, tag or public release has occurred.
- The owner-supplied public contact and trusted tester are saved. Privacy certifications are saved. Contact verification remains pending; no address was invented.
- Store-installed restricted testing, then all-platform packaged native acceptance and review approval remain open; the old macOS guest input blocker is unchanged.
- Chrome-only connection guidance now distinguishes missing native host, incompatible native protocol, unavailable host and unauthenticated/disconnected focus connection. It probes only after consent, never returns or logs credentials, aborts on withdrawal and keeps connected claims tied to authenticated background state. Native Config adds protocol_version=3; existing Firefox ignores the additive field. Unit red/green checks passed 5/5, and independent review found no actionable issue. Actual packaged failure-mode acceptance is still required.

- Final Chrome diagnostics verification: 5 unit tests and 2 Chromium integration tests passed; pre-consent native diagnostics remain silent. Full npm suite includes 105 extension tests and 10 browser setup tests, with no failures. Native protocol serialization and the required Rust suite passed again after the additive version field.

- Final production macOS arm64 app and DMG rebuilt after the protocol guidance change; hashes and source hashes are in `evidence/chrome-release-2026-11-11/artifacts.json`. Native acceptance remains unperformed.

## Remaining-task continuation (2026-11-11)

- Publisher dashboard identified only contact email/verification and privacy certifications as submission blockers. Audited privacy certifications saved; public contact and trusted tester accounts requested from the owner.
- Existing SSH repository access works; GitHub CLI has no API authentication. Build-only CI will run from a codex feature branch after committing the related preparation/acceptance work. No tag, merge, public extension publication or release workflow is authorized by this continuation.
- Existing owned Chrome Tart guest and baseline remain stopped. Tart executable is `.superpowers/sdd/safe-gecko-network-prototype-plan/tart.app/Contents/MacOS/tart`. Prior guest payload predates production identity; transfer current package with fresh provenance before native checks.

- Security alert follow-up: owner reported OpenVSX token detection at API-helper test line 15. Source and independent review identify the public Chrome publisher UUID, not a credential. Replaced test metadata with runtime `randomUUID()`, focused tests passed 11/11. No affected key was found; no rotation claimed. See `evidence/chrome-release-2026-11-11/secret-scanning-incident.md`. Authenticated inspection and the closure outcome are recorded below.

- Cross-platform CI run 43066210538 stopped in extension tests: Node 22 cancelled the timeout mock and six following tests because AbortSignal.timeout is unreferenced and the mock had no active I/O. Fixed the test with a referenced mock-request timer, cleared on abort, and an explicit aborted-signal assertion. No production timeout or gate was weakened. Focused tests passed 11/11; rerun pending.
- Public contact set to the owner-supplied address, currently unverified; Google verification email requested. Trusted tester account saved. Publisher display name remains unchanged after automatic review rejected an unrequested identity change.

- Owner approved false-positive closure. GitHub alert #1 was observed closed as false positive; no affected credential found, no unrelated key rotation performed. The report retains the scan limits.
- Google contact verification was resent once after the owner reported non-delivery; dashboard confirmation says sent, but verification is still pending. Public email remains limited to the Web Store; the support site was not changed.
- Native guest input still returns noWindowsAvailable for clicks after activation/rebinding. Keyboard attempts did not establish guest interaction. Owned clone stopped; baseline and other guests stayed stopped. No new native acceptance pass is claimed.

- CI run 43068794933 passed frontend and Chromium checks, then exposed 13 Linux-only Clippy diagnostics in platform-specific application catalog/monitor code and browser policy paths. Helpers/imports are now compiled only on their supported platforms (or in tests); Linux tail expressions and unused executable argument handling were corrected without warning suppressions. macOS focused monitor/catalog/browser-detector tests and Clippy passed. Linux CI rerun is the remaining proof.

- CI run 43070532439 at source 74b1f78 passed the entire Ubuntu quality gate, including frontend/extension tests, Chromium integration, Clippy and required Rust tests. Windows packaging failed during signed Gecko source correspondence; Linux and macOS production builds are still running. The integrity check remains enabled while the platform checkout difference is investigated. Independent Terra review found no supported-platform regression in 094789b.

- Windows failure reproduced in a disposable checkout with `core.autocrlf=true`: 12 of 13 signed shared source files changed from LF to CRLF, and the strict archive verifier failed. `.gitattributes` now preserves exact `extensions/focus/**` bytes with `-text`. The same checkout then matched all 13 Git blobs and passed the unchanged verifier. Focused signed-Gecko/Chrome packaging tests passed 23/23; required-signed package build passed. A fresh Windows CI build is still required.
