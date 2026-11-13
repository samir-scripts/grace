# Experimental beta and branded extension pages

Approved plan, 2026-11-13.

## Goal and constraints
Publish explicitly unverified Windows/Ubuntu x64 manual betas before contributor native acceptance. Preserve automated quality gates, signatures, code review, IDs, protocol 3 and Safari output. No first-party x64 packaged runtime tests or new x64 VMs. Stable releases require reviewed, current per-platform evidence. Website-only organization grace-focus; homepage https://grace-focus.github.io/ and privacy https://grace-focus.github.io/privacy/. Desktop repository stays samir-scripts/grace.

## Tasks
- [ ] Website organization/root Pages repository, combined privacy, beta links and publication.
- [ ] Chrome 1.1.2 and Firefox 1.1.1 homepage/privacy UI, deterministic Firefox payload, real unlisted signing.
- [ ] Desktop 1.7.2-beta.1, manual prerelease automation, checksums and stable-evidence gate.
- [ ] Contributor PowerShell/Bash entrypoints, native checklist and evidence validation.
- [ ] Full local/exact-head CI checks, independent code review and focused macOS packaged acceptance.
- [ ] Promote dev/stage/release, publish manual desktop beta, update listings and submit Chrome Public automatic publication.

## Decisions and evidence
- Base is staging 5387c7fd8fbff35d0025a74f587bbd005319b077. Original dirty checkout is preserved.
- Windows and Ubuntu native acceptance is unverified / deferred to contributors; this is an owner-approved gate waiver, never a pass.
- No stable updater feed or latest.json publication for beta. Exact artifacts and checksums precede store submission.
- Firefox remains unlisted with manual/desktop-managed updates. Signed guard stays strict; no new permissions or protocol changes.
- Public Chrome submission uses existing ID and normal store rollout, not an isolated beta track.


### Staging integration timing repair
PR #4 exact-head checks passed, then staging run 43388097152 failed the existing first Chromium test: it read `Checking connection…` before the asynchronous initial `Disconnected` status settled. The test now waits for that actual final state rather than asserting immediately after navigation. No production extension payload, signature, permissions or protocol changes. Fresh exact-head CI is required.
