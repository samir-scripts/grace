# Contributor native acceptance

Windows x64 and Ubuntu x64 are experimental: packaged integration, blocking and recovery are unverified. Their beta publication is an owner-approved waiver, not a passing result. CI/headless fixtures do not replace native acceptance. Other Linux distributions/formats need their own results.

## Prepare an owned disposable environment
Use an actual x64 Windows or Ubuntu installation in an owned disposable VM/device. Never run enforcement tests against personal browser profiles, application policies, selected apps, hosts configuration, or DND settings. Use the standard browser data directory in that environment; custom Chrome data directories are unsupported. Install the exact versioned package, verify its SHA256SUMS and provenance source revision, and install official Google Chrome. No account or pasted pairing credential is needed. Keep the package available for hashing. Node 22+ is required for the report tools.

From the source checkout matching the package, create a report:

```powershell
./scripts/acceptance/windows.ps1 -Package C:/fixtures/grace-setup.exe -SourceRevision FULL_40_CHARACTER_SHA -Chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe' -Output windows.json
```

```sh
bash scripts/acceptance/ubuntu.sh ./grace.deb FULL_40_CHARACTER_SHA ubuntu.json
```

Exit 2 is expected: every case starts `not-run`. Tools inspect versions and hash the supplied installer; they do not install, register, launch Grace, alter browser settings, or establish native acceptance. The reviewer must verify that the installer is the package actually installed and that Chrome is the browser actually used.

## Observe each case through the packaged UI
For each report case, record `passed` only after observing the named behavior. Put sanitized timestamps, policy revisions, screenshots and explanations beside the JSON. Use `failed`, `inconclusive`, or `not-run` honestly; no skipped result is a pass.

- installation: packaged Grace launches; expected helper and resources exist.
- automatic_pairing, profile_assignment: Settings > Sessions installs the host/companion, Accept & connect pairs without pasted credentials, and the intended Chrome profile is assigned.
- policy_ack: a protected timer round advances with the matching authenticated active-policy ACK.
- existing_tabs, fresh_http, fresh_https, subdomains: preloaded and new blocked example.com pages and subdomains are blocked while work is active. Establish successful baselines first; a network timeout alone is inconclusive.
- allowed_control: example.org remains usable in the same round.
- browser_restart, app_restart, crash_recovery: separate ordinary browser restart and desktop restart/forced-stop recovery retain the same assigned profile and active blocking. Record the native recovery/Retry state and ACK.
- disconnect_withdrawal: stop sharing/disconnect; protected rules remain and timer recovery requires explicit consent/authentication. Verify failed Retry does not weaken protection and successful Retry resumes.
- natural_completion: finish the configured work/break cycle without skip/reset.
- emergency_release: perform the authorized native emergency flow; observe the release ACK.
- restored_access: after each legitimate release, formerly blocked fresh navigation succeeds.

Verify protected ordinary quit is denied before release and works afterward; include it with app_restart evidence. Restore guest settings, release active protection, remove only owned setup and stop the disposable environment. Never attach tokens, raw private configuration, browser storage or credentials.

Validate completed observations with `node scripts/native-acceptance.mjs --validate windows.json` (or ubuntu.json). Success means all observations are marked passed, not that a PR has been approved.

## Stable promotion
Open an evidence PR containing both reports and sanitized observations. A separate reviewer checks the exact package hashes/source, every scenario and cleanup, then approves the evidence PR. Populate each report's review PR URL, reviewer login and approved status to match that actual review. Stable release preparation checks the current GitHub review, source revision and actual package hashes; declarations alone are insufficient. New or rebuilt package bytes invalidate acceptance until retested. For stable promotion, first build the stable-tag candidate (publication stays blocked), test the downloadable CI artifacts, then dispatch with that original `candidate_run_id` plus the reviewed evidence commit as `acceptance_ref`. Promotion verifies and reuses those exact bytes instead of rebuilding. The release tag stays on the tested source commit. Stable Ubuntu support publishes only the accepted DEB; AppImage/RPM and Linux updater entries stay excluded until separately accepted. No report is required for this experimental beta.
