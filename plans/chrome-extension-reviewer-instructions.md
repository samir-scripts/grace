# Chrome companion reviewer instructions

## Submitted for Chrome 1.1.4 on November 17, 2026

No account needed. Open Grace desktop from https://github.com/samir-scripts/grace/releases/tag/v1.7.2-beta.1. In Settings > Sessions, set up Chrome. Open the extension, check the Grace logo, then click Accept & connect. Confirm Connected and assign the active profile to Chrome in Grace. Block example.com for a one-minute round. Verify access returns when the session rules allow it. Restart Chrome and check reconnection. Windows/Ubuntu x64 beta blocking and recovery are unverified.

[Submission and verification evidence](evidence/chrome-store-1.1.4/README.md)

## Historical instructions for Chrome 1.1.2

Candidate: Chrome 1.1.2, ID cgibenlmgmblmalggjalnoaikjkdnoid, desktop 1.7.2-beta.1. No account needed. Windows x64 and Ubuntu x64 desktop integration, blocking and recovery are experimental and unverified; this is an owner-approved publication waiver, not a passing result. Other Linux distributions are not covered by Ubuntu evidence.

Homepage/support: https://grace-focus.github.io/
Privacy: https://grace-focus.github.io/privacy/
Desktop candidate: https://github.com/samir-scripts/grace/releases/tag/v1.7.2-beta.1
Windows installer: https://github.com/samir-scripts/grace/releases/download/v1.7.2-beta.1/grace-windows-x64-1.7.2-beta.1-setup.exe
Ubuntu DEB: https://github.com/samir-scripts/grace/releases/download/v1.7.2-beta.1/grace-ubuntu-x64-1.7.2-beta.1.deb
macOS universal: https://github.com/samir-scripts/grace/releases/download/v1.7.2-beta.1/grace-macos-universal-1.7.2-beta.1.dmg

Use an owned disposable desktop with a normal Chrome data directory, never a personal browser profile or host policy. Verify SHA256SUMS and source provenance; package URLs must be publicly available before store submission. Install the matching Grace package, then Settings > Sessions > Chrome > Install Chrome Companion. Accept & connect in companion options without a pasted token, assign the browser profile, and start a focus session blocking example.com. Verify existing/fresh HTTP/HTTPS and subdomain blocking, example.org allowed, browser and Grace restarts/recovery, consent withdrawal, natural completion and emergency release. Correlate with native timer UI and authenticated ACKs; timeouts alone are inconclusive. Public Website/Privacy links work before consent without pairing or diagnostics.

Beta downloads are manual; the stable updater feed is unchanged. Chrome submission uses the existing item with normal Public distribution and automatic publication after Google approval, not a beta-only store track. Store-installed acceptance follows approval. Contributor reports and independent approval are required for stable platform support; see [native checklist](contributor-native-acceptance.md).
