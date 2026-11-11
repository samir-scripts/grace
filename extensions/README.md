# Pomotroid Focus Browser Companions

The Pomotroid browser companions enforce website blocking directly in your browser without requiring root privileges, a local VPN tunnel, or paid Apple developer signing.

Before connecting, open the companion's options and select **Accept & Connect**
on the data-sharing disclosure. The companion shares its persistent profile ID,
authentication proofs, policy acknowledgements and connection checks with
Pomotroid on this computer. It does not send visited URLs, browser identity or
error reports to the desktop bridge. The native messaging connection remains
open while sharing is enabled and closes when sharing stops. Select **Stop
sharing and disconnect** to withdraw; existing browser rules may remain until
an authenticated release.

In Pomotroid's browser setup, assign each newly connected profile to its actual
browser before starting website blocking. Browser identity is not sent by the
extension. Desktop and companion must both use protocol version 3; older
versions cannot connect. Firefox 115–139 uses the extension's own consent page;
Firefox 140 and later also supports Firefox's built-in data consent prompt.

The planned public Chrome Web Store release targets **Google Chrome desktop**
116 or later on macOS, Windows, and Linux. It is not a listing for other
Chromium browsers or mobile browsers. Store publication is not complete: the
draft production ID is `cgibenlmgmblmalggjalnoaikjkdnoid`. Support and privacy
pages are live; publisher contact and official Chrome UI acceptance remain prerequisites. See [`docs/chrome-web-store/`](../docs/chrome-web-store/)
for the privacy policy draft, support content, listing copy, reviewer guidance,
and release checklist.

## 1. Quick Development Setup (Unpacked)

### Chrome / Chromium / Edge / Brave
1. Run `node scripts/build-browser-extensions.mjs --development` to generate `extensions/dist/chrome`.
2. Open `chrome://extensions` in your browser.
3. Enable **Developer mode** toggle in top-right.
4. Click **Load unpacked** and select `extensions/dist/chrome`.
5. Click the extension icon or open extension Details > Extension options.
6. Review the disclosure and click **Accept & connect**. The companion attempts automatic pairing with Pomotroid on this computer.
7. In Pomotroid Settings > Sessions, assign the connected profile to its actual browser before starting website blocking. If automatic pairing is unavailable, open **Advanced pairing** in options, enter the pairing token and a profile ID, then save.

The unpacked Chrome companion uses the fixed ID `ddiojihepmbimcfoefnebpolgaljlcfn`.
After upgrading from a path-derived unpacked ID, remove the old companion, load
the new build, pair it again, and update any required browser profile in Sessions.
Re-register the native host from Pomotroid so its allowed origin uses the new ID.
This development public key does not include a private signing key; a published
Chrome Web Store build requires a separately managed matching signing identity.

For a planned public Chrome Web Store install, remove the unpacked development
copy and follow the store installation and migration instructions in
[`docs/chrome-web-store/support.md`](../docs/chrome-web-store/support.md). The
store release is not yet published. Its draft production ID differs from the development ID.

Build the store package with `npm run extensions:chrome:release`; create an identity-only
bootstrap ZIP with `npm run extensions:chrome:draft` only when creating a new store item.
Do not create another item for the existing production ID. See
[`automation.md`](../docs/chrome-web-store/automation.md) for secure API status and draft uploads.

### Chrome integration checks

`npm run test:chrome-integration` builds the current unpacked development extension
and runs the Playwright Chromium integration checks. They cover consent gating,
authenticated policy exchange, dynamic blocking and release, and options appearance.
This uses Playwright's Chromium build; it does not establish acceptance in an
installed Google Chrome release.

`npm run test:chrome-guest-bridge` is a native integration check for a **disposable
macOS guest only**. It builds the unpacked extension and runs the real Rust bridge
fixture against an isolated Chromium profile. The fixture exercises the application's
native focus blocker, so it may affect other browser processes in that guest. Do not
run it on a host or a machine with browser sessions that must remain undisturbed.
Run it through the owned Tart runner, which supplies the opt-in and matching run ID
after verifying the guest marker:

```sh
python3 scripts/guest-focus/runner.py exec --run-id "$RUN_ID" --command /usr/bin/env "POMOTROID_BRIDGE_FIXTURE_BINARY=/Users/admin/grace-acceptance/$RUN_ID/bin/focus_bridge_fixture" npm --prefix "/Users/admin/grace-acceptance/$RUN_ID/source" run test:chrome-guest-bridge
```

Direct invocations are skipped unless the process has the explicit opt-in, canonical
run ID, and matching owner-only guest marker, and is running as the non-root `admin`
user on macOS. If Rust is unavailable in the guest, build the fixture on a host with
the same architecture as the guest:

