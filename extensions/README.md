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

## 1. Quick Development Setup (Unpacked)

### Chrome / Chromium / Edge / Brave
1. Run `node scripts/build-browser-extensions.mjs` to generate `extensions/dist/chrome`.
2. Open `chrome://extensions` in your browser.
3. Enable **Developer mode** toggle in top-right.
4. Click **Load unpacked** and select `extensions/dist/chrome`.
5. Click the extension icon or open extension Details > Extension options.
6. Paste the **Pairing Token** from Pomotroid Settings > Sessions, and click **Save & Connect**.

The unpacked Chrome companion uses the fixed ID `ddiojihepmbimcfoefnebpolgaljlcfn`.
After upgrading from a path-derived unpacked ID, remove the old companion, load
the new build, pair it again, and update any required browser profile in Sessions.
Re-register the native host from Pomotroid so its allowed origin uses the new ID.
This development public key does not include a private signing key; a published
Chrome Web Store build requires a separately managed matching signing identity.

### Firefox / Zen
1. Run `node scripts/build-browser-extensions.mjs` to generate `extensions/dist/firefox`.
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
1. Run `node scripts/build-browser-extensions.mjs` to generate `extensions/dist/safari`.
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
