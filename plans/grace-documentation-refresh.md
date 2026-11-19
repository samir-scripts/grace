# Grace documentation refresh

The desktop README, user guide, and architecture guide are prepared for local review together with the landing page demo. The user reviews the uncommitted revision before commits or pull requests.

## Coverage

- The README links available installers, a first-session procedure, a 24-second animation linked to the full landing-page walkthrough, and contributor setup. The user guide distinguishes the publicly downloadable beta from development-only appearance controls.
- The architecture guide traces timer, storage, enforcement, companion and window-material behavior. Its module links lead to checked-in source and tests.
- The documentation audit covers tracked and eligible untracked prose in both repositories. Dated evidence and archived OpenSpec decisions retain their original claims. The four inherited Pomotroid images have no active documentation references.

## Capture identity and evidence

The recordings came from a disposable Tart guest on macOS 15.7.7 ARM64 using the [November 17 package](evidence/ui-repair-2026-11-17/README.md). Grace reports 1.7.1 for this local beta package. Its executable SHA-256 is `9c3c7aff95e1c0d5d3f7a79be0cca8cab6d941c7a8421a92b92999ba1631ff77`. The paired Chrome companion was 1.1.2. The macOS Discord application was the official signed 0.0.422 build.

- In the full walkthrough, the Writing profile starts with empty blocking lists. The capture shows adding Discord, Chess, YouTube, Instagram and Reddit through the native settings, then saving all five rules.
- During the same protected round, process polling observed both Discord and Chess start and exit after launching them from Finder. Chrome reported `ERR_BLOCKED_BY_CLIENT` for each of the three fresh navigations.
- The two-minute work round completed naturally and the Today view shows one round, two minutes of focus time and 100% completion. The countdown footage is accelerated until the final seconds.
- Cap Studio required administrator authentication to enable screen recording in the disposable guest. The motion study and final edit use real guest captures and camera moves timed around the recorded pointer. The new take sends a separate key event for each character and holds on each outcome.
- The disposable guest was shut down after capture. The linked public installer is the separate [v1.7.2-beta.1 prerelease](https://github.com/samir-scripts/grace/releases/tag/v1.7.2-beta.1).

## Local verification

- The landing page passed Svelte and TypeScript checks and static builds at both the root and `/grace-landing-page`.
- Chromium at 1280 and 320 pixels exercised viewport pause and resume, manual pause, replay, and reduced motion. The same checks covered the full video dialog, Escape, backdrop and Close button dismissal, focus return, the README deep link, prefixed media URLs, and the fallback video link with JavaScript disabled.
- The rendered documentation opened its GIF and screenshots and drew the architecture diagram. The changed desktop docs passed the check of 103 local links and anchors. Both working trees passed `git diff --check`.
- The looping README GIF and landing preview show the selected 24-second cut of one continuous Tart recording. It opens on Instagram with “Just one quick check” before revealing the Writing timer and Discord. The guest started with empty history, signed-out Discord and Instagram, and break access enabled. The original tab switched to the companion block page when the round began and a fresh reload of Instagram was blocked. After natural completion the same tab loaded Instagram, Discord reopened, and This Week advanced from no active streak to one day. The packaged weekly view displays “1 rounds” for the first round. The landing videos render at 60 fps and the README GIF renders at 30 fps. The preview trims navigation and accelerates elapsed focus time. The 74-second cut uses cursor interpolation between tracked positions. The 74-second walkthrough opens in a dialog. Its first frame shows the full timer on the sage desktop and its last frame shows the full Statistics window.

## Publication order after review

Publish the desktop guide to the branch used by the landing page’s User guide link before deploying the landing page. Once both changes are live, follow the README’s demo links to the deployed player and verify the landing page guide link.
