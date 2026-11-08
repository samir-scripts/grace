# Native guest assistance — 2026-11-08

## Scope and coordination

The owner requested Codex assistance with the OMP agents' blocked Tart VM tests. Current authoritative acceptance evidence remains in `zen-gecko-csp-repair-plan.md`; this assistance attempt does not supersede any completed browser/bridge checks.

Codex started the previously stopped `pomotroid-zen-diagnosis` guest with the existing Tart executable, graphical console and `--no-clipboard`. OMP acknowledged via the existing live collab session that Codex owns this attempt's VM lifecycle and that it will not launch competing fixtures, mutate guest settings or change permissions until ownership is returned.

## Observed preparation

- Verified outside project restrictions that Tart reports this guest **running** and `tart exec ... /usr/bin/true` succeeds. Restricted-context `tart list` had misleadingly reported stopped; unrestricted VM-state inspection supersedes it.
- Located the existing debug bundle at `/Users/admin/grace/src-tauri/target/debug/bundle/macos/Pomotroid.app`. Source and Cargo target use different guest roots; do not assume the source tree contains the bundle.
- The bundled signed XPI matches canonical SHA-256 `34c5729bd350ca9fb76fe0c0cdd488a18edfd0a34291517e058222a3f4602b4b`; the packaged native host is executable.
- Guest listener inspection found no port 1421 listener before app testing.
- Supported host CUA could inspect the Tart window and guest desktop. Guest coordinate actions were unreliable: repeated `noWindowsAvailable` and ScreenCaptureKit `-3812` errors; some earlier pointer actions reached Finder, while navigation/keyboard outcomes were not reliable. Native Tart menu controls worked. A full-screen diagnostic did not resolve coordinate input; the console was returned to its normal windowed view.
- Existing OMP evidence records guest System Events failure: `osascript is not allowed assistive access (-25211)`. No permissions were changed, no alternate native-input mechanism was used, and no emergency credential was read or changed.

## Authorized guest automation

The owner explicitly approved guest-only Accessibility and AppleScript automation. Guest System Events subsequently reported Accessibility enabled and could operate the app's real WebKit controls. No TCC database edit, host permission change, host AppleScript automation, or emergency credential read/change was performed. A separate Finder AppleEvents prompt was not accepted; System Events was sufficient.

## Native results

These observations use the existing packaged debug app and official Firefox 115.44 ESR isolated profile, with the canonical signed companion. A separate **Guest Native Acceptance** session was created through the app: two-minute work, one-minute short/long breaks, one work round, `example.com` blocked, no selected apps. Only this ESR participant was required in a reversible private guest browser configuration. The original Pomodoro profile was preserved. The original auto-start-work setting was temporarily disabled to observe final completion without starting another work round.

- **Active packaged session:** authenticated active-policy ACK and actual countdown; an existing `example.com` tab displayed the companion block page, while `example.org` loaded Example Domain. A fresh blocked-domain navigation remained blank; this observation alone is not proof of new-navigation enforcement. Earlier real-bridge new-navigation evidence remains separate.
- **Withdrawal and native recovery passed:** real keyboard activation of Stop sharing closed the companion at guest log time 23:07:36 and produced `required_disconnected`, lease failure and focus-enforcement loss. The app displayed Retry and paused at **01:35**, remaining there until recovery about 90 seconds later. Re-consent authenticated protocol v3 and ACKed inactive revision 7 at 23:09:06. Native Retry ACKed active revision 8 at 23:09:10 and resumed countdown; screenshot shows 01:30.
- **Native emergency hold passed:** while the protected timer was paused at 00:50, the locked selector opened Emergency Exit. An actual held Space key advanced the 60-second control; early key release reset progress to zero and kept it locked. A second continuous hold exceeded 60 seconds, closed the modal, unlocked/reset the timer to 02:00 and received release ACK revision 9 at 23:11:41. A new `example.com` navigation loaded Example Domain. This is emergency-hold proof, not correct-passphrase proof or natural completion.
- **Protected ordinary Quit failed:** fresh packaged app launch and fresh authenticated companion ACK, then Play. Screenshot shows the locked red selector and countdown at **01:54**. Immediately afterward, guest System Events read **01:42**, sent ordinary Command-Q and one second later reported `exists process "pomotroid" = false`. This occurred well before the 120-second work round completed. Relaunch logged a leftover focus journal and inactive-policy cleanup; restarting without a currently connected required companion correctly failed closed until later reconnect and Retry. Do not mark active-session restart/quit protection passing.

The guest and host `src-tauri/src/lib.rs` matched SHA-256 `b7c708c69bea4a473fa6d5803cd91f65591a82f1dcdc3df5eb11ddb2101b7534`; the packaged executable was newer than that guest source. Source contains a `RunEvent::ExitRequested` guard using `FocusController::should_prevent_app_exit()`. The root cause of the native Command-Q escape is not established by source presence alone. OMP received the exact reproduction through its live collab session and acknowledged host-only investigation while Codex retains guest ownership.

Correct configured-passphrase success remains untested; no stored credential was disclosed or changed. Firefox 159 initially stalled without a usable window in this assistance and was stopped only after confirming its isolated profile ownership; no new Firefox 159 native acceptance is claimed.

## Evidence

Screenshots are in `.superpowers/sdd/native-guest-assistance-2026-11-08/`:

- `pomotroid-native-firefox-withdrawal-paused.png` (the declined/unaccepted Finder prompt overlays part of the paused app).
- `pomotroid-native-firefox-recovered.png`.
- `pomotroid-native-hold-cancelled.png`, `pomotroid-native-hold-in-progress.png`, `pomotroid-native-hold-unlocked.png`.
- `pomotroid-native-emergency-restored.png`.
- `pomotroid-native-before-quit.png` (locked, running 01:54 immediately before the failed Quit guard).

## Natural cycle and cleanup

- Native Retry at 23:22:03 received active-policy ACK revision 3 and started the full 120-second work round. No skip/reset was used. At **23:24:03** the log recorded `round complete type=work skipped=false`, release ACK revision 4, and automatic long-break start for 60 seconds. Screenshot shows the still-locked long break at 00:45. A fresh `https://example.com/` navigation loaded its actual domain documentation page during that break.
- At **23:25:03**, `round complete type=long-break skipped=false` was logged. The app returned to idle Work 02:00, Play visible, selector unlocked; it did not auto-start another work round with the temporary auto-start-work setting disabled. `pomotroid-native-natural-break.png`, `pomotroid-native-natural-restored.png`, and `pomotroid-native-natural-final.png` capture these states in the evidence directory above. This verifies this Firefox fixture's natural final cycle and domain restoration; it is not a blanket cross-platform restoration claim.
- Through the real UI, restored Auto-start Work to **1**, deleted only the disposable Guest Native Acceptance session and observed original **Pomodoro**, **05:00** idle. The app and isolated Firefox quit normally while unlocked. Cleared held keys. With the app stopped, atomically restored the private pre-test browser configuration byte-for-byte and removed only its owned temporary backup; credentials were never printed.
- Two separate guest process/listener inspections found no Pomotroid/Firefox/Zen processes and no listeners on 1420/1421/9222. Stopped the Tart guest started by this assistance and verified its state outside the restricted-context inventory. OMP may resume guest ownership after the explicit collab handoff.

The native Command-Q blocker remains open. Correct-passphrase success, inconclusive fresh blocked navigation, and the other existing browser/platform gates remain open. No source behavior, signed bytes, signing guard or emergency credential was changed by this assistance.
