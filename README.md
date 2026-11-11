# Grace

A simple, configurable, and visually pleasing Pomodoro timer and focus blocker.

> **Fork notice:** Grace is an independent fork of [Pomotroid](https://github.com/Splode/pomotroid) by Christopher Murphy, licensed under the MIT License. It adds authenticated browser focus blocking, native application interception, emergency exit protections, and a 3-branch CI/CD development pipeline.

---

- [Overview](#overview)
- [Features](#features)
- [Focus Sessions & Blocking](#focus-sessions--blocking)
- [Statistics](#statistics)
- [Themes](#themes)
- [Install](#install)
- [Branching & Development](#branching--development)
- [WebSocket API](#websocket-api)
- [License](#license)

---

## Overview

Grace is an offline-first desktop Pomodoro timer built with **Tauri 2**, **Rust**, and **Svelte 5** (SvelteKit static SPA). It helps you maintain momentum with configurable intervals, seamless theme switching, detailed statistics, and strict distraction-blocking focus sessions.

## Features

- **Configurable timer** — customize work duration, break durations, and rounds per long break
- **Focus sessions & blocking** — block distracting websites and desktop apps with authenticated browser companions
- **Emergency unlock options** — continuous 60-second emergency hold or a secure emergency passphrase
- **Statistics** — daily breakdowns, weekly bar charts with streak tracking, and an all-time 52-week heatmap
- **38 bundled themes** — Dracula, Nord, Tokyo Night, Catppuccin, Gruvbox, Rosé Pine, and more; auto-switches with OS light/dark mode
- **Custom themes** — hot-reload user themes directly from the themes folder without restarting
- **Localization** — 8 languages: English, Spanish, French, German, Japanese, Chinese (Simplified), Portuguese, and Turkish
- **Global & local shortcuts** — control the timer from anywhere, even when hidden or unfocused
- **Dynamic tray icon** — real-time progress arc, round status, and minimize-to-tray support
- **Desktop notifications** — native notifications on round transitions
- **Compact mode** — minimal dial and controls when the window is resized smaller than 300x300
- **WebSocket server** — opt-in local server on `127.0.0.1` for stream overlays and external automation

## Focus Sessions & Blocking

Grace includes an integrated focus blocker that coordinates desktop enforcement with browser companions:

- **Browser companion extensions:** Chrome, Firefox (AMO-signed companion `focus@pomotroid.local`), and Safari.
- **Mutual HMAC authentication:** Companions connect via WebSockets on loopback with nonce verification and signed session leases.
- **Native OS protection:** macOS guarded-Quit prevents accidental Command-Q escapes during locked work sessions.
- **Emergency Exit:** Unlock an urgent session with an intentional 60-second physical key hold or a pre-configured 30+ character emergency passphrase.

## Themes

Grace ships with 38 bundled themes and supports user-defined JSON themes. See [THEMES.md](./THEMES.md) for details on colors and custom theme setup.

## Install

Download the latest pre-built binaries for **Windows** (`.exe` installer), **macOS** (universal `.dmg`), and **Linux** (`.deb`, `.AppImage`, `.rpm`) from the [Releases](https://github.com/samir-scripts/grace/releases) page.

## Branching & Development

Grace uses a 3-branch pipeline:

- `dev` — Primary integration branch. Feature (`feat/*`) and bugfix (`fix/*`) pull requests target `dev`.
- `stage` — Pre-release staging branch. Promoted from `dev` for cross-platform packaging and end-to-end testing.
- `release` — Production branch. Merged from `stage` and tagged (`vX.Y.Z`) to trigger draft GitHub Releases.

### Setup and verification

```bash
# Install dependencies
npm ci

# Run development server
npm run tauri dev

# Run frontend typecheck and localization compilation
npm run check

# Run frontend and extension tests
npm test

# Run Rust unit and integration tests
cargo test --manifest-path src-tauri/Cargo.toml -- --skip test_accessibility_commands_callable

# Run Rust linter
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# Build desktop release bundles
npm run tauri build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines and release procedures.

## WebSocket API

Grace exposes an optional WebSocket server for integrations. Enable it in **Settings → Advanced → WebSocket Server** (default port: `1314`).

- Client can send `{"type": "getState"}`.
- Server broadcasts `state` and `roundChange` events with elapsed time, round type, and work round progress.

## License

MIT License. Copyright &copy; 2017–2026 Christopher Murphy (Pomotroid upstream) and Grace contributors.
