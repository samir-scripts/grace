# AMO ownership and Mozilla consent readiness

Evidence date: 2026-11-05 (UTC). This is an evidence-only prerequisite for a separate consent implementation and signed-Gecko submission. No AMO submission, signing request, manifest-version change, consent declaration, account-role change, or browser enforcement is authorized by this report.

## Readiness status

| Gate | Status | Evidence |
| --- | --- | --- |
| `ownership_status` | `BLOCKED` | No authenticated evidence of an owner role for the exact GUID. See account-access boundary below. |
| `release_authority` | `UNVERIFIED` | No authenticated owner/developer role record. |
| `history_status` | `BLOCKED` | Listed/unlisted version history requires authenticated account evidence. |
| `source_version_availability` | `UNVERIFIED` | Source version is not proof that the version is unused on AMO. |
| `classification_status` | `BLOCKED` | Source and Mozilla taxonomy mapped below; protocol-field classification and enterprise treatment need authoritative clarification. |
| `consent_status` | `BLOCKED` | General Firefox rules are documented below; exact data classifications, applicable enterprise behavior, and compliant implementation remain unresolved. |
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

## AMO authority and version-history evidence

### Observed account-access boundary

On 2026-11-05, browser session discovery found no managed tabs. Discovery of an existing Chrome relay session timed out after 10 seconds; no personal profile or cookies were inspected. A separately managed browser opened `https://addons.mozilla.org/developers/`, which resolved to `https://addons.mozilla.org/en-US/developers/` with title “Developer Hub :: Add-ons for Firefox”. Its “Submit or Manage Extensions” link points to Mozilla's account-login start route, not an authenticated add-on inventory.

This proves only that the available managed session does not expose authenticated management evidence. It says nothing about the user's own AMO account, whether the ID is claimed, or which versions exist. No login credentials, account agreements, uploads, signing calls, role changes, or version reservations were supplied or performed.

### Owner action needed

