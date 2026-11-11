# Contributing to Grace

Thank you for contributing to Grace. This guide covers setup, testing, branching workflows, and releasing.

---

## 3-Branch Strategy

Grace uses three long-lived branches to organize quality gates:

```
feature / bugfix branches
         │ (PR + automated quality gates)
         ▼
        dev  (Active development & continuous integration)
         │ (Promotion & staging verification)
         ▼
       stage (Pre-release testing & cross-platform artifact build)
         │ (Stabilization & version bump)
         ▼
      release (Production releases tagged with vX.Y.Z)
```

1. **`dev`** — Active integration branch. All feature (`feat/*`) and bugfix (`fix/*`) pull requests target `dev`. CI runs the full quality gate (`npm run check`, `npm test`, `cargo clippy`, `cargo test`).
2. **`stage`** — Pre-release staging branch. Promoted from `dev`. CI builds installable Linux, macOS, and Windows desktop packages as workflow artifacts for manual and staging verification.
3. **`release`** — Production release branch. Merged from `stage`. Tagging `release` with `vX.Y.Z` triggers the release workflow, which runs tests, builds signed desktop packages, and drafts a GitHub Release.

---

## Development Setup

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 22+ |
| Rust | stable (via [rustup](https://rustup.rs)) |
| npm | bundled with Node.js |

**Linux system packages:**
```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  patchelf libasound2-dev rpm
```

### Install and Run

```bash
git clone git@github.com:samir-scripts/grace.git
cd grace
npm ci
npm run tauri dev
```

### Quality Gates & Tests

Run all checks locally before submitting a pull request:

```bash
# 1. Format code
npm run format

# 2. Check SvelteKit and TypeScript types
npm run check

# 3. Run frontend unit and browser extension tests
npm test

# 4. Run Rust unit and integration tests
cargo test --manifest-path src-tauri/Cargo.toml -- --skip test_accessibility_commands_callable

# 5. Run Rust clippy (must pass with zero warnings)
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# 6. Verify signed browser extension correspondence
node scripts/build-browser-extensions.mjs --require-signed
```

---

## Browser Extensions and Signing

The Firefox focus companion (`focus@pomotroid.local.xpi`) is officially signed by Mozilla Add-ons (AMO).
To protect signature validity, any modification to `extensions/focus/` or `extensions/firefox/manifest.json` requires a fresh AMO submission and updated `provenance.json`.

- Unsigned local development packages can be built with:
  ```bash
  node scripts/build-browser-extensions.mjs
  ```
- Production and CI builds enforce signed correspondence:
  ```bash
  node scripts/build-browser-extensions.mjs --require-signed
  ```

---

## Making Changes

1. Create a branch from `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feat/my-feature
   ```
2. Keep commits atomic and use Conventional Commit prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
3. Ensure all quality gates pass.
4. Open a pull request against `dev`.

---

## Release Process

Releases are initiated on the `release` branch:

1. Merge validated changes from `stage` into `release`.
2. Update `CHANGELOG.md` with version notes.
3. Update version strings across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
4. Create an annotated git tag:
   ```bash
   git tag -a v1.7.2 -m "Release v1.7.2"
   git push origin release --tags
   ```
5. GitHub Actions builds the release bundles and creates a draft GitHub Release. Review the draft and publish.