```sh
cargo build --manifest-path src-tauri/Cargo.toml --example focus_bridge_fixture
file src-tauri/target/debug/examples/focus_bridge_fixture
shasum -a 256 src-tauri/target/debug/examples/focus_bridge_fixture
```

Transfer that executable into `/Users/admin/grace-acceptance/$RUN_ID/bin/` in the guest,
preserve its executable bit, and record the host and guest SHA-256 values as test
evidence. Set `POMOTROID_BRIDGE_FIXTURE_BINARY` to its absolute guest path when running
the guarded command; the test rejects symlinks, non-executables and paths outside that
run directory. Without this setting, it uses `cargo run` in the guest as before. The
test also requires Playwright Chromium and a working native environment. It removes
its temporary profile and stops its fixture when it exits.

### Firefox / Zen
1. Run `node scripts/build-browser-extensions.mjs --development` to generate `extensions/dist/firefox`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox or Zen.
3. Click **Load Temporary Add-on...** and select `extensions/dist/firefox/manifest.json`.
4. Open the extension Options, paste your pairing token, and save.

Development builds (`npm run dev` or `node scripts/build-browser-extensions.mjs --development`) generate an unsigned package from current source, even when a signed artifact is present. The signed artifact is left untouched. The default builder still verifies any signed artifact before using it.

This is a temporary development installation; it does not survive a browser
restart. Without a signed artifact the generated XPI is unsigned. Persistent
installation in Firefox release builds requires an AMO-signed extension; a
browser policy entry alone does not prove the add-on loaded.

Production frontend and Tauri builds require the authorized unlisted signed XPI
at `extensions/signed/firefox/focus@pomotroid.local.xpi` and its
`provenance.json`. The build checks the artifact hash, identity and source
payload and preserves its bytes; it does not verify Mozilla's signature.
Update and re-sign the companion when its source changes.

For connection troubleshooting, enable **Verbose Logging** in Pomotroid's
System settings. Inspect the companion in `about:debugging` for
`[pomotroid-focus]` diagnostic stages, and use the Browser Console for native
host messages. Never share pairing tokens or full browser console output without
reviewing it for private data.

### Safari (macOS)
1. Run `node scripts/build-browser-extensions.mjs --development` to generate `extensions/dist/safari`.
2. Open Safari > Settings > Advanced, check **Show features for web developers** (or **Show Develop menu**).
3. Open Safari > Settings > Developer, check **Allow unsigned extensions**.
4. Click **Add Temporary Extension...** and choose `extensions/dist/safari`.
5. Enable the extension in Safari > Settings > Extensions, and configure your pairing token in options.
*Note:* Safari requires re-enabling temporary/unsigned extensions after browser restart.

---

## 2. Preventing Removal (Managed Enterprise Policies)

Standard browser extensions cannot prevent users from disabling or removing them through the browser UI. To make extensions unremovable during focus sessions, administrators can deploy enterprise force-install policies:

### Chrome (macOS / Windows / Linux)
- Deploy the `ExtensionSettings` policy with `installation_mode: "force_installed"`.
- On managed Chrome, force-installed extensions cannot be disabled or uninstalled by the user.
- Sample policy template:
```json
{
  "ExtensionSettings": {
    "<EXTENSION_ID>": {
      "installation_mode": "force_installed",
      "update_url": "https://clients2.google.com/service/update2/crx"
    }
  }
}
```

### Firefox
- Place a `policies.json` file in `distribution/policies.json` (or `/etc/firefox/policies/policies.json` on macOS/Linux).
- Sample policy template:
```json
{
  "policies": {
    "ExtensionSettings": {
      "focus@pomotroid.local": {
        "installation_mode": "force_installed",
        "install_url": "file:///path/to/signed_extension.xpi"
      }
    }
  }
}
```
*Note:* Firefox release builds require add-ons to be signed by Mozilla Add-ons (AMO).

### Unlisted Firefox signing

The owner can use Mozilla's official `web-ext` tool to submit the current Firefox
companion for **unlisted** signing with `npm run extensions:sign:firefox`. Set
`WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` in the environment, or place them in
`.env.amo.local` at the repository root with owner-only permissions (`chmod 600`).
Never commit or share that file. A new, unused version must be set in the Firefox
manifest before submission. This command uploads the companion to Mozilla and may
create a signed version in the owner's account.

The signer stages source in a private temporary directory, explicitly selects the
unlisted channel, checks that source did not change during signing, and validates
the downloaded archive against the source before replacing the local signed
artifact and provenance. It does not independently verify Mozilla's cryptographic
signature; Firefox acceptance still requires testing. The provenance URL points to
the add-on's AMO version management page, not a specific version record.