1. Open [Developer Hub](https://addons.mozilla.org/developers/) and sign in personally. Do not send a password, API key/secret, cookies, or session export.
2. Inspect the account's add-ons, including self-distributed/unlisted entries. Open the candidate's management record and match the **internal GUID** `focus@pomotroid.local`; the display name is insufficient.
3. Record a redacted management URL/numeric AMO ID, exact GUID, effective role and date. Mozilla's [ownership guide](https://extensionworkshop.com/documentation/publish/add-on-ownership/) says both owners and developers can update/manage an add-on; only owners can add authors. An owner role proves ownership; a developer role proves release-management authority only. The guide documents “Edit Listing” and “Manage Authors & License”; inspect those views read-only and never click “Save Changes”.
4. Inspect every accessible version and channel. Capture version string, listed/unlisted channel, submission/review/signing status where exposed, timestamp, and which older/deleted history is not visible. Include pending, rejected and disabled versions where present. The current versions-view label has not been observed in an authenticated session; use the account's actual navigation rather than a guessed endpoint.
5. Provide a redacted record covering both GUID/role and history. Remove email addresses, personal profile IDs and unrelated add-ons. No upload is needed. If management/history is missing, record that limitation rather than infer an unused ID or version.

Current result: no authenticated management record or version rows available; `source_version_availability` remains `UNVERIFIED` for `1.0.0`. No next version has been selected or written anywhere.

### Owner-sendable support request if account inspection cannot resolve authority/history

> We maintain the Pomotroid Focus Companion with Gecko ID `focus@pomotroid.local` and source version `1.0.0`. We need to establish rightful management authority and version history before any submission. Can you advise the verified owner/recovery route and how an authorized owner can inspect all listed/unlisted versions, including rejected, disabled, pending or deleted submissions? In particular, how can the owner establish whether `1.0.0` has already been consumed? We are not requesting reservation, signing, publication, an ID change or an account-role change. We can provide redacted authenticated account evidence privately through your approved process.

Do not send this request automatically. An absent dashboard entry or public AMO 404 cannot establish uniqueness: Mozilla's [signing overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/#distributing-your-addon) states unlisted extensions cannot be publicly viewed/installed from AMO. [MDN's ID documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings#id) says AMO checks uniqueness at first signing; this task does not perform a signing experiment.


## Mozilla data taxonomy and field classification

Sources reviewed 2026-11-05: [Mozilla's data taxonomy and consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/#taxonomy), [data-transmission policy §6](https://extensionworkshop.com/documentation/publish/add-on-policies/#data-collection-and-transmission-disclosure-and-control), [MDN manifest schema](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings#data_collection_permissions), and the [signing/distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/#distributing-your-addon). The detailed source inventory is [amo-extension-data-flow-audit.md](amo-extension-data-flow-audit.md).

Mozilla defines transmission as data collected, used, transferred, shared or handled outside the add-on or local browser. It explicitly applies its consent/control policy to data sent to a native application. Self-distributed add-ons remain subject to Mozilla's policies. For new extensions submitted from 2025-11-03, Mozilla requires the built-in data-collection declaration; its cited guidance does not yet require this for updates to extensions created before that date, subject to future change. The actual add-on creation history here is unknown.

### Exact schema identifiers

MDN lists `required` as `none` or one or more of:

`authenticationInfo`, `bookmarksInfo`, `browsingActivity`, `financialAndPaymentInfo`, `healthInfo`, `locationInfo`, `personalCommunications`, `personallyIdentifyingInfo`, `searchTerms`, `websiteActivity`, `websiteContent`.

The same eleven personal-data identifiers may appear under `optional`, plus `technicalAndInteraction`. Mozilla says `technicalAndInteraction` **cannot be required**. If no required transmission occurs, `required: ['none']` may coexist with genuinely optional collection; if there is no transmission at all it also represents that situation. This is a schema description, not a declaration for this extension. Do not adopt `none` until every actual outside-browser transfer is classified.

Mozilla's taxonomy defines `authenticationInfo` with account credentials such as passwords, usernames and PINs; `browsingActivity` with visited URLs/domains; `technicalAndInteraction` with device/browser info, extension usage/settings and error reports. Other enumerated types cover identifying information, health, finance/payment, personal communications, location, website content, website interactions, search terms and bookmarks. Examples are not exhaustive classification decisions for this application's local protocol.

### Source-to-policy matrix

| Audited data / boundary | Evidence-based classification | Status and decision needed |
| --- | --- | --- |
| Native outbound `{type:'connect'}`, WebSocket connection address, `auth_init` nonce, challenge and protocol sequence/MAC | Generated protocol/framing data; native recipient is outside the browser. Mozilla's examples do not conclusively assign each generated value or exclude it from the declaration. | `UNRESOLVED`: ask whether operational control frames are data collection/transmission for this taxonomy. |
| Token from desktop to extension; extension-local token/port storage; `auth_response.proof` | Pairing credential is authentication-related, but token travels desktop → extension and is not sent as a WebSocket field; derived proof travels back. `authenticationInfo` is a candidate, not a verified mapping for machine-generated pairing proofs. | `UNRESOLVED`: ask about direction, local storage, proof and credential classification separately. |
| `profile_id` generated or entered, and included in metadata, ACK, heartbeat and errors | Persistent browser-profile identifier transferred extension → desktop. It is not evidence of a person's name or an AMO account identifier. | `UNRESOLVED`: ask whether it is `personallyIdentifyingInfo`, `technicalAndInteraction`, another category or excluded when used only for local coordination. |
| `browserKind`, `install_type`, `may_disable` in authenticated metadata | Browser/install information resembles Mozilla's `technicalAndInteraction` examples. Source shows no full browser version or user agent in those messages. | Candidate `technicalAndInteraction`, **not a final ruling**. Mozilla says this category is optional and declining technical-data transmission must not restrict functionality. If the metadata is indispensable to safe enforcement, seek Mozilla guidance; do not label it required. |
| ACK/heartbeat `revision`, error `revision`, `profile_id`, `code` | Revision is protocol state. `code` can be a browser API exception message; error reports resemble `technicalAndInteraction`, but its content is not guaranteed to exclude other data types. | Candidate `technicalAndInteraction`; `code` is `UNRESOLVED` if it can contain a URL or other sensitive text. Do not assume a clean error. |
| Desktop → extension policy `active`, `revision`, `domains`, `lease_secs`; generated local DNR rules | User-selected blocked-domain configuration moves from desktop into browser; DNR is browser-managed. That list is not necessarily visited-site history. | `UNRESOLVED`: ask whether desktop-origin data received by the add-on and then used locally is declarable, and whether a user's chosen blocked-domain list has a relevant category. |
| Open-tab `tab.url`/`tab.id`, local comparison and `blocked.html?url=` | Mozilla defines visited URLs as `browsingActivity`; inspected code processes tab URLs within the browser and extension page, not as an explicit URL field in bridge messages. | `UNRESOLVED`: policy says outside add-on **or local browser**; request confirmation of treatment of this local use and browser session persistence. Do not call it transmitted browsing history without evidence. Error text remains a separate potential channel. |
| Local diagnostics and desktop stderr/logs | Presence flags, browser kind, stage/count/revision/port or native host operational messages; received error may propagate into an enforcement error. | Locally produced browser console data is not itself an observed extension → desktop send. Desktop-side logging is separate; assess contents before sharing. Classification of transmitted error/metadata remains unresolved. |
| Manually supplied extension options, extension-local storage, internal reconnect message | User-provided token/profile, native pairing state, port and internal control message remain in extension/browser until the bridge paths above execute. | No separate observed outside-browser transfer from the internal reconnect message; evaluate its ensuing bridge traffic under the relevant rows. |

No source path in the audited package was found transmitting a user's health information, financial/payment information, personal communications, search terms, bookmarks, website content or website interaction data as an explicit message field. This is **not** proof arbitrary browser API error text excludes such material. The set of unused declarations therefore remains conditional on resolving error-message content and Mozilla's classification.

### Owner-sendable Mozilla classification question

> We are preparing an unlisted Firefox MV3 companion for a local desktop focus application. Before any submission, please clarify the applicable `data_collection_permissions` categories and consent for these synthetic flows: (1) an extension sends a constant native `{type:'connect'}` message and receives a generated local pairing token and port; (2) over authenticated localhost WebSocket it sends a generated persistent profile identifier, browser kind, install type and disableability, a derived HMAC proof, and revision/heartbeat/ACK values; (3) an error field may contain browser API exception text; (4) the desktop supplies user-selected blocked domains, and the extension compares open-tab URLs locally and redirects matching tabs to an extension page containing the URL in its local query string. No visited URL is deliberately included in the bridge protocol. Which fields are reportable, which exact categories apply, and does direction/local-only processing matter? If essential browser/install metadata is `technicalAndInteraction`, how can functionality remain available when the user opts out? Does a consumer application writing an enterprise policy on the user's own machine qualify for the enterprise consent exception? Please distinguish Firefox 115–139 from Firefox 140+ and policy-installed unlisted extensions.

The owner should send this through an appropriate Mozilla support/reviewer channel and retain the dated response/reference. Do not send automatically or include real tokens, profile IDs, URLs, account details, or private logs. Until the classification and exception questions are answered, `classification_status` remains `BLOCKED`; no manifest declaration is authorized.


## Firefox consent requirements and implementation gap

### Browser-managed experience

[Mozilla's built-in consent guidance](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) states desktop Firefox 140+ supports the built-in data-collection experience. A required data category is presented in the installation prompt; a user who does not agree can cancel installation. Optional categories generally are not granted by default and can be requested via `permissions.request()` from a user-activated event. Users can change optional choices in the add-on's **Permissions and data** section in `about:addons`. `technicalAndInteraction` is special: it is optional, and the installation prompt can offer a choice for it.

Mozilla says `browser.permissions.getAll()` can be feature-detected through the presence of its `data_collection` property. On updates, Firefox shows newly added required data permissions, except the special `none` type. These are documented Firefox behaviors, not observed results for this add-on or Zen. Policy installation can bypass the browser's built-in prompt, so the default install-time UI must not be assumed to appear in the actual packaging path.

### Firefox 115–139 and custom disclosure

The manifest's minimum remains `115.0`; Firefox desktop 115–139 predates the built-in experience. Mozilla's [older-version guidance](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/#data-collection-experience-on-older-Firefox-versions) says a data-collecting extension must either disable the collection on those versions or present a custom experience. Raising the minimum is another Mozilla-described option, but is not authorized by this task.

When custom consent is required, [Mozilla policy §6.2.2](https://extensionworkshop.com/documentation/publish/add-on-policies/#user-consent-and-control) requires an unmissable, single-page, readable in-add-on experience immediately after installation, with all choices and consequences prominent; it specifies appropriate presentation on relevant updates as well. Avoid hidden options, reduced contrast and other deceptive patterns. Explain the actual data types, recipients and purposes, when transfer starts and repeats, and the impact of accepting or declining. Provide separate personal and technical choices if both are transmitted.

Before transmitting personal information, the user must affirmatively opt in; if the primary function cannot work without it, Mozilla requires a choice to accept or uninstall. For technical and interaction data, the user must be able to opt out during initial consent, and declining that transmission must not restrict add-on functionality. Do not decide whether this protocol meets those categories without the unresolved classification response. Mozilla's narrow [implicit-consent exception](https://extensionworkshop.com/documentation/publish/add-on-policies/#implicit-consent-for-self-evident-single-use-extension) requires all stated conditions, including AMO hosting and immediate user-initiated transmission, and excludes persistent identifiers. The ongoing heartbeat/profile-ID protocol must not be assumed eligible.

### Enterprise-policy ambiguity

Mozilla's [general policy §6.2](https://extensionworkshop.com/documentation/publish/add-on-policies/#user-consent-and-control) says extensions installed by enterprise policy **in an enterprise environment** may bypass asking for data-collection consent, and that Firefox's built-in experience bypasses the prompt by default. Its separate [enterprise development guidance](https://extensionworkshop.com/documentation/enterprise/enterprise-development/#enterprise-consent) says even `force_installed` or `normal_installed` enterprise extensions must implement disclosure/consent; it describes a `3rdparty` policy value read via `storage.managed` and requires the experience when that value is absent.

These passages address different implementation details and do not establish that a consumer app writing a policy into a user's browser qualifies as an enterprise environment or supplies managed consent. The exact interaction of the built-in and custom experiences needs Mozilla clarification; no exemption is claimed. The current extension sources do not contain a `storage.managed` consent read. No managed-consent setting is proposed or authorized here.

### Current code and required separate work

`extensions/focus/background.js:269-300` calls `bootstrap()` on startup/install and immediately at module load. `native-pairing.js:48-56,104` opens the native host and sends `{type:'connect'}`; the host responds with local configuration. If pairing succeeds or stored configuration exists, `background.js:87-103,119-142` initiates the WebSocket authentication; authenticated metadata includes the persistent profile identifier and browser/install details. The options page offers pairing inputs, not an in-extension data-consent experience. The manifest contains no data-collection declaration.

The first native request is a constant control message, not itself proven to be reportable personal data. Determine classification of every following transfer before calling any specific transfer unauthorized. If Mozilla confirms a pre-transfer consent obligation, a **separately approved implementation** must gate each covered transmission before it starts, preserve opt-out functionality required for technical data, and handle denial, later changes and upgrades. Pairing UI, macOS Accessibility permission, or a policy-backed installed flag do not establish consent.

### Zen and acceptance gate

Zen's behavior for built-in prompts, enterprise policy, version support and persistence is `UNVERIFIED`; Firefox documentation is not Zen evidence. In a separately approved disposable macOS guest with a genuinely Mozilla-signed add-on, verify Firefox and Zen independently: installed/policy-installed disclosure, accept and decline, no covered transfer before required consent, optional-data opt-out without loss of required functionality, restart persistence, upgrade, and withdrawal/reconsent wherever Mozilla's final classification requires them. Record actual browser versions and redacted observations. Do not use personal profiles, policy writes or process enforcement.

**Readiness decision: `BLOCKED`.** Owner/role and full version history are not evidenced; field classifications and consumer-policy exception remain unresolved; any required consent implementation and installed Firefox/Zen behavior are unverified. This report does not authorize submission, a manifest declaration or version change, signing, or merge.
