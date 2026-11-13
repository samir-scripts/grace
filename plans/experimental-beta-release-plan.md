# Experimental beta and branded extension pages

Approved plan, 2026-11-13.

## Goal and constraints
Publish explicitly unverified Windows/Ubuntu x64 manual betas before contributor native acceptance. Preserve automated quality gates, signatures, code review, IDs, protocol 3 and Safari output. No first-party x64 packaged runtime tests or new x64 VMs. Stable releases require reviewed, current per-platform evidence. Website-only organization grace-focus; homepage https://grace-focus.github.io/ and privacy https://grace-focus.github.io/privacy/. Desktop repository stays samir-scripts/grace.

## Tasks
- [ ] Website organization/root Pages repository, combined privacy, beta links and publication.
- [x] Chrome 1.1.2 and Firefox 1.1.1 homepage/privacy UI, deterministic Firefox payload, real unlisted signing.
- [ ] Desktop 1.7.2-beta.1, manual prerelease automation, checksums and stable-evidence gate.
- [x] Contributor PowerShell/Bash entrypoints, native checklist and evidence validation.
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

### Grace-owned signing identity
The configured updater public key was inherited unchanged from upstream commit 54308fe. No matching private key was found, and the Grace release inventory was empty. On 2026-11-13 the owner explicitly approved creating a Grace-owned key and a manual installer transition. The new private key is owner-readable, ignored, and configured in GitHub Actions; no private material is committed. Public-key SHA-256 (decoded Minisign public-key file): c6216550da764b8f1827a50e72af60c6b7cde8c632b214b0c1c8e9770ec70b22. A public fixture verified with the new key; tampered bytes and the inherited key were rejected. Existing installs cannot authenticate new-key-only updates, so the beta remains manual and the stable feed remains untouched. No unsigned fallback or bridge signed with an unavailable old key is introduced.

### Current publication evidence
- Canonical website repository is `grace-focus/grace-focus.github.io`, source 31ddf1591d88e4f932300605edbf3e735f81535b; Pages run 43388487269 passed. Homepage and `/privacy/` returned anonymous HTTPS 200 with correct canonicals and combined Chrome/Firefox coverage. Exact beta download rows remain hidden until public assets exist.
- Chrome 1.1.2 ZIP inventory and every byte match its payload; SHA-256 `99c1266e32f91ec01463acea300b4135eebd37a065f3e9c91070f044b4a4a898`. Genuine Mozilla unlisted Firefox 1.1.1 XPI SHA-256 `4903f864b9154118a435476308a1a1c57e7468ca54a1691d2284e5db55b54443`. Chrome listing/AMO homepage, privacy and experimental-status metadata were saved; Chrome remains unsubmitted pending public desktop assets and final-candidate acceptance.
- PR #5 is merged as b13c00f4fc3ee138daffb712a75a0aad125f57a8. Dev Build/Test 43465068361 and CodeQL 43465068222 passed; stage Build/Test 43465110604 and CodeQL 43465110525 passed. The macOS retry for PR #5 passed after GitHub runner-capacity cancellation. Signing changes require fresh exact-revision gates.
- Signing automation now requires a detached `.sig` for every published package, verifies against the Grace public key before assembly, and exports `grace-updater.pub`. Existing signatures are verified without replacement. Missing-signature regression observed RED then GREEN; full npm suite passed 177 tests with 2 optional skips. Real Tauri signatures for six public fixture formats verified through `minisign-verify` 0.3.0; tampered package bytes failed. Production release assembly uses the system Minisign verifier and still needs its first live run.
- Preliminary macOS packaged checks used owned guest bebf88ce-791e-4aba-b648-08821e76efe5 and b2f29ff production arm64 app executable SHA-256 `ea32ac573a0c7e0a925358fde5d4a85eaa5d84e5cbb3839626f0d56782d9d16b`. Chrome 1.1.2 reconnected after a manual bundle update. Withdrawal, pre-consent Privacy navigation without accepting consent, explicit reconnect, existing HTTPS blocking, fresh HTTP blocking, allowed control, natural completion and restored access were observed through native UI. Both footer destinations worked after consent. This is focused preliminary evidence, not final-candidate or full native acceptance.
- Official Mozilla Firefox 160.0 was signature-verified and installed only in the owned guest. Optional technical/interaction and automatic crash reporting were off before owner-authorized Terms acceptance. The exact bundled signed 1.1.1 XPI installed through normal Firefox UI; Privacy opened the hosted policy before consent and sharing remained disabled. Further final-candidate Firefox/native observations remain pending.
- Windows/Ubuntu packaged runtime checks remain unverified / deferred to contributors. No first-party x64 runtime test or new x64 VM was performed. Store-installed acceptance remains post-approval work.

- Offline inspection of PR #5's NSIS installer (no execution) observed numeric FileVersion/ProductVersion `1.7.2.0` and UTF-16 SemVer string `1.7.2-beta.1`, matching Tauri's source-derived conversion. The CI installer SHA-256 was `b39f2e699d68abbac29537ad6c74162f7f4cb0978c744b7b5aa7d8ef7b7bf68e`; Authenticode certificate was absent. This is packaging evidence only, not installation/runtime acceptance. Stable `1.7.2` shares the numeric Windows version; SemVer and numeric installer ordering must remain distinct.
