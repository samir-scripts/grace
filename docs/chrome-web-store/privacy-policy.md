# grace. Focus Companion Privacy Policy

**Effective date:** November 11, 2026.

**Applies to:** grace. Focus Companion for Google Chrome desktop, version 1.1.0 and later. The extension requires Chrome 116 or later. This policy is about the Chrome companion; Grace desktop has its own local application behavior.

## Summary

The extension connects Google Chrome on your computer to the Grace desktop app on that same computer. It uses the connection only to pair a browser profile and apply or release website blocking rules chosen in Grace. It has no account system, remote service, advertising, analytics, or telemetry. It does not send browsing history or visited page URLs to Grace's publisher or another remote service.

## Data the extension handles

The extension stores the following items in Chrome's extension-local storage on your device:

- Your consent decision.
- A pairing token, the configured local connection port, and a persistent profile identifier. Automatic pairing can create and store these values after consent. They are credentials and should be treated as sensitive.
- A cached set of limited appearance colors and animation preference so the options page can match Grace's theme.
Chrome stores browser blocking rules installed through its Declarative Net Request API separately from extension-local storage.

After you select **Accept & connect**, the extension sends a persistent profile identifier and authentication proofs to Grace over a local connection to `127.0.0.1` on the configured port. It sends policy acknowledgements and recurring connection checks over that authenticated local connection. Grace sends the blocking policy, including the domains you configured in Grace, to the extension over the same connection. The extension applies those rules in Chrome. It may inspect open tab URLs locally to replace a tab matching an active blocked domain with its bundled blocked page; The blocked-page URL includes the original tab URL, which may remain in the browser tab or history. These URLs are not sent to the publisher or another remote service. The blocked page displays the matched hostname locally.

Before consent, the options page may request Grace's local appearance settings so it can display a matching theme. That request does not pair the browser or send browsing data. The extension does not collect browser identity, device details, visited URLs, or error reports for the publisher.

## Permissions

- **Storage:** save consent, local pairing settings, profile identifier, and cached appearance.
- **Alarms:** retry the local connection periodically.
- **Declarative Net Request:** add, replace, or remove locally enforced rules for configured blocked domains.
- **Tabs:** inspect open tabs locally and redirect tabs matching an active blocking policy to the extension's blocked page.
- **Native messaging:** communicate with the Grace desktop app installed on the same computer for automatic pairing and appearance settings.
- **HTTP and HTTPS site access:** apply configured blocking rules to sites across `http://` and `https://` origins. This broad access is required because the user may choose any domain to block; the extension does not read or upload page contents.

## Consent, withdrawal, and retention

The extension remains disconnected until you accept the disclosure in its options page. If you decline, it saves that choice locally and does not pair or exchange focus-session data. Consent is saved in Chrome extension storage.

Select **Stop sharing and disconnect** to close the connection and stop future sharing. Withdrawal does not necessarily remove rules already installed in Chrome: they can remain until Grace later sends an authenticated release or replacement policy. If Grace is unavailable, keep in mind that the browser may retain those rules. The consent decision, pairing values, profile identifier, and cached appearance remain in local extension storage after withdrawal; remove the extension or clear its data in Chrome to remove the extension's stored data. Removing the extension also removes its Chrome blocking rules.

The extension publisher receives and retains no data. Grace stores its own focus profiles and settings locally on your computer; manage or delete those in Grace. Chrome controls its own extension storage lifecycle and backup behavior.

## Sharing and security

Data is exchanged only with the Grace app's local service on your computer. The extension does not contact a publisher server or share data with third parties. The pairing token authenticates the local connection; do not share it. Anyone with access to your computer or Chrome profile may be able to access local extension data.

## Changes and contact

This policy will be updated if the extension's data handling changes. For support or privacy questions, open an issue at https://github.com/samir-scripts/grace/issues. Do not include pairing tokens or other sensitive information in an issue.
