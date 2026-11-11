# Batch 5: native acceptance and signing automation

Status: native development checks and the production app build pass. Mozilla approved signed Firefox companion 1.1.0. The owner chose to retain Firefox 115 support and its independent consent fallback; two minimum-version compatibility warnings are intentionally retained. Packaged-browser acceptance is in progress. No public store listing or app release was published.

## Native observations

Used the existing disposable guest `grace-acceptance-7c36512e-4971-4d40-8e87-d6cbca8758fa`, with guest-only Accessibility/AppleScript explicitly authorized by the owner. A filtered source snapshot and incremental overlays are retained in `.superpowers/sdd/grace-ui-batch5/`. The host-built debug executable ran against a guest-local Vite server; this is native development evidence, not packaged-release acceptance.

- Settings expanded from 360×478 to 840×520; return restored timer size and position 443,75.
- Statistics opened at 720×480. Real Today statistics and the annual control loaded through native IPC; the Today surface was visually inspected without overlap.
- Light, dark, automatic and a uniquely owned custom theme were exercised. Custom-theme file watching updated the live native appearance response from #17212b to #1d2833 in about 1.2 seconds.
- The real native host returned appearance version 1 with 19 color roles and the animation preference, without credential fields. This did not use a mocked native host.
- Disabled animation switched geometry without interpolated sizes in Accessibility samples. Samples are coarse observations, not frame-rate measurements.
- Compact 240×240 and enlarged 840×650 timer layouts were visually inspected. The compact audit exposed selector overlap with Statistics; the corrected native surface shows the full icon.
- The final executable passed interrupted settings → timer → settings → timer navigation: interrupted at 537×494, then restored 360×478 at 443,75. Its SHA-256 is recorded in the evidence directory.
- Ordinary Quit passed while unlocked. Original appearance/language preferences and timer geometry were restored, the owned custom fixture was removed, and the guest was stopped. No protected session was started during this UI audit.

## Fixes grounded in the audit

Settings previously mounted at the timer width, then changed from top navigation to a sidebar at the 560px breakpoint during resizing. The destination now mounts after awaited native resize completion. macOS uses AppKit animation completion on the main thread; missing completion falls back after two seconds. Animated timer restoration moves and resizes in one native frame animation. Saved timer geometry survives interrupted restoration instead of being replaced by an intermediate frame.

Compact titlebar selection is bounded between platform control gutters. Appearance mode buttons expose their selected state to assistive technology; keyboard selection is covered in browser tests.

