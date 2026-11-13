# Experimental beta and branded extension pages

Approved plan, 2026-11-13. Implementation and beta publication completed; Chrome review and post-approval store-installed acceptance remain external follow-up.

## Goal and constraints

Publish explicitly unverified Windows/Ubuntu x64 manual betas before contributor native acceptance. Preserve automated quality gates, signatures, code review, IDs, protocol 3 and Safari output. No first-party x64 packaged runtime tests or new x64 VMs. Stable releases require reviewed, current per-platform evidence. Website-only organization grace-focus; homepage https://grace-focus.github.io/ and privacy https://grace-focus.github.io/privacy/. Desktop repository stays samir-scripts/grace.

## Tasks

- [x] Website organization/root Pages repository, combined privacy, beta links and publication.
- [x] Chrome 1.1.2 and Firefox 1.1.1 homepage/privacy UI, deterministic Firefox payload, real unlisted signing.
- [x] Desktop 1.7.2-beta.1, manual prerelease automation, checksums and stable-evidence gate.
- [x] Contributor PowerShell/Bash entrypoints, native checklist and evidence validation.
- [x] Local/exact-head CI checks, independent code review and focused final-candidate macOS packaged checks.
- [x] Promote dev/stage/release, publish manual desktop beta, update listings and submit Chrome Public automatic publication.

## Remaining external and stable-promotion checks

- [ ] Google review/approval and subsequent store-installed acceptance. Submission is not approval.
- [ ] Separate reviewed Windows x64 and Ubuntu x64 native reports before stable promotion. Both remain **unverified / deferred to contributors**.
- [ ] Any broader native/browser scenarios outside the focused macOS checks below. Missing, skipped, failed or inconclusive scenarios are not acceptance passes.

## Decisions and evidence

- Base is staging 5387c7fd8fbff35d0025a74f587bbd005319b077. Original dirty checkout is preserved.
- Windows and Ubuntu native acceptance is unverified / deferred to contributors; this is an owner-approved gate waiver, never a pass.
- No stable updater feed or latest.json publication for beta. Exact artifacts and checksums precede store submission.
- Firefox remains unlisted with manual/desktop-managed updates. Signed guard stays strict; no new permissions or protocol changes.
- Public Chrome submission uses existing ID and normal store rollout, not an isolated beta track.


### Staging integration timing repair

PR #4 exact-head checks passed, then staging run 43388097152 failed the existing first Chromium test: it read `Checking connection…` before the asynchronous initial `Disconnected` status settled. The test now waits for that actual final state rather than asserting immediately after navigation. No production extension payload, signature, permissions or protocol changes. Subsequent exact-head dev/stage checks passed; the final revision evidence is recorded below.

### Grace-owned signing identity

The configured updater public key was inherited unchanged from upstream commit 54308fe. No matching private key was found, and the Grace release inventory was empty. On 2026-11-13 the owner explicitly approved creating a Grace-owned key and a manual installer transition. The new private key is owner-readable, ignored, and configured in GitHub Actions; no private material is committed. Public-key SHA-256 (decoded Minisign public-key file): c6216550da764b8f1827a50e72af60c6b7cde8c632b214b0c1c8e9770ec70b22. A public fixture verified with the new key; tampered bytes and the inherited key were rejected. Existing installs cannot authenticate new-key-only updates, so the beta remains manual and the stable feed remains untouched. No unsigned fallback or bridge signed with an unavailable old key is introduced.

### Final publication evidence

