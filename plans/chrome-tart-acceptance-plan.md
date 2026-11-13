# macOS Chrome acceptance through Tart

Approved scope: restore the documented pinned Sequoia baseline, create an exclusively owned disposable clone, install official Google Chrome, and exercise the current production Grace app with the aligned Chrome companion. Do not submit the store draft or alter personal host policies/profiles. Windows/Linux and later store-installed acceptance remain separate gates.

## Preparation

- [x] Restore pinned baseline with automatic pruning disabled; never boot or modify baseline.
- [x] Rebuild production app from committed identity fix and record SHA/version.
- [x] Create owned clone with existing runner; skip Zen/Discord provisioning.
- [x] Transfer verified app/source; install official Chrome into guest and create fresh browser profile.
- [x] Obtain normal guest UI/automation access without bypassing OS security; guest permissions and host unlock were explicitly granted.

## Acceptance

- [x] Confirm extension ID `cgibenlmgmblmalggjalnoaikjkdnoid` in actual Chrome.
- [x] Register native host via packaged Grace settings; accept consent and pair without pasted credentials; assign Chrome profile.
- [x] Correlate native timer/policy ACK with existing-tab replacement, fresh HTTP/HTTPS/subdomain blocking and allowed control.
- [x] Restart Chrome and Grace separately; verify same profile reconnect and retained policy.
- [x] Natural completion and authorized emergency exit restore navigation.
- [x] Withdrawal/disconnect retains rules; reconnect/authenticated release restores access.
- [x] Collect sanitized evidence, shut down owned clone, update readiness ledger.

## Execution ledger

- Starting source: `a0c52b5`, identity fix `8f42595`; pre-existing untracked `docs/` preserved. User's earlier selection to work in this checkout remains in effect.
- Tart 2.41.1 exists at the repo-local documented path. Baseline image is `ghcr.io/cirruslabs/macos-sequoia-base@sha256:eee659985b01e4df2a6c0754bd8d25e54969933c43fdcd4edef8bea337b3d354`.
- Runner tooling tests passed (Python suite and 7 Node probe tests). Baseline restoration and production rebuild started; neither is native acceptance evidence.

- Restored pinned baseline successfully without booting it. Created clone `grace-acceptance-bebf88ce-791e-4aba-b648-08821e76efe5` with existing runner and prebuilt production app; source/app hashes are in its owned `run.json`. No Zen/Discord provision command was used.
- Production app/DMG rebuild passed; packaged manifest matches source and app embeds committed `a0c52b5` source identifier. Official Chrome installer SHA-256: `890cbc357d91cc8b0de87033edee89534da385a97ec2b21e3c80b2125f45e4fd`. Signature verification is pending inside guest.

- Clone booted macOS 15.7.7 (24G720). Verified transfer matched rebuilt app executable SHA-256 `2d3fe6b071b1ed33a2a1eb89e771bdc44efedf7469109e39c826311ed4efb7b0` and native host `2fffacd06b5fc819b34bcf9436bfc45df7d4f965ae0359c31382470e67c01f5f`.
- Installed official Google Chrome 157.0.8103.79 in clone Applications. Codesign publisher is Google LLC (`EQHXZ8M8AV`), stapled notarization ticket. Initial strict verification failed on Finder presentation metadata included on the installer/copy; removed only `com.apple.FinderInfo` from the guest installed copy, then `codesign --verify --deep --strict` passed. No quarantine or security policy was removed. Baseline `spctl` reports security disabled; its assessment alone is not used as signature proof.
- User explicitly authorized guest-only AppleScript after Tart keyboard shortcuts proved unreliable. Existing UI helper triggered the guest macOS Automation prompt; current permission confirmation is pending. No TCC database edits or host permissions changes were made.

