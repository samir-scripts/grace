# AMO ownership and Mozilla consent readiness

Evidence date: 2026-11-05 (UTC). This is an evidence-only prerequisite for a separate consent implementation and signed-Gecko submission. No AMO submission, signing request, manifest-version change, consent declaration, account-role change, or browser enforcement is authorized by this report.

## Readiness status

| Gate | Status | Evidence |
| --- | --- | --- |
| `ownership_status` | `UNVERIFIED` | AMO access was reported; authority over the exact GUID has not been evidenced. |
| `release_authority` | `UNVERIFIED` | No authenticated owner/developer role record. |
| `history_status` | `UNVERIFIED` | Listed/unlisted version history has not been inspected in an authenticated account. |
| `source_version_availability` | `UNVERIFIED` | Source version is not proof that the version is unused on AMO. |
| `classification_status` | `UNVERIFIED` | Source/policy mapping is the next evidence task. |
| `consent_status` | `UNVERIFIED` | Exact obligations and source gaps are the next evidence task. |
| Overall | `BLOCKED` | Not permission to submit, sign, modify declarations, or merge. |

## Source baseline

`extensions/firefox/manifest.json:1-42` currently declares:

- Gecko ID: `focus@pomotroid.local`.
- Source version: `1.0.0`; manifest version: `3`.
- Minimum desktop Gecko version: `115.0`.
- Permissions: `storage`, `declarativeNetRequest`, `tabs`, `management`, `nativeMessaging`.
- Host permissions: `*://*/*`.
- No `browser_specific_settings.gecko.data_collection_permissions` declaration.
- CSP: `script-src 'self'; object-src 'none'; connect-src 'self' ws://127.0.0.1:*;`.

The builder's shared source is `extensions/focus/`, not a separate `extensions/shared/` tree (`scripts/build-browser-extensions.mjs:6-9`). Canonical release inputs are expected at `extensions/signed/firefox/focus@pomotroid.local.xpi` and `provenance.json`. `verifySignedGeckoArtifact` checks source correspondence, provenance and structural archive markers, **not** Mozilla cryptographic trust or account ownership (`scripts/gecko-signed-artifact.mjs:7-53`). Its test fixture's AMO URL is not account evidence.

Observed SHA-256 baseline, captured before this task's first commit:

```text
d67bbf8dde43a386c59e23490d60e67963f86380e80a6a8e06d658ed30a68a6b  extensions/firefox/manifest.json
ffc6c3cd3d3fc9e4decc47632bbbe08a5d9d554496713b97a89e7f84cdb409d4  extensions/focus/background.js
3480d8168573e1e67f7c329bf08ecc650a694a43ba84bb4976f5b857d00aa6ba  extensions/focus/blocked.html
5c701e3781fd27a26492c0062d751ff7017122355bab4a94b5ed0e9d7a866346  extensions/focus/blocked.js
500b73069f642009129f397860bf3e2f041c6981adc0bbee8ab884d8c8a9a5c0  extensions/focus/bridge-auth.js
6b9ff0beb812ab81a2286391639ff969532b0130f97fc22f007335d89247b9ee  extensions/focus/browser-identity.js
e0c45929e21a06b40db105874d583445ff2a63187d0e6e4e11cf22f203ccf6ac  extensions/focus/native-pairing.js
a2e74793597565f9855e913933dfb713ac4e22e07a6bd41694e95a94115dddd4  extensions/focus/options.html
94bfce8b7aa19d7c8f4476c5dc32baa8a7fa8b6194f81c7d1ab2a617dc469690  extensions/focus/options.js
8910bdbe8649d7f4f93f65c6efb5506108ccd9ae7e74efb1fac46cc6b17f9ca6  extensions/focus/policy.js
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  extensions/focus/rules.json
c772564b874aaa271b4f0187c32a0fbc1c8ecf49da9fe537f8872076cdc09b09  scripts/gecko-signed-artifact.mjs
f02c082fdf50080cd39026544fa6c19f93e5b69a369a8ee66b1704ca6133c2a3  scripts/build-browser-extensions.mjs
06c27ebfe7c98dce653d565e19c5dd718745cf503c6deaf1bb3b3a18fcb79c8b  src-tauri/src/focus/browser.rs
23140864cdf4758a36da4542fe1bb68a17af61956f245cec90f9f4acf65e8c10  src-tauri/src/focus/native_messaging.rs
```

## Existing evidence and execution boundary

- `plans/README.md` links the active [Gecko CSP repair and evidence record](zen-gecko-csp-repair-plan.md), [Zen handoff](zen-extension-omp-handoff.md), and [diagnosis report](zen-network-alternatives-report.md). Their previous browser/test outcomes were not rerun for this documentation-only task.
- `plans/zen-gecko-csp-repair-plan.md:36-48` records signed-package guards, missing signed acceptance, the persistent-regression negative path, and unresolved AMO/consent prerequisites. These do not establish AMO authority.
- The existing Graphify query `native pairing browser bridge token storage policy profile extension` returned native-pairing/storage, bridge and policy nodes. Current source was inspected independently. `graphify-out/GRAPH_REPORT.md` records 2,313 nodes, 4,544 exported relationships, dangling-reference synthesis and collapsed analysis edges; this is a navigation map, not policy or runtime proof.
- Pre-task Git inspection: branch `fix/focus-blocking-start`; index empty; 42 unstaged and 17 untracked paths. Preserve that pre-existing shared work. Commit only this task's two new evidence files, in separate logical batches.
- Execution ruling: retain this dirty feature workspace, as the approved plan requires, rather than create a second worktree that omits uncommitted companion dependencies. Cost if wrong: source drift requires re-audit; hashes above detect it.
- Execution ruling: this research changes no production code or behavior. Verify source anchors, hashes, citations and scope rather than manufacture runtime/source-text tests or rerun enforcement. Cost if wrong: documentation cannot prove browser acceptance; that gate remains explicitly blocked.
