# Reproducible Zen and Discord acceptance testing in Tart

**Goal:** Reproduce the host Zen version and public extension configuration in isolated Tart guests and verify packaged Grace website/application blocking.

**Execution:** Native guest acceptance in batches. Delegated preparation and edits use GPT-6.1 Terra, medium reasoning. Preserve pre-existing working changes. Tooling and defaults live in `scripts/guest-focus/README.md`.

## Batches

- [x] Add owned guest lifecycle, sanitized configuration export, official app installation, source/build hashes and guarded probes.
- [x] Reproduce and repair uppercase scheme and wildcard domain validation bugs; add regression cases.
- [x] First guest provisioned: Zen 1.24.1b, Discord 0.0.421. Real UI saved four blocked domains, Discord, 120/60/60-second durations and two rounds.
- [x] First isolated work pass: public apex sites and www.youtube.com/old.reddit.com blocked with NS_ERROR_ABORT; allowed controls loaded; Discord relaunch process observations passed three attempts. Native selected profile, countdown and signed active-policy ACK observed separately.
- [x] Natural first-break restoration and required-browser disconnect/retry (paused at 01:56, recovered at 01:54).
- [x] Repair native final focus unlock in source: regression reproduced the lock then passed all four break combinations. Repaired native two-round cycle passed: after the final long break, Save Changes succeeded and ordinary Quit terminated normally. The original failure remains recorded.
- [x] Emergency hold/release, repaired natural final restoration, controlled HTTP example.com and one distinct existing Reddit page; mobile/HSTS and privileged remote inspection limits are recorded.
- [x] Matching extension website/Discord pass, measured relaunch latency and complete native cycle.
- [x] Second clean clone provisioning reproduction: documented command succeeded without recovery; both official app versions and enabled extension readiness match.
- [x] Final checks, review, evidence report and owned guest cleanup. See tart-focus-acceptance-report.md.

## Decisions and evidence limits

- Match public extension versions, preferences and enablement without copying storage, accounts or browser data. One disabled Color Picker download was unavailable and is recorded.
- Website entries are domains, not arbitrary regular expressions. Bare/apex/subdomain URL cases and unrelated host/query controls are tested.
- Native profile configured through settings UI and Discord selected with the installed-app picker. No production IPC bypass is used to configure acceptance state.
- The clean guest required System Events automation approval. Owner explicitly approved guest-only Accessibility/AppleScript; the normal guest prompt was accepted. No host permissions or TCC database changes.
- Zen DMG Finder metadata initially failed strict signature verification. Provisioning now stages via ditto without resource metadata, verifies strict signatures and pinned vendor identities, then installs. A partial extension download exposed missing resume support; verified app records and bounded extension retries now preserve progress.
- First run source archive predates those tooling repairs; record transferred-tool hashes separately. Packaged app comes from the normal signed-artifact-guarded debug build. Diagnostic-only log changes require a rebuild before subsequent native passes.
- Initial Rust tests failed due to restricted loopback access. Unrestricted required suite passed. Clippy found pre-existing warnings/errors; do not describe it as passing.
- Raw probe reports deliberately retain `native_acceptance: blocked` until independent UI/log review. They cannot promote process exits or blank pages into proof.

## Native completion defect (new repair batch)

The first two-round cycle completed work/short-break/work/long-break naturally, but profile saving and ordinary Quit remained locked. Closing Zen afterward caused enforcement loss while the timer was idle. `TimerController` calculated the last-round flag after `SequenceState::advance()` reset the work counter. Existing lifecycle tests supplied a hardcoded true flag and missed the actual boundary; disabled-long-break cycle handling also needs explicit transition metadata. A regression using the real sequence boundary and native two-round retest are required before completion is marked passed.

## Matching pass in progress

The repaired packaged build started a fresh matching cycle with LeechBlock, uBlock Origin and Privacy Badger active. Public HTTPS blocking and allowed controls passed again. Controlled HTTP `example.com` was blocked with no nonce proxy request while controls loaded; social HTTP targets upgraded via HSTS and are inconclusive, not failures. Discord relaunches exited in 1098, 1044 and 1018 ms with no observed helper PIDs afterward. A Firefox BiDi context-ID reset made retained-tab checks inconclusive despite visible companion block pages; the probe is being repaired to reacquire uniquely matching owned pages.

## Emergency reset repair batch

After an emergency hold spanning a break transition, focus unlocked but the timer remained at round 2 of 2. The controller sent the same engine Reset used by Restart Round, which intentionally preserves sequence position. The ordinary reset listener also cleared focus state on Restart Round. These reset scopes must be separated: emergency reset returns to Work round 1 and a protected current-round restart retains its focus lock. Regression coverage and the short, separate native fixture passed; the main acceptance profile retains its 120/60/60-second defaults.

The final reset repair also fences rapid starts and stale completion events until the timer sequence and first-work duration are ready. A generation captured under the transition gate rejects requests that read the pre-reset round. Real-engine interleaving tests cover queued completion, pending start rejection, fresh Work start and active enforcement; aborted session rows are closed as incomplete. Native short-fixture retest passed: protected restart kept the same PID; the hold reset Work round 2 to idle Work round 1.

## Final acceptance

The final packaged reset build passed native protected round restart (same PID survived Command-Q) and a continuous hold reset Work round 2 to idle Work round 1. Statistics recorded the interrupted restart as incomplete (7 work attempts, 6 complete, 660 completed seconds). Two checks found no owned app/browser processes or listeners on 1420/1421/9222. Both UUID-owned clones and the preflight clone are stopped. The optional capture bypass prompt was left unapproved. Verification and explicit inconclusive cases are in [the report](tart-focus-acceptance-report.md); Clippy remains blocked by 13 existing diagnostics.

All five implementation batches are complete with explicit inconclusive cases retained in the evidence report. Final verification: 186 Rust tests, 65 frontend/extension tests and 34 harness tests passed; strict Clippy retains 13 existing diagnostics. No user changes were staged, committed or discarded.