- User confirmed the live guest Automation prompt; allowed guest `tart-guest-agent` → System Events through normal macOS UI. Guest Accessibility was already enabled. Sanitized native Grace UI inspection succeeded. No host UI permissions or TCC database were modified.
- Chrome native UI accessibility required `AXEnhancedUserInterface=true`; ordinary menu Quit/relaunch and normal Chrome UI navigation were used. Chrome Developer mode is enabled in the owned profile. Loaded the packaged `Contents/Resources/_up_/extensions/dist/chrome` through Chrome's normal Load unpacked folder picker. Chrome opened the real companion consent/options page; visible state was Disconnected / Data sharing disabled with Accept & connect available. No manual token was entered. Runtime ID confirmation, native host registration and acceptance remain pending.
- Host computer locked before the next guest screenshot. Computer-use tool requires manual unlock; requested user unlock before further UI actions. Existing in-flight sanitized UI inspection completed and confirmed the consent page. Guest remains running while awaiting unlock.

## Approved repair discovered during acceptance

- Actual native Chrome restart reproduced a rule-retention failure: required connection closed, supervisor emitted `lease_failed`, controller sent authenticated inactive revision 2, timer paused at 07:52, and fresh example.com loaded. This is a release-blocking failure, not a passing reconnect test. Same browser profile reconnected without duplicates.
- User explicitly selected retained-blocking repair over the older pause-and-release behavior. Scope: pause timer, retain existing browser policy on browser connectivity/ACK loss, require explicit Retry to validate the same retained revision, keep failed Retry from releasing it, and retain cleanup ownership for authorized release. Native monitor failures keep existing cleanup behavior. No IPC/wire type change.
- New guest-only real authenticated controller/bridge regression failed with `browser disconnection must not publish an inactive policy` before production changes. Compiled on host without executing native enforcement, transferred and executed only in the owned guest.
- Before replacing the package, the original app's actual 60-second UI emergency hold completed and returned timer to idle 10:00. This is preliminary original-build evidence; repaired build will be retested.

### Repair verification

- Internal `BrowserLeaseLost` distinguishes browser connectivity/ACK failures from native/generic failures. Controller retains policy ownership while paused/Failed; explicit Retry checks the existing revision instead of reapplying; failed Retry does not clear rules. Authorized release and final-cycle cleanup still own the retained policy. Native monitor/generic failure and app-only cleanup behavior are preserved.
- Guest real authenticated controller/bridge regression passed after repair, covering same retained revision on reconnect, failed Retry retention, successful Retry, and authenticated inactive release from Failed state.
- Edge regressions reproduced and repaired protected-break Retry, ongoing native health while paused, app-only scoping, and cleanup recovery state preservation.
- Independent review found queued phase rollback and preference changes implicitly recovering Failed. Both new regressions failed before fixes. Fixed by preserving phase/round updates with Failed status and allowing only timer start/Retry to recover retained enforcement; queued round changes cannot auto-start while Failed. Full Rust suite then passed: 204 passed, 18 opt-in ignored, documented accessibility exclusion. Clippy and final guest probes are next.

- Repair committed as `34a266b` after review findings were fixed RED→GREEN. Full Rust suite: 204 passed / 18 opt-in ignored; Clippy passed. Final binaries from that run passed the real authenticated controller/bridge retained-policy test and browser-loss timer pause-ordering test inside the guest. Existing ABI/IPC/protocol structures are unchanged.
- Review boundaries retained: actual OS DND is not claimed passed by call-path review; late-participant cleanup and future-revision ACK validation are unchanged and outside this repair. No additional native/host credential access was used.
- Rebuilding production candidate from repair commit and replacing original guest app only after its normal authorized emergency release returned to idle. Normal app restart is tested through its guarded/authorized UI lifecycle, not represented as forced-termination durability.

## Approved forced-stop recovery extension

User explicitly included crash recovery after normal protected Quit was shown to be guarded. Actual macOS Force Quit through the guest Apple menu reproduced startup release: companion reauthenticated, received inactive revision 1, native timer restarted unlocked at 01:00, and direct example.com loaded. This fails the expanded app-restart requirement.

Repair scope: gate initial browser policy until startup recovery finishes; restore the journal's immutable profile, phase and round without publishing inactive; keep native timer stopped, conservatively restarting the interrupted phase at its full duration on explicit Retry because elapsed time is not persisted. Preserve protocol 3 and every serialized/IPC type. Retain rules/journal on failed restore or Retry; authorized emergency release remains available. Application-only startup cleanup retains existing behavior. Malformed journal must not send inactive rules or permit normal timer/profile mutations.

