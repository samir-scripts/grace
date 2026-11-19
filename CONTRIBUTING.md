# Contributing to Grace

Start with the [architecture guide](docs/architecture.md) to find the component or native service you want to change. Use this guide to build, test, and prepare changes for release.

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
       stage (Pre-release verification)
         │ (Stabilization & version bump)
         ▼
      release (Production releases tagged with vX.Y.Z)
```

1. **`dev`** — Active integration branch. All feature (`feat/*`) and bugfix (`fix/*`) pull requests target `dev`. CI runs the full quality gate (`npm run check`, `npm test`, `cargo clippy`, `cargo test`).
2. **`stage`** — Pre-release staging branch. Promoted from `dev`. CI runs the quality gates as changes advance toward release.
3. **`release`** — Production release branch. Merged from `stage`. Pushing a `vX.Y.Z` tag on approved release source builds installer candidates for native acceptance.

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

PRs targeting the pipeline branches and pushes to `dev`, `stage`, or `release` run the quality gates and CodeQL. Installer builds start when a maintainer pushes a stable or dated nightly release tag.

### Beta (dated nightly tags)

Choose the merged `dev` commit with passing Build / Test and CodeQL push runs. In a clean, detached checkout of that source, fetch the existing tags, then prepare and push the beta tag.

```bash
(
  set -e
  test -z "$(git status --porcelain)"
  git fetch origin --tags
  tag=$(node scripts/prepare-nightly.mjs tag "$(date -u +%Y%m%d)")
  test -n "$tag"
  if git show-ref --verify --quiet "refs/tags/$tag"; then
    printf 'Beta tag already exists: %s\n' "$tag" >&2
    exit 1
  fi
  node scripts/prepare-nightly.mjs prepare "$tag"
  git add -- package.json package-lock.json src-tauri/{Cargo.toml,Cargo.lock,tauri.conf.json} CHANGELOG.md
  git commit -m "chore: prepare $tag"
  git tag -a "$tag" -m "Grace Beta $tag"
  node scripts/prepare-nightly.mjs verify "$tag"
  git push origin "refs/tags/$tag"
)
```

The first beta of each UTC day uses `vX.Y.Z-nightly.YYYYMMDD`. Additional reviewed commits use `.1`, `.2`, and so on in numeric order. Preparing the same source again returns its existing tag. If another maintainer wins a tag push, retry in a fresh clone with the remote tags and the same reviewed source. Never move or overwrite a published tag.

Each nightly tag builds signed beta installers and creates a draft prerelease for manual downloads. If the tag run fails before creating a draft, inspect the failure and rerun the existing GitHub Actions run. Review the tagged commit and package revision against `provenance.json`, verify `SHA256SUMS` and the detached signatures against the trusted Grace key, and smoke-test the macOS installer in a disposable environment before publishing. Beta shares the stable app identity and uses manual updates. The stable updater feed is reserved for stable releases.

### Stable

1. Lead developers review the beta, fix or remove features through the usual PR process, and approve the exact source that will ship. Promote the reviewed commits through `stage` to `release`.
2. Prepare stable release notes in `CHANGELOG.md` and align the versions in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Commit the changes on the release branch and push the reviewed commit to `origin/release`.
3. Tag the approved stable commit and push that tag. Replace `vX.Y.Z` with the actual version, for example `v1.7.2`.

   ```bash
   git tag -a v1.7.2 -m "Release v1.7.2"
   git push origin refs/tags/v1.7.2
   ```

4. Test the macOS, Windows, and Linux installers from the stable tag run. Follow the [native acceptance checklist](plans/contributor-native-acceptance.md#stable-promotion) for reviewed Windows and Ubuntu x64 reports bound to the exact packages.
5. Dispatch the Release workflow on the stable tag with the tag run ID and the reviewed evidence commit. The promotion step uses those accepted files and creates the stable draft.

   ```bash
   gh workflow run release.yml --ref "$tag" -f tag="$tag" \
     -f candidate_run_id="$candidate_run_id" -f acceptance_ref="$acceptance_ref"
   ```

6. Review and publish the signed stable draft. After verifying the public downloads, submit its `latest.json` for the stable updater feed at `main:latest.json`.
