# Typography preview evidence

Baseline: `179d84dd79` (`feat/appearance-baseline`, prerequisite PR #9).
Preview: `feat/typography-refinement`, draft only; user visual acceptance pending.

## Captures

22 `before-*` / `after-*` PNGs render real components with fixture IPC and animations disabled. Timer/compact/enlarged: 360×478, 240×240, 720×840 CSS viewports. Settings, dropdown, sessions and statistics: 840×600. Emergency states: 360×478. Browser screenshot pixel dimensions may include device pixel scaling.

The baseline uses saved/default Mona Sans + Mona Sans Mono; the preview uses Inter + JetBrains Mono. Theme: Pomotroid dark, interface: Pomotroid. Emergency screenshots use the existing simulated locked-focus fixture, not native enforcement. Captures demonstrate the default direction; all-font/style geometry is covered by the appearance tests, not these images.

## Observed verification

- Svelte/TypeScript: 0 errors, 0 warnings.
- Complete npm suite: passed; 232 passed, two optional screenshot cases skipped.
- Appearance/dropdown module: 46 passed, including font-pair loading, stable timer digits and all-built-in/imported-font timer geometry.
- Statistics module: two passed, including SVG bounds/overlap across eight locales and four built-ins.
- Rust: 223 passed, 19 ignored, one filtered. Clippy with `-D warnings`: passed.
- Isolated macOS `.app` build: passed; opened with identifier `com.splode.pomotroid.typography-preview`. Runtime log confirms separate app data, database open and frontend initialization.
- Independent static review: no actionable introduced issues.

## Limits

Native font switching, resize/titlebar interactions, import dialog and restart persistence have not been optically/interaction-verified. Window enumeration did not provide an on-screen preview capture; no OS permissions were changed. Windows/Linux/VoiceOver unverified. Vite logs a pre-existing unresolved `options.js` dependency scan warning; injected native-failure tests also emit expected warnings. One earlier appearance timeout coincided with concurrent Paraglide regeneration; serial full-module rerun passed without weakening the test.

## Run the isolated preview

From `../grace-typography-review`:

```bash
npm run tauri dev -- --config '{"identifier":"com.splode.pomotroid.typography-preview","productName":"grace. Typography Preview"}'
```

Or open `src-tauri/target/release/bundle/macos/grace. Typography Preview.app` from this worktree. Do not install it over the normal app. Run one native instance at a time because the browser bridge port is shared; close the normal app only while idle/outside a protected focus session. Do not pair extensions or activate blocking for typography review.

Rejecting the draft PR leaves `dev` and normal app data unchanged. Neither PR is auto-merged.