Regression for locked snapshot recovery failed before controller changes. Repaired browser-reconnect candidate `34a266b` already passed actual runtime identity, registration/automatic pairing, profile assignment, existing-tab replacement, HTTPS/subdomain and allowed controls, HTTP recheck, Chrome restart retention, consent withdrawal/reconsent, explicit Retry, natural cycle release, emergency hold release, protected Quit guard and authorized idle relaunch. These results do not substitute for a rebuilt crash-recovery candidate rerun. Sanitized interim report is in the owned runner directory; collection/shutdown waits for the expanded repair.

- Crash recovery committed as `c373d55`. Startup gate prevents an inactive initial policy; valid journal restores immutable targets/phase/round, with elapsed time conservatively reset to the full interrupted phase. Dirty phase/round updates are persisted while protection remains owned. Invalid JSON, unreadable rows and invalid phase/round/durations/domains keep the bridge gated, controls locked and journal retained until authorized release. Required participants and observed reconnecting optional participants are recovered; a closed optional browser does not prevent Retry. Native interception is rearmed only after participant ACKs while the native timer remains stopped.
- Review's P1 unreadable-row and P2 invalid phase/round/closed optional findings were fixed with failing regressions followed by passing checks. Added substitute-final-break regression to preserve natural cycle completion after recovery. Full Rust suite: 212 passed, 19 opt-in ignored, accessibility exclusion; Clippy passed. Three current guest probes passed: reopened SQLite + real authenticated bridge crash recovery; browser disconnect/reconnect retention; timer-start/pause ordering. Production rebuild and real forced-stop acceptance are next.


## Final observed macOS result

**Passed on macOS arm64 15.7.7 (24G720), Google Chrome 157.0.8103.79, packaged Grace 1.7.1 from c373d55.** Runtime metadata includes a `.dirty` version suffix from pending documentation; production source was committed before build. The current package hashes and exact native-host origin were verified inside the guest after the packaged Update Extension action.

- Real Chrome ID matched the store. Initial Install Extension, consent acceptance, automatic pairing and Chrome assignment succeeded without manual credentials. Final Update Extension reported installed and retained the same assigned required profile.
- Existing tab replacement, fresh HTTP/HTTPS and www subdomain blocking, and allowed example.org control passed. Native running timer and authenticated policy ACK correlated.
- Actual normal Chrome Quit, failed Retry while closed, restart/reconnect, sharing withdrawal, fresh blocked navigation while sharing disabled, and reconsent all retained active revision 1. Profile count stayed one with unchanged fingerprint.
- Actual macOS Force Quit confirmed Grace exited; relaunch retained the journaled session locked at stopped 10:00. Chrome reauthenticated, received active revision 1 and ACKed; fresh example.com remained blocked. Explicit Retry resumed the existing policy.
- Final 62-second continuous emergency hold returned idle 10:00; authenticated inactive revision 2 was ACKed and direct example.com loaded.
- Final one-minute work plus auto-started one-minute long break stayed protected; native normal Quit was refused while work ran. Final completion returned idle 01:00, inactive revision 4 was ACKed, direct example.com loaded, journal row count was zero, and SQLite recorded completed 60-second work/long-break sessions.
- Chrome upload ZIP integrity, exact 14-file allowlist, source bytes and packaged Chrome resource parity passed. Its SHA-256 remains `bf71aff118eefdc887bdeb868402127268ceffb5feee457d7ff747b0c2d9d58b`.
- Existing guarded collection copied only sanitized JSON/UI evidence. Runner stopped the owned acceptance clone and confirmed both clone and unchanged baseline stopped. No Zen/Discord provision, personal host profile, store upload or submission was used.

Evidence: [versions/hashes/results](evidence/chrome-macos-tart-2026-11-12.json), [sanitized real UI](evidence/chrome-macos-tart-ui-2026-11-12.txt), [current guest regressions](evidence/chrome-macos-tart-checks-2026-11-12.txt).

Remaining publication gates: disposable Windows and Linux packaged Google Chrome acceptance; matching public desktop candidate download URLs; later store-installed acceptance after approval. Store draft remains Private and unsubmitted. OS reboot/power loss and app-update crash boundaries were not separately exercised. macOS evidence does not pass other platforms.
