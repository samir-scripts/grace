# grace. Focus Companion Support

**Status:** Release preparation. Public support: https://grace-chrome-support.springygranola16.chatgpt.site/. The Web Store contact is configured with Google; verification is pending. The store draft is not published, and native acceptance remains open.

## Requirements

- Google Chrome desktop 116 or later on macOS, Windows, or Linux.
- Grace desktop installed and running on the same computer.
- The extension's browser profile connected and assigned to the correct browser profile in Grace before starting a protected focus session.

The companion is for Google Chrome desktop. Other Chromium browsers and mobile browsers are not covered by this listing or support guidance.

## Install from the Chrome Web Store

1. Open the official grace. Focus Companion listing in Chrome Web Store and select **Add to Chrome**.
2. Open the extension's options page. Review the data-sharing disclosure and select **Accept & connect** to enable pairing. Select **Keep disconnected** if you do not want to connect it.
3. Keep Grace open. After consent, the companion automatically attempts native pairing with Grace on this computer and reconnects when needed.
4. In Grace, open **Settings → Sessions**. Find the connected profile and assign it to the actual Chrome profile you use. Do this before starting website blocking.
5. Start a focus session and confirm the profile is shown as connected and required in Grace.

## Moving from an unpacked development install

End any active protected session and confirm its blocking rules have been released before migrating.

1. In Chrome, open `chrome://extensions` and remove the unpacked grace. Focus Companion. If Chrome shows another old Grace or Pomotroid companion, remove that one too.
2. Install grace. Focus Companion from the official Chrome Web Store listing.
3. Open the new extension's options and accept the disclosure. Automatic pairing should connect it to Grace on this computer.
4. In Grace's **Settings → Sessions**, assign the newly connected profile to the correct browser profile. Remove or reassign any stale development profile entry.
5. Confirm connection before starting a protected session.

An unpacked extension installed with Developer mode is a development build and does not update into the Web Store installation. Removing it can remove its own local settings and browser rules. Do not copy a pairing token into a support request.

## Consent and pairing

The extension cannot pair until you accept the data-sharing disclosure. After acceptance, it attempts to retrieve pairing credentials through Chrome native messaging from Grace on the same computer. If automatic pairing is unavailable, open the extension options and use **Advanced pairing** with the pairing token from Grace's Sessions settings and a profile ID. Keep the token private. Protocol version 3 is required on both sides; Chrome 116 or later is required by the extension.

## Troubleshooting

- **No profile appears in Grace:** confirm Grace is running, reopen extension options, check that sharing is enabled, and allow the local connection. Restart Grace and Chrome if necessary.
- **Profile appears under the wrong browser:** assign the connected profile to the actual Chrome profile in Grace's Sessions settings. The extension does not identify or report your browser profile name.
- **A focus session will not start:** check that the profile is connected, correctly assigned, and enabled as required in Grace.
- **A blocked page remains after stopping sharing:** withdrawal closes sharing but a previously installed browser rule may remain until Grace sends an authenticated release. Reopen Grace and let the companion reconnect so it can receive the release. If Grace cannot reconnect, remove the extension to remove its locally installed rules.
- **Need to withdraw consent:** open extension options and select **Stop sharing and disconnect**. You can also disable or remove the extension from `chrome://extensions`.

## Contact

Use https://github.com/samir-scripts/grace/issues for support. Never post pairing tokens, keys, private profile data or unredacted logs. The Web Store contact is configured with Google; verification is pending.
