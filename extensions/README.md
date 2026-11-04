# Pomotroid Focus Browser Companions

The Pomotroid browser companions enforce website blocking directly in your browser without requiring root privileges, a local VPN tunnel, or paid Apple developer signing.

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

### Firefox
1. Run `node scripts/build-browser-extensions.mjs` to generate `extensions/dist/firefox`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on...** and select `extensions/dist/firefox/manifest.json`.
4. Open the extension Options, paste your pairing token, and save.

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
