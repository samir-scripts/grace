# Chrome Web Store reviewer instructions — pending acceptance

Status: preparation only. Do not submit until packaged Google Chrome acceptance passes on macOS, Windows and Linux and a matching desktop candidate is available to reviewers.

## Desktop candidate

Use the release candidate recorded in [the readiness plan](chrome-extension-release-readiness-plan.md), not an older package with the same displayed version. The current source version is Grace 1.7.1; extension version is 1.1.0. Artifact hashes identify this candidate. The desktop build must authorize Chrome ID `cgibenlmgmblmalggjalnoaikjkdnoid`.

Public project downloads: https://github.com/samir-scripts/grace/releases . A matching candidate has not been published by this task. Before submission, provide exact platform-specific candidate URLs and hashes here and replace the pending sentence in the dashboard instructions. No publisher or reviewer account is required. Never supply a real pairing token or passphrase.

## Setup and scenarios (disposable machine/profile only)

1. Install and launch the matching packaged Grace application. Use actual Google Chrome desktop 116 or later.
2. Before store review, load the rebuilt extension from `extensions/dist/chrome` using Chrome Developer mode. Confirm ID `cgibenlmgmblmalggjalnoaikjkdnoid`. After store approval, repeat with the store-installed extension as a separate acceptance gate.
3. Remove any old unpacked companion. In Grace Settings > Timer & Sessions, use Chrome's **Set Up Extension** or **Repair Connection** action to register the packaged native host. On platforms with a managed policy, this can also modify that policy; do it only on the disposable test system. A policy entry does not prove installation; explicitly confirm the unpacked companion is loaded.
4. In the companion's Extension options, choose **Accept & connect**. Do not paste a token. Require automatic connection, then assign the profile to Chrome in Grace and select it as required for the test focus session.
5. Configure a short test session blocking controlled HTTP and public HTTPS domains plus subdomains. Record allowed controls loading before work. Start the session and correlate the active native timer and policy acknowledgement with existing-tab replacement and blocked fresh navigation. Allowed controls must still work.
6. Restart Chrome, then separately force-stop and relaunch Grace while protected, using only the disposable system. Verify automatic reconnect with the same profile, retained blocking, and no duplicate profile. After an interrupted app run, Grace keeps the timer stopped and restarts the interrupted phase at its full duration on explicit Retry; it does not infer elapsed time while stopped. Normal Quit is guarded until authorized release.
7. Let a session complete naturally and confirm blocked navigation is restored. In a new session exercise the configured authorized emergency exit and confirm restoration again.
8. During active work, disconnect/withdraw sharing. Verify protection is retained. Reconnect and verify an authenticated release restores navigation. Do not disable/uninstall the companion as a substitute for release.
9. Restore the disposable environment after collecting sanitized results. Never capture tokens, full credential-bearing settings, or passphrases.

## Dashboard Additional instructions (500-character limit)

Matching Grace desktop candidate is not published yet; submission held. No account needed. When supplied, install the candidate, then Settings > Sessions > Chrome > Install Extension. Open companion options, Accept & connect without a pasted token; assign the profile to Chrome. Start a focus session blocking example.com; check blocked and allowed pages. Restart Chrome and Grace separately; verify reconnect. Check natural completion and authorized emergency exit restore navigation.

## Submission configuration

Keep the store draft Private during acceptance. After all three platform gates pass, replace the pending candidate text with exact download details, attach the verified Chrome ZIP, and prepare Public distribution. Do not submit or publish without the separate release handoff. Broad host access may require extended Google review.
