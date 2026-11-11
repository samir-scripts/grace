# AMO account observation — 2026-11-05

Observed through the signed-in AMO Developer Hub at https://addons.mozilla.org/en-US/developers/ after the user completed sign-in in the in-app browser. Account email, account identifiers and authentication URLs are intentionally omitted.

- The dashboard showed **My Add-ons**, no add-on entries, and **Submit Your First Add-on** / **Submit Your First Theme**.
- No accessible add-on GUID, add-on-specific account role, or submitted/reserved version history was displayed.
- This account therefore provides no current visible evidence of ownership or version history for `focus@pomotroid.local`. An empty dashboard does **not** establish global GUID availability, another account's ownership, or that version `1.0.0` has never been submitted.
- Opening **Submit Your First Add-on** redirected to an additional Mozilla sign-in flow before the submission agreement could be inspected. No agreement was accepted, package uploaded, signing request submitted, identity/version changed, or consent declaration made.

Next: complete any user-required authentication; inspect the agreement and self-distribution requirements. Keep actual agreement acceptance and submission separate from read-only preparation. Resolve the source-backed data classification questions in `zen-gecko-csp-repair-plan.md` before making declarations. Do not infer `none` from local-only architecture alone.

## Additional access gate observed

The submission flow reached **Set up two-step authentication**. Mozilla states that Add-ons requires two-step authentication. The user must complete authenticator enrollment and retain recovery information personally; the agent did not begin enrollment or access authenticator secrets. This is an enrollment requirement, not merely a request for an existing one-time code.

## Enrollment complete; agreement gate

The user reported completing enrollment. Read-only inspection confirmed **Two-step authentication: Enabled**. No authentication secrets or recovery information were recorded.

Returning to the first-submission agreement now succeeds. AMO displays the **Add-on Distribution Agreement** screen with unchecked acceptance boxes for **Firefox Add-on Distribution Agreement** and **Review Policies and Rules**, an empty required public **Display Name**, and **Accept**. All were left unchanged for the user's review. Agreement/policy acceptance is the next explicit owner decision. No package upload, signing request, consent declaration or version reservation has occurred in this browser flow.

## Agreement completed by owner; upload prepared

The owner reported completing agreement acceptance. The browser then showed **How to Distribute this Version**. Selected **On your own** and continued to **Upload Add-on** (`/developers/addon/submit/upload-unlisted`). No file has been uploaded. The page accepts ZIP/XPI/CRX, maximum 200 MB; Continue is disabled until an upload validates.

Local pre-upload verification: existing `extensions/dist/firefox/focus@pomotroid.local.xpi` is 11,244 bytes, SHA-256 `cf9507ed8063abdece2c7e4fd550be9a8ac9a3fec1e3f855897bce4bbe6fb874`. All 11 archive entries match current `extensions/focus/` files plus `extensions/firefox/manifest.json` byte-for-byte, with no extra files. ID remains `focus@pomotroid.local`, version `1.0.0`. The manifest has no `data_collection_permissions`. Current Mozilla documentation requires this declaration for new extensions submitted since 2025-11-03. No declaration has been invented or modified. Pending owner approval to upload this exact package for automated validation; final signing submission remains separate.

## Authorized upload and actual AMO validation

The user explicitly approved uploading the verified 11,244-byte XPI for automated validation. Uploaded that exact package via the unlisted upload screen. AMO completed the transfer and rejected validation with **1 error, 0 warnings, 0 notices**:

> The "data_collection_permissions" property is missing.

The detailed error identifies `/browser_specific_settings/gecko/data_collection_permissions` as required for all new Firefox extensions. General tests report this one error; Security, Extension, Localization and Compatibility sections each report zero errors/warnings/notices. These automated sections do not establish a security review, signed acceptance, GUID ownership or version availability.

Authenticated validation report: https://addons.mozilla.org/en-US/developers/upload/90a34d57b06c4620815441dd05347d97

The page's Continue control remained disabled. No final signing submission or signed artifact was produced. Upload-screen screenshot saved locally at `/tmp/pomotroid-amo-validation.png` for the current chat; do not treat this temporary path as a durable repository artifact. The original statement that no upload occurred above is historical and superseded by this section.

## Revised package readiness — 2026-11-06

