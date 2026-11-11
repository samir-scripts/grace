# Chrome Web Store Release Checklist

This checklist tracks the first public Chrome Web Store release of grace. Focus Companion. Completed items below have evidence in `plans/chrome-extension-release-plan.md`; planned work is not treated as acceptance evidence.

## Current status

- [x] Created the unpublished Chrome Web Store draft, assigned ID `cgibenlmgmblmalggjalnoaikjkdnoid`, and configured its production public key and publisher ID in `extensions/chrome/release.json`.
- [x] Hosted the privacy and support pages: [privacy policy](https://grace-chrome-support.springygranola16.chatgpt.site/privacy.html) and [support](https://grace-chrome-support.springygranola16.chatgpt.site/).
- [x] Saved the original listing copy, icon, screenshot, permission explanations, privacy declarations, category, and language in the private draft.
- [x] Enabled the Chrome Web Store API; status check and production-identity draft upload succeeded. No publish request was made.
- [x] Built a local macOS arm64 Grace 1.7.1 package and Chrome extension 1.1.0 package; checks are recorded in `plans/evidence/chrome-release-2026-11-11/`.
- [ ] Owner review of publisher contact/address, policy certifications, and final store declarations.
- [ ] Publish compatible CI release-candidate download artifacts and insert their URLs into reviewer instructions. The local macOS artifact is not a public reviewer download; Windows and Linux builds are not available yet.
- [ ] Store-installed native acceptance on macOS, Windows, and Linux. The recorded macOS guest UI was blocked by guest input; Windows and Linux acceptance were not run.
- [ ] Assign restricted testers, submit for review, receive approval, and launch publicly. The item remains an unpublished private draft; no public release has occurred.

## Before preparing reviewer artifacts

- [x] Verify production extension identity: the configured public key derives to the draft's fixed extension ID. The private signing key is held outside the repository.
- [x] Build packaging validates release key, ID, and public HTTPS privacy/support URLs; package and identity regressions pass.
- [ ] Build and verify a compatible Grace release candidate for each target OS in CI: macOS universal, Windows x64, and Linux x86_64.
- [ ] Publish those exact CI artifacts to a stable download location and put their verified URLs in `reviewer-instructions.md`. Do not use prior releases or local paths as a substitute.
- [ ] Verify each app artifact hash and matching extension package/identity against the CI build evidence.
- [ ] Confirm the reviewer package contains no credentials or local configuration.

## Required store-installed acceptance

- [ ] On each supported OS, install the matching CI Grace release candidate and the Chrome Web Store companion in a disposable user profile.
- [ ] Verify first-run consent, decline, acceptance, automatic pairing, profile assignment, and reconnect.
- [ ] Verify configured HTTP and HTTPS domains block during work and release on break, completion, stop, and emergency release.
- [ ] Verify withdrawal disconnects and record how already-installed rules clear, including when Grace restarts or is unavailable.
- [ ] Verify browser and extension service-worker restart behavior.
- [ ] Record app and extension versions/hashes, Chrome version, OS version, test profile, and results. Keep blocked and inconclusive cases distinct; do not include credentials.

## Store submission and launch

- [x] Create the first item and configure production publisher/extension identity. The first package was uploaded through the API after initial dashboard setup.
- [x] Host public privacy and support pages and save their URLs in the draft.
- [x] Save listing copy, icon, screenshot, permission and privacy declarations in the private draft.
- [ ] Complete owner contact/address and privacy certifications in the dashboard.
- [ ] Assign restricted testers after reviewer downloads and all-platform acceptance are ready.
- [ ] Review the exact production package and final listing declarations against the shipped code.
- [ ] Submit the item for review; record the submission date and resulting status.
- [ ] After approval and the owner's public launch decision, publish the item and record its public listing URL and release version here.