Implementation reference: [Apple NSAnimationContext](https://developer.apple.com/documentation/AppKit/NSAnimationContext).

## Browser and automated evidence

Isolated Chromium tests passed consent, keyboard focus, manual test pairing, authenticated policy exchange, real DNR blocking/release and disconnect. A narrow cached-theme check passed with test-injected appearance data. The broker and cached appearance were test fixtures; these results do not prove browser-to-native appearance synchronization. The companion currently has English copy only, so translated companion layout was not assessed.

Final observed checks: `npm run check` exits 0 with no errors or warnings; `npm test` exits 0 (7 unit, 77 extension/signing, 21 motion/UI and 1 statistics matrix checks; two opt-in capture cases skipped). The prescribed Rust test command exits 0 with no warnings (160 library tests passed, 2 ignored, plus integration suites; native/guest-only cases remain ignored and the Accessibility callable test is filtered). `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` exits 0.

The earlier general Rust test run reported nine warnings in `browser_bridge.rs` (eight unnecessary `mut` bindings and one unused authenticated socket) and one unnecessary `mut` in `e2e_browser_onboarding.rs`. The socket remains bound for the test's full scope. The all-target Clippy pass also exposed two tautological Accessibility assertions and one boolean comparison; the callable test still calls both commands and checks their return types, and the boolean assertion retains its behavior. The Accessibility test was not run on the host. Initial restricted test execution could not bind loopback ports; the successful rerun used local network access.

## Signing and credentials

The current companion is version 1.1.0. The prepared unsigned archive remains in `.superpowers/sdd/grace-ui-batch5/grace-companion-1.1.0-unsigned.xpi`. Existing signed 1.0.0 bytes and provenance remain unchanged.

`npm run extensions:sign:firefox` uses pinned Mozilla web-ext with explicit unlisted distribution. It stages only reviewed companion source, supplies credentials through the child environment rather than arguments, suppresses credential-bearing output, verifies the returned archive against source, and preserves the old signed pair on ordinary failure. A process crash between the two individual file replacements can leave a mismatch; the existing build guard rejects that state.

`.env.amo.local` is ignored, untracked and owner-only (0600). It contains the active signing pair stored directly without displaying its values. The owner approved replacing the initially rejected pair; the replacement authenticated successfully. `AGENTS.md` prohibits printing credentials or committing them on any branch. Environment/private-key filenames and symlink/special entries are rejected before extension packaging/signing. `.env.example` contains blank fields only.

The owner completed Mozilla email verification. The automated signing command submitted 1.1.0, downloaded its signed artifact, verified source correspondence, and installed it with matching provenance. The strict signed-package build check and full production app build subsequently passed. Reference: [Mozilla web-ext signing options](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/).

## Remaining acceptance gates

- [x] Owner email verified; active credentials stored privately; signed 1.1.0 approved and verified.
- [x] Compatibility policy: retain Firefox 115 support and independent consent fallback; the two declaration-availability warnings remain expected. No manifest change or re-signing is needed for this decision.
- [x] Full production frontend/native app bundle build against approved 1.1.0 (repeat if compatibility policy changes).
- Current packaged Firefox/Zen acceptance, including native appearance synchronization before consent, persistence, withdrawal and compatibility with existing pairing.
- Native drag/resize/shortcut, reduced-motion OS preference and full locale matrix on the packaged build; uninterrupted frame pacing has not been instrumented.
- Emergency dialog and protected focus lifecycle on the newly packaged app.
- Windows and Linux native acceptance separately.

[Sanitized evidence](evidence/grace-ui-batch5-2026-11-10/).


## Credential setup follow-up

The owner completed Mozilla email verification. The existing issuer/secret were read directly into memory and stored in the ignored, owner-only local file without displaying values. A private comparison confirmed the local pair exactly matches the developer portal. No global signing environment variables shadow the file; local and Mozilla server time differ by about one second.

The first authorized unlisted signing attempt failed authentication. A read-only authenticated profile preflight also failed. No new version appeared in the developer portal, and the previous signed artifact remains unchanged. Credential-safe diagnostic categories were added and tested; raw child output, JWTs, API bodies and credentials were not retained. Owner approval to revoke/regenerate the rejected pair was requested before taking that action.


## Signed 1.1.0 and warning review

Mozilla approved version 1.1.0 at https://addons.mozilla.org/en-US/developers/addon/3f4853f52b9c427ba24c/versions/6692255 . The signed SHA-256 is `3985f29a72a47749190a395ccf6730e62867cdfc0ae8355f54a02c00f1c91ee6`. Validation file 5236344 reports 0 errors, 2 general compatibility warnings, and no security, extension, localization or compatibility-test errors.

Both warnings concern declaring Firefox 115 support while the manifest data-collection permission key was introduced in Firefox 140 desktop / 142 Android. Mozilla explicitly permits older versions with independent consent controls; grace has these controls. The owner chose to keep Firefox 115 support and rely on the independent consent fallback on older versions; the warnings are intentionally retained. Do not remove privacy declarations or add unsupported Android support solely to silence lint.

`npm run tauri build -- --bundles app` exited 0 and produced `src-tauri/target/release/bundle/macos/grace..app`, including the native host. Main executable SHA-256: `2452c2612bb357c3831e5322d1d107a4de577d20324e68e5a0d51b287c2bb2cf`. This is the 1.1.0 baseline, not final acceptance if the compatibility policy changes.


## Packaged Zen update and persistence (2026-11-10)

The rebuilt production bundle containing the new **Update Extension** control was transferred to the same disposable macOS guest after checking bundle links and sensitive filenames. Its main executable SHA-256 was `7f5776ed4bbf5785ddd6dc7cc9af49520c8f9f6127e84d04505eb215102e6d46`; the bundled and staged signed XPI both matched `3985f29a72a47749190a395ccf6730e62867cdfc0ae8355f54a02c00f1c91ee6`. This later executable supersedes the earlier production baseline hash above for this guest check.

Using the packaged app's Update Extension control, Zen 1.24.1b (Gecko 159.0.1) received the signed 1.1.0 companion without invoking Remove. Zen's installed metadata reported version 1.1.0, active, `signedState=2`. The existing required participant remained present and came online; it came online again after the browser and packaged app were restarted. A separately created disposable Zen profile also installed signed active 1.1.0. While that profile ran, the original participant remained the only listed participant and was offline.

Navigation to the disposable profile's companion options address was attempted, but the browser did not expose its page controls through the available accessibility interface. Consequently, its actual pre-consent state, native appearance synchronization, and withdrawal/re-consent are **inconclusive**; no privileged inspection bypass was used. This run did not test Firefox 115 or a new protected session, emergency release, or browser blocking. The temporary profile was removed, the app and Zen were closed, and the owned guest was stopped. App preferences and the required participant were not changed; the signed extension update was retained. [Sanitized observation record](evidence/grace-ui-batch5-2026-11-10/packaged-zen-update.json).

## Independent consent fallback source check

The 1.1.0 companion uses its own versioned local consent decision before native pairing or an authenticated connection, including when `permissions.getAll()` does not expose `data_collection`. Withdrawal stops sharing and persists the declined decision. The test `legacy Gecko without data collection API requires and persists explicit consent` in `extensions/tests/consent.test.mjs` passed alongside the background authentication tests; it exercises pending, acceptance and withdrawal with a legacy-style permission response and stored credentials. This source-level fixture does not establish Firefox 115 runtime behavior for 1.1.0; that remains a separate guest acceptance check. No signed extension source or manifest changed for this test.


## Firefox 115 installation and consent limitation (2026-11-10)

The owner chose to retain Firefox 115 support and the independent companion consent fallback. The two AMO compatibility warnings about availability of the newer data-collection declaration are expected; this decision does not require a manifest change or re-signing.

In the disposable macOS guest, the official Firefox 115.44 ESR image matched SHA-256 `3b930631baea196f9bbfb957bdc07f8541a63d4d821938545f118e4036215ab3` and its app signature passed verification. The packaged app installed the signed 1.1.0 companion through normal setup in a newly created Firefox profile; Firefox metadata reported it active with `signedState=2`. Navigation to its options address was attempted, but guest visual inspection was interrupted before its contents were observed. Actual pre-consent UI, native appearance, acceptance, connection and withdrawal are therefore **inconclusive**. No credential or private profile value was retained.

Firefox and the packaged app were closed, the temporary image and profile were removed, and the guest was stopped. A later read-only inventory found `/Applications/Firefox.app` version 115.44.0 still present, despite the earlier cleanup command reporting success; its removal remains open. The Firefox-only extension policy/native registration added by setup was not removed: automatic approval rejected an ambiguous choice between two Remove Extension controls because it could target the existing Zen participant. No workaround was attempted, and the existing Zen participant was left intact. That guest-only setup remains a cleanup item; no pre-install backup of its Firefox registration was made. [Sanitized Firefox observation](evidence/grace-ui-batch5-2026-11-10/firefox115-install.json).


A subsequent read-only guest inventory confirmed the Firefox defaults domain still has the companion policy and enterprise flag, with no other extension entries or non-Apple/NS policy keys observed. The Zen domain has its own companion entry and other policies. The Mozilla native-messaging manifest is shared by Firefox and Zen; the Chrome manifest and staged XPI are also shared and were left untouched. The guest was stopped after inventory.

A later guest cleanup verified Firefox 115.44 was stopped, removed the owned temporary app, and confirmed its absence before stopping the guest. At that point Firefox policy removal remained blocked by automatic review; shared registrations remained intact. The later approved cleanup is recorded below.


### Approved Firefox-only cleanup

After explicit owner approval, the guest's Firefox-only companion policy was removed from `org.mozilla.firefox`; the existing unmerge behavior was followed, and an owner-only rollback snapshot was retained in the guest. Read-only checks confirmed the temporary Firefox app and its companion policy absent, the Zen companion policy and required participant present, and the shared Mozilla native manifest and staged XPI present. Zen configuration and shared resources were not removed. The guest was stopped. The earlier automatic-review block and incomplete-cleanup note above are superseded by this verified cleanup.
