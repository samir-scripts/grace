# Disposable macOS focus acceptance

These tools prepare a disposable Tart clone and record observations for manual review. They do not establish native acceptance by themselves. Use an exclusively owned guest, never a personal browser profile or host application policy. The `pomotroid-zen-clean` baseline should be stopped and free of copied host permissions, profiles, credentials and policies. Guest automation requires explicit owner approval for guest-only Accessibility and AppleScript; grant permissions through the guest's normal UI. Do not alter the TCC database or host permissions. If access is unavailable, record the affected checks as blocked.

## Prepare the run

Use Apple Silicon macOS, an existing stopped baseline and at least 15 GiB free. Install [Tart](https://tart.run/quick-start/) or point to an existing executable. Provisioning uses the pinned [official Zen release](https://github.com/zen-browser/desktop/releases/download/1.24.1b/zen.macos-universal.dmg), [official Discord download](https://discord.com/api/download?platform=osx), and public [Mozilla Add-ons](https://addons.mozilla.org/) artifacts; it verifies application signatures and the signed companion against its local provenance and source. Review the chosen config before use. `config.example.json` installs no extra extensions; `config.zen-1.24.1b.json` is the supplied matching configuration.

To create a config from a profile, export only public extension identities, URLs, hashes and allowlisted scalar preferences. The exporter reads the specified local profile; it does not copy browser storage or credentials. Review omitted artifacts and the output before sharing or provisioning:

```sh
python3 scripts/guest-focus/export-config.py --profile /path/to/zen/profile --output /tmp/grace-guest-config.json
```

From the repository root, build the packaged app and set the actual Tart executable. Use any installed Tart path; this workspace also contains the verified executable shown below:

```sh
npm ci
npm run tauri build -- --debug --bundles app
export TART_BIN="$(command -v tart)"
# Or set TART_BIN to the absolute path of the official Tart executable.
python3 scripts/guest-focus/runner.py create --baseline pomotroid-zen-clean --config /tmp/grace-guest-config.json --app src-tauri/target/debug/bundle/macos/Grace.app
export RUN_ID='UUID-printed-by-create'
```

Every runner action also accepts `--tart /path/to/tart`; this overrides `TART_BIN`. Create snapshots exportable tracked and untracked source into `.superpowers/sdd/tart-focus-acceptance/$RUN_ID/source.tar.gz`, records HEAD, per-file hashes, archive hash and a SHA-256 of the current dirty diff in `run.json`, and creates a uniquely named clone. The dirty patch itself is not saved; preserve it separately if needed. The exporter restricts file types and excludes credential filenames, databases, build caches and external symlinks. Review exported source before sharing it. An optional `--app /path/to/Grace.app` on `create` includes a prebuilt bundle and records its executable hash; otherwise build from the exported source in the guest.

If the baseline does not exist, create it once from the immutable image used for this run. This initial image download needs substantially more disk space than a copy-on-write local clone; check capacity first. The baseline stays unmodified by acceptance runs:

```sh
TART_NO_AUTO_PRUNE=1 "$TART_BIN" clone ghcr.io/cirruslabs/macos-sequoia-base@sha256:eee659985b01e4df2a6c0754bd8d25e54969933c43fdcd4edef8bea337b3d354 pomotroid-zen-clean
```

Run the baseline creation **before** `runner.py create`. The approved signed XPI and provenance must be available under `extensions/signed/firefox/`; use the maintainer-provided exact artifact described in [extension documentation](../../extensions/README.md). Do not replace it with an unsigned build. Host build prerequisites are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

Keep the graphical guest running in a separate terminal:

```sh
python3 scripts/guest-focus/runner.py boot --run-id "$RUN_ID"
```

After the guest is ready, provision the isolated pass. The recommended prebuilt bundle is at `/Users/admin/grace-acceptance/$RUN_ID/Grace.app` and can be launched with `runner.py exec --run-id "$RUN_ID" --command /usr/bin/open "/Users/admin/grace-acceptance/$RUN_ID/Grace.app"`. Alternatively, build in the guest with its signed-artifact guard enabled:

```sh
python3 scripts/guest-focus/runner.py provision --run-id "$RUN_ID" --pass isolated
python3 scripts/guest-focus/runner.py exec --run-id "$RUN_ID" --command /bin/sh -c 'cd "$HOME/grace-acceptance/'"$RUN_ID"'/source" && npm ci && npm run tauri build -- --debug --bundles app'
```

The guest needs Node/npm and the Rust/Tauri build prerequisites. Resolve missing prerequisites through official sources; do not disable the signing guard. With the default Cargo target directory the executable is `/Users/admin/grace-acceptance/$RUN_ID/source/src-tauri/target/debug/bundle/macos/Grace.app/Contents/MacOS/pomotroid`; verify the actual build output if Cargo is configured differently. Launch the packaged app in the guest and enable verbose logging in its UI. Install/enable the signed companion through the app's normal setup, open Zen, and give consent through the real companion UI. Do not bypass consent or export private configuration.

Run the isolated pass first. Close Zen, then switch to the matching pass with the same run and provisioned applications:

```sh
python3 scripts/guest-focus/runner.py provision --run-id "$RUN_ID" --pass matching --skip-download
```

The isolated policy blocks configured competing blockers; matching enables the configured set according to its `enabled` flags. Each pass needs its own baseline and observations. Provisioning refuses a running Zen, mismatched guest marker, foreign profile setup, or installed applications that do not match the prior record. Do not run passes concurrently.

## Native checks and probes

In the actual packaged app, create a disposable focus session through the UI: block `example.com`, `youtube.com`, `instagram.com`, and `reddit.com`; select Discord in the application picker; set two-minute work, one-minute short and long breaks, and two work rounds; disable automatic work start and enable unblocking during breaks. Save and reopen the profile to verify persistence. Confirm the signed companion is connected and an active policy is acknowledged after starting work. Record timestamps and revisions with screenshots or other native UI evidence; redact secrets and private identifiers. Do not infer the timer state from a browser fixture.

After explicit guest-only automation approval, `ui.py` can inspect or operate the actual app via System Events. Commands execute in the guest and require the runner's opt-in environment and run marker. For example:

```sh
python3 scripts/guest-focus/runner.py exec --run-id "$RUN_ID" --command /usr/bin/python3 "/Users/admin/grace-acceptance/$RUN_ID/source/scripts/guest-focus/ui.py" --run-id "$RUN_ID" dump
python3 scripts/guest-focus/runner.py exec --run-id "$RUN_ID" --command /usr/bin/python3 "/Users/admin/grace-acceptance/$RUN_ID/source/scripts/guest-focus/ui.py" --run-id "$RUN_ID" click 'Control name from dump'
```

`set AXRole index value` and `key macOS_key_code` are also supported. Inspect the current UI before each action; indexes and labels can change. Secure text fields are excluded: credential entry remains under user control. Automation errors are blocked checks, not passes.

For browser observations, start the provisioned Zen profile with `--remote-debugging-port 9222` in the guest, complete actual signed-companion consent, and use a guest Node version with built-in `WebSocket`. Capture baseline before starting the work round; invoke the same command for `work` during the active round and `released` after release, substituting the phase and pass:

```sh
python3 scripts/guest-focus/runner.py exec --run-id "$RUN_ID" --command node "/Users/admin/grace-acceptance/$RUN_ID/source/scripts/guest-focus/browser-probe.mjs" --run-id "$RUN_ID" --phase baseline --pass isolated --log '/Users/admin/Library/Logs/com.splode.pomotroid/Grace.log'
```

The probe records fresh-tab navigation for blocked domains, subdomains and allowed controls. Work classification requires an earlier loaded baseline and a fresh matching bridge ACK in the same log; failures and unavailable sites remain inconclusive. Use `--retain-existing true` during baseline to retain two owned blocked-site tabs for subsequent work/release checks. The probe does not prove the native timer, selected profile or release state.

For Discord, substitute the verified packaged executable and guest evidence path below. Run baseline with Discord closed; during work supply an existing evidence file captured from the actual native UI. Repeat with `break` and `released` after the corresponding real transitions. Change the pass name for the matching pass:

```sh
python3 scripts/guest-focus/runner.py exec --run-id "$RUN_ID" --command /usr/bin/python3 "/Users/admin/grace-acceptance/$RUN_ID/source/scripts/guest-focus/scenarios.py" --run-id "$RUN_ID" --phase baseline --pass isolated --app "/Users/admin/grace-acceptance/$RUN_ID/Grace.app/Contents/MacOS/pomotroid"
python3 scripts/guest-focus/runner.py exec --run-id "$RUN_ID" --command /usr/bin/python3 "/Users/admin/grace-acceptance/$RUN_ID/source/scripts/guest-focus/scenarios.py" --run-id "$RUN_ID" --phase work --pass isolated --app "/Users/admin/grace-acceptance/$RUN_ID/Grace.app/Contents/MacOS/pomotroid" --active-evidence /path/in/guest/to/native-evidence
```

The work probe observes an existing process and three bounded launch attempts. Other phases check survival for three seconds. It terminates only its own directly launched child and never force-quits arbitrary processes. Process exit alone may be an updater failure, so this is a process observation, not enforcement proof. Evidence-file contents are not verified; overall native acceptance intentionally remains blocked.

Manual acceptance remains pending until each pass demonstrates existing-tab and fresh HTTP/HTTPS blocking, allowed controls, Discord already running and relaunched during work, an unselected app remaining usable, break restoration and reapplication, natural completion, restart, disconnect/retry, protected quit and emergency release. Record actual UI state, policy ACKs and restoration, including failures. Run the existing guest Gecko tests and their documented environment separately; see [extension documentation](../../extensions/README.md) and [guest invocation](../../plans/zen-gecko-csp-repair-plan.md#guest-only-regression-invocation). Batch diagnosed fixes, then rerun the affected native scenarios and relevant checks; do not carry forward stale evidence as a new pass.

## Collect and stop

```sh
python3 scripts/guest-focus/runner.py collect --run-id "$RUN_ID"
python3 scripts/guest-focus/runner.py stop --run-id "$RUN_ID"
```

Collection copies only selected run JSON reports, not browser profiles or raw credentials. Check the printed host directory and preserve separately captured, redacted UI evidence. Stopping targets the owned clone and does not delete it or alter the baseline. Initial `results.json` entries remain blocked until independently reviewed and updated; the scripts do not automatically promote them to passing.

For interrupted provisioning, use `runner.py provision --run-id "$RUN_ID" --resume`. The owned app records preserve verified downloads. Use `--skip-download --pass matching` after closing Zen to switch passes; app signatures and hashes are checked again. Network-unavailable add-ons are recorded; corrupt or mismatched artifacts fail provisioning.

Controlled HTTP: append `--mode controlled --retain-existing true` to the baseline browser probe, then use `--mode controlled` for work and release. It serves unique nonce pages through an owned loopback proxy. A blocking observation requires both an aborted navigation and no matching proxy request. Public HTTPS probes remain separate. Capture baselines while the full focus cycle is unlocked; a paused second work round can already enforce blocking.

Custom websites: edit `targets.example.json` (separate `blocked` and `allowed` URL lists), configure the same blocked domains in the native session, and pass `--targets "/Users/admin/grace-acceptance/$RUN_ID/source/scripts/guest-focus/targets.example.json"` to each probe phase. Targets must be public HTTP(S) domain URLs without credentials; at most 256 are accepted. Changing targets invalidates old baselines.

Matching provisioning is blocked if any **enabled** configured extension is unavailable. Missing disabled add-ons are recorded as differences. Raw probes remain observations until native UI and log review promotes individual scenarios; they never establish a full acceptance pass on their own.

When Firefox refuses inspection of signed extension pages without privileged system access, keep that protection enabled. Open public pages before work, then run `existing-tabs.py --run-id "$RUN_ID" --pass matching --tabs 3` through `runner.py exec` during work. It reads the native Zen address bar and records only exact signed-companion block pages for approved targets. Keyboard tab selection can repeat the same tab: review distinct verified targets, not the number of attempts. Correlate with the preloaded page title, active native countdown, and ACK.

Tooling checks: `npm run test:guest-focus`. This runs the Python ownership/configuration tests and Node probe tests without starting Tart. `npm run guest:focus -- <action> ...` is shorthand for the runner. Collection includes sanitized accessibility snapshots while omitting input fields and private profile identifiers.

Run Cargo build, test and Clippy commands sequentially. Concurrent Tauri builds can replace dependency artifacts while rustdoc is reading them; a missing-crate doctest error in that situation needs a serial rerun after the build finishes.

For reset regression acceptance, use a separate 60/60/60-second, two-round profile with a blocked domain. During work, Restart Round must keep focus locked. During its final break-to-work transition, a deliberate emergency hold must return to Work round 1, idle, and unlocked. A rapid start must wait until the reset has finished. Restore the main profile afterward.