- Desktop [v1.7.2-beta.1](https://github.com/samir-scripts/grace/releases/tag/v1.7.2-beta.1) is public as a GitHub prerelease, explicitly not latest. The immutable payload source is `f7f28c2a53351a0fdbcf41264c2c709d5421e4c3`; annotated tag object `61b49be0d4b5c26a78a48050d0e318dc5928b0be` resolves to that source. Signed release workflow `43474131019` passed. All 15 public asset server digests and all 14 checksum entries matched the canonical local files; six package signatures verified independently with Minisign 0.12. Public package downloads returned anonymous HTTPS 200 with matching hashes.
- No `latest.json` is attached to this beta. The stable `main/latest.json` blob remained `4ee2a9fedc5deee66cbfffbf28e870c49fe9176d` before and after publication; the unauthenticated latest-release endpoint returned 404. Distribution and updates remain manual.
- Canonical website repository is `grace-focus/grace-focus.github.io`, source `d207d053c2b659a492d826378ebbb54f5962eaed`; Pages run `43489245134` passed. [Homepage](https://grace-focus.github.io/) and [privacy](https://grace-focus.github.io/privacy/) are public with correct canonical URLs and combined Chrome/Firefox coverage. Exact versioned Windows/Ubuntu beta download rows are now visible, including unverified blocking/recovery disclosures. Svelte/TypeScript checks reported zero errors/warnings; root and repository-prefix production builds passed. Published page checks observed no horizontal overflow at 320px (`scrollWidth` 320), desktop layout at 1280px, visible keyboard focus and direct privacy navigation. Original website repository and existing privacy URLs remain available.
- Chrome 1.1.2 ZIP has 21 files with exact inventory/byte parity; SHA-256 `99c1266e32f91ec01463acea300b4135eebd37a065f3e9c91070f044b4a4a898`. Authenticated package state showed draft 1.1.0 before upload and 1.1.2 afterward. The existing item `cgibenlmgmblmalggjalnoaikjkdnoid` was submitted for **Public** distribution with automatic publication after approval on 2026-11-13. Google displayed **Pending Review** and confirmed submission for compliance review. Broad host permissions may require an extended review. The saved 464-character reviewer instructions link the public desktop beta and disclose unverified Windows/Ubuntu blocking and recovery. Store homepage/privacy/experimental-status metadata are updated. Approval and store-installed acceptance are not claimed.
- Genuine Mozilla **unlisted** Firefox 1.1.1 XPI SHA-256 is `4903f864b9154118a435476308a1a1c57e7468ca54a1691d2284e5db55b54443`. Available AMO homepage/description metadata were saved with the shared website/privacy URLs and experimental platform status. Distribution remains the established signed desktop/manual path, with no public AMO listing or self-update service. IDs, protocol 3, browser minimums and permissions are unchanged.
- PR #6 merged as payload source `f7f28c2a53351a0fdbcf41264c2c709d5421e4c3`; dev Build `43472078838` / CodeQL `43472078830` and stage Build `43472350601` / CodeQL `43472350055` passed. PR #7's filename-only assembly repair merged as `d4b282239b86202333043ab53704a2c7aebc73eb`; dev Build `43486074854` / CodeQL `43486074952` and stage Build `43486286551` / CodeQL `43486286481` passed, then `release` fast-forwarded to that revision. The beta tag stayed on its actual payload source. Exact-head automated gates, all-platform packaging and independent code review were retained.
- Local verification observed 177 npm tests passed with two optional skips before the filename repair, followed by 35/35 packaging regression tests after it. Chromium integration passed two tests; Rust passed 214 tests with 19 opt-in ignores and the documented accessibility exclusion; Clippy with denied warnings passed. Filename normalization and missing-signature regressions were observed RED then GREEN. Independent focused review of the filename repair found no issues. These automated/static results do not replace native acceptance.

| Public package | SHA-256 |
| --- | --- |
| `grace-windows-x64-1.7.2-beta.1-setup.exe` | `0d7803881167e34e0794c3d89610f0d24efa48e23802c750b6b6d4099dddeb01` |
| `grace-ubuntu-x64-1.7.2-beta.1.deb` | `4c60f70f9ad7a2545284574c0b1092eb26343390d184fe4199c4abad6029db85` |
| `grace-macos-universal-1.7.2-beta.1.dmg` | `e514d45908ae5dbab2b80a992abc0fae36c87021156b78890e82ebf6f6dfa080` |

### Final-candidate native scope and limitations

- The actual release DMG from source `f7f28c2a53351a0fdbcf41264c2c709d5421e4c3` was checked only in owned disposable macOS guest `bebf88ce-791e-4aba-b648-08821e76efe5`: macOS 15.7.7, Chrome 157.0.8103.79 and official Firefox 160.0. The guest is stopped. The original dirty app checkout and clean guest baseline were preserved.
- Exact final app Chrome 1.1.2 and signed Firefox 1.1.1 checks observed automatic pairing/reconnection, footer navigation with consent preserved, an actual baseline page body, a running native countdown with fresh policy ACK, an actual blocked-page body, natural completion and restored page access. Firefox installed the genuine signed XPI through normal browser UI. Optional technical/interaction and crash reporting were disabled before owner-authorized Firefox Terms acceptance. No private browser profiles or pairing credentials were exported.
- The actual DMG's complete Chrome (21 files), Firefox (15 files) and Safari (14 files) inventories and every byte matched deterministic source composition. Safari output was unchanged. Strict signed-payload verification includes the Firefox footer override and rejects tampering.
- Windows/Ubuntu packaged runtime checks remain **unverified / deferred to contributors**. No first-party Windows/Ubuntu x64 package was executed and no new x64 VM was provisioned. Offline inspection verified final Windows app/native-host PE x64 architecture and DEB amd64 ELF x64 architecture/version. Windows numeric FileVersion/ProductVersion is `1.7.2.0`, while the SemVer string is `1.7.2-beta.1`; stable `1.7.2` shares that numeric Windows version, so numeric installer ordering must remain distinct from SemVer. Other Linux artifacts remain experimental without Ubuntu evidence implying distribution or format equivalence.
- Detached Grace package signatures are verified; Developer ID signing/notarization and Windows Authenticode are not configured. macOS ARM64 ad-hoc signatures were verified, but full-bundle publisher signing is unavailable. These trust limitations are distinct from package checksum/signature verification.
- These focused macOS observations are not a full native acceptance report or store-installed acceptance. Broader crash recovery, emergency release, HTTP/HTTPS/subdomain and restart matrices are not newly claimed for the final candidate. Preliminary `b2f29ff` observations remain historical evidence in the execution ledger; inconclusive observations were not converted to passes. Stable publication still requires separate reviewed exact-source/exact-package Windows and Ubuntu reports; relevant package changes invalidate prior acceptance.

### Draft asset-name normalization

The first signed beta draft exposed GitHub normalizing `grace..app.tar.gz` to `grace.app.tar.gz`. The package and detached signature bytes verified, but the original checksum/provenance names did not match the uploaded names. The hold was resolved before publication by renaming the archive/signature assets and regenerating checksum/provenance metadata; all uploaded names and digests were then verified. Assembly now targets a versioned `grace-macos-universal-VERSION.app.tar.gz` alias and its matching signature, and the stable updater URL uses that same alias. This changes release filenames/metadata, not application bytes, extension payloads, or the immutable beta tag. Stable assembly also requires one unambiguous macOS updater archive. Beta publication still excludes `latest.json`.