Inspected the new consent implementation and independently verified the unsigned candidate archive against all current shared source files plus the Firefox manifest. Version remains `1.0.0`, ID `focus@pomotroid.local`; 13,404 bytes; SHA-256 `c96569a63f627cc983497963fe6565f91ce06bb68107013affa5a14c91b333d3`. All 12 archive entries match source with no extras. The manifest now declares required `authenticationInfo` and `personallyIdentifyingInfo`, retains Firefox minimum `115.0`, and the archive includes `consent.js`. Existing plans contain OMP's guest verification evidence and remaining limitations; those runtime tests were not rerun in this prerequisite inspection.

Opened the unlisted upload form in the existing authenticated AMO session. Automatic approval review rejected uploading the revised package because prior approval covered the original package and the implementation specification explicitly deferred revised upload to a separate owner approval. The form remains unchanged; no revised upload occurred. Explicit approval for this revised package is pending. Signing and provenance remain unavailable; do not bypass the packaging guard or reuse old validation as evidence for this candidate.

## Revised AMO validation passed — 2026-11-06

The owner explicitly authorized uploading the revised XPI. Reconfirmed SHA-256 `c96569a63f627cc983497963fe6565f91ce06bb68107013affa5a14c91b333d3`, then uploaded that 13,404-byte candidate in the unlisted flow.

AMO reports **Add-on passed validation**:

- General Tests: **0 errors, 2 warnings, 0 notices**.
- Security, Extension, Localization and Compatibility sections: **0 errors, 0 warnings, 0 notices** each.
- Warnings: minimum Firefox 115 predates built-in `data_collection_permissions` support in desktop Firefox 140 and Android 142. Desktop Firefox is selected; Android is not selected. The implemented custom consent flow addresses older-browser design; this report is not runtime proof of Firefox 115 behavior.
- Actual revised report: https://addons.mozilla.org/en-US/developers/upload/9db816b04de14565b8fabd2025afdd17

Continued to the source-declaration page at https://addons.mozilla.org/en-US/developers/addon/3f4853f52b9c427ba24c/submit/source-unlisted . AMO now identifies Pomotroid Focus Companion in this account's submission flow. Selected **No** for a separate source-code archive: the uploaded JS/HTML files match the original source byte-for-byte, with no minification/transpilation/bundling. This selection has not been finalized with Continue. The page says it is ready for the next step. Per Mozilla's documented self-distribution workflow, the next Continue initiates version-signature processing. Awaiting owner approval for that final signing action; no signed XPI or provenance has been created or downloaded yet.

Successful automated validation is not a human policy/security review, confirmation of every data-category interpretation, signed-browser acceptance, or evidence that packaging/persistent-install gates pass. Earlier missing-declaration rejection applies to the prior package only.

## Approved signing completed and artifact saved — 2026-11-06

The owner explicitly approved the final unlisted signing submission for version `1.0.0`. Continued the prepared source declaration. AMO displayed **Submission Complete / Version Signature Pending**, then its submissions inventory and version management showed **Approved**. Downloaded the approved XPI from file **5216027**, version record **6671933**:

https://addons.mozilla.org/en-US/developers/addon/3f4853f52b9c427ba24c/versions/6671933

Saved the exact downloaded bytes to `extensions/signed/firefox/focus@pomotroid.local.xpi` with `extensions/signed/firefox/provenance.json`. Signed XPI: **22,454 bytes**, SHA-256 **34c5729bd350ca9fb76fe0c0cdd488a18edfd0a34291517e058222a3f4602b4b**. Independent archive inspection confirmed semantic equality of the manifest and byte equality of every shared source payload, with no additional payload files. The archive contains `META-INF/cose.sig`, `mozilla.rsa`, and associated manifests. The source-matching unsigned input hash is recorded in provenance. No signature bytes were generated or altered locally.

`npm run build` completed successfully (exit 0), including the unchanged `--require-signed` guard. The generated distribution XPI SHA-256 equals the canonical signed artifact. This clears the missing-artifact/provenance build prerequisite. It does not prove Firefox/Zen cryptographic acceptance, persistent installation, or a Tauri bundle/native smoke test. No personal browser extension installation, guest test, commit or merge was performed in this signing task.

### Handoff to OMP

Use the canonical signed XPI/provenance now present. Do not resubmit version `1.0.0`, replace the signed bytes with a development archive, or bypass the guard. In the disposable guest, sync the matching source and both canonical inputs, build the fresh app through the normal bundle command, inspect bundled XPI/native-host resources, and run the previously blocked packaged startup/port-conflict smoke and persistent signed Firefox/Zen acceptance matrix. Recompute hashes after sync/build. Keep remaining runtime, review and restoration gates open until observed. Future source changes invalidate this artifact's source correspondence and require a newly authorized signed version.
