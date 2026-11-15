# Chrome Web Store reviewer instructions — submitted, Pending Review

Status checked 2026-11-15: Chrome companion **1.1.2 is Pending Review**, with **Public** distribution and no published version yet. The [published release plan](https://github.com/samir-scripts/grace/blob/dev/plans/experimental-beta-release-plan.md) records submission on 2026-11-13 with automatic publication after approval. The earlier preparation-only hold is superseded. This local document update does not change the dashboard or resubmit the extension.

## Desktop candidate

Use published **Grace 1.7.2-beta.1** with **Chrome companion 1.1.2**, payload source `f7f28c2a53351a0fdbcf41264c2c709d5421e4c3`. The desktop build must authorize Chrome ID `cgibenlmgmblmalggjalnoaikjkdnoid`. This older local checkout and its generated extension output are not the published candidate; see [release status and remaining checks](chrome-extension-release-readiness-plan.md#current-release-status--2026-11-15).

Public candidate downloads, checksums and provenance: [v1.7.2-beta.1](https://github.com/samir-scripts/grace/releases/tag/v1.7.2-beta.1). Verify the selected package against that release's metadata. No publisher or reviewer account is required. Never supply a real pairing token or passphrase.

**Experimental platform scope:** Windows x64 and Ubuntu x64 packaged integration, blocking and recovery remain unverified / deferred to contributors. Their beta-only waiver allowed publication and submission; stable promotion still requires reviewed exact-source/exact-package native reports. Focused macOS beta checks do not establish the full cross-platform matrix or store-installed acceptance.

Landing/support: **https://grace-focus.github.io/**. Privacy: **https://grace-focus.github.io/privacy/**. Keep the **grace-focus** organization's GitHub Pages URLs; no custom-domain or DNS work is planned.

## Setup and scenarios (disposable machine/profile only)

These are acceptance checks to perform, not a claim that every scenario passed on the published beta. Use the [contributor checklist](https://github.com/samir-scripts/grace/blob/dev/plans/contributor-native-acceptance.md) for Windows/Ubuntu native evidence.

1. Install and launch the matching packaged Grace application. Use actual Google Chrome desktop 116 or later.
2. For unpacked testing while review is pending, use the Chrome payload matching the published beta source, not this older checkout's generated output. Confirm ID `cgibenlmgmblmalggjalnoaikjkdnoid` and version **1.1.2**. After store approval, repeat with the store-installed extension as a separate acceptance gate.
3. Remove any old unpacked companion. In Grace Settings > Sessions, use Chrome's **Install Extension** action to register the packaged native host. This action also applies the existing browser installation policy; do it only on the disposable test system. A policy entry does not prove installation; explicitly confirm the intended companion is installed and enabled, using unpacked installation for pre-approval testing and store installation for post-approval acceptance.
4. In the companion's Extension options, choose **Accept & connect**. Do not paste a token. Require automatic connection, then assign the profile to Chrome in Grace and select it as required for the test focus session.
5. Configure a short test session blocking controlled HTTP and public HTTPS domains plus subdomains. Record allowed controls loading before work. Start the session and correlate the active native timer and policy acknowledgement with existing-tab replacement and blocked fresh navigation. Allowed controls must still work.
6. Restart Chrome, then separately force-stop and relaunch Grace while protected, using only the disposable system. Verify automatic reconnect with the same profile, retained blocking, and no duplicate profile. After an interrupted app run, Grace keeps the timer stopped and restarts the interrupted phase at its full duration on explicit Retry; it does not infer elapsed time while stopped. Normal Quit is guarded until authorized release.
7. Let a session complete naturally and confirm blocked navigation is restored. In a new session exercise the configured authorized emergency exit and confirm restoration again.
8. During active work, disconnect/withdraw sharing. Verify protection is retained. Reconnect and verify an authenticated release restores navigation. Do not disable/uninstall the companion as a substitute for release.
9. Restore the disposable environment after collecting sanitized results. Never capture tokens, full credential-bearing settings, or passphrases.

## Historical dashboard Additional instructions — 2026-11-12

The 485-character preparation note below is retained as history, not current reviewer guidance. The published release plan records its replacement at submission with a 464-character note linking the public desktop beta and disclosing unverified Windows/Ubuntu blocking and recovery. This update does not claim to transcribe or modify that saved note.

Matching Grace desktop candidate is not published yet; submission held. No account needed. When supplied, install the candidate, then Settings > Sessions > Chrome > Install Extension. Open companion options, Accept & connect without a pasted token; assign the profile to Chrome. Start a focus session blocking example.com; check blocked and allowed pages. Restart Chrome and Grace separately; verify reconnect. Check natural completion and authorized emergency exit restore navigation.

## Submission configuration

The existing item is submitted for **Public** distribution and remains **Pending Review**. Automatic publication after approval is recorded in the published release plan. Keep the submitted state; do not repeat the historical upload/submission steps. Broad host access may require extended Google review. After approval, verify store-installed behavior; before stable desktop promotion, obtain reviewed Windows/Ubuntu x64 native acceptance for the exact candidate packages.
