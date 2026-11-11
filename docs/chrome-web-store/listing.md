# Chrome Web Store Listing Draft

**Status:** Store account is ready. An unpublished draft exists with ID `cgibenlmgmblmalggjalnoaikjkdnoid`; no Chrome Web Store release has been published. The public support destination, monitored contact, final graphics, and hosted privacy-policy URL remain prerequisites.

## Product details

- **Name:** grace. Focus Companion
- **Short description (68/132 characters):** Block the websites you choose in Grace during Chrome focus sessions.
- **Category:** Productivity
- **Language:** English (United States)
- **Target:** Google Chrome desktop on macOS, Windows, and Linux
- **Minimum Chrome version:** 116
- **Version in source manifest:** 1.1.0

## Submitted description

Make it easier to stay with a Grace focus session. grace. Focus Companion connects Google Chrome on your computer to Grace desktop and blocks the websites you choose while a work session is active.

### Keep your chosen sites out of the work session

Add websites to Grace's block list. The companion applies those rules in Chrome during a protected work session and releases them when Grace sends the release policy.

### Connect once, focus in Chrome

Install Grace and the companion on the same computer. After you review and accept the connection disclosure, the companion tries to pair with Grace locally and reconnects automatically. Assign the connected browser profile in Grace's Sessions settings before starting a protected session.

### Get started

Install Grace desktop, add grace. Focus Companion from the Chrome Web Store, accept the connection disclosure, then assign the connected profile in Grace's Sessions settings.

### What to expect

- Requires Grace desktop to be installed and running on the same computer.
- Requires Google Chrome desktop 116 or later on macOS, Windows, or Linux.
- This companion connects Chrome to Grace; it is not a standalone timer, account, or web service.
- Stopping sharing disconnects the companion. Browser rules already applied may remain until Grace reconnects and sends an authenticated release. See the privacy policy for details.
- The companion exchanges profile identification, authentication, policy acknowledgements, connection checks, and the configured blocking policy with Grace over a local connection. It does not send visited URLs, browsing history, page contents, or error reports to the publisher.

### Open-source roots

Grace is an independent fork of Pomotroid, created by Christopher Murphy (Splode). This companion adds browser focus blocking for Grace and is not an official Pomotroid extension.

Pomotroid repository: https://github.com/Splode/pomotroid

Pomotroid website: https://pomotroid.app/

## Permission explanations for submission

- **Storage:** save your consent decision, local pairing details, profile ID, and display preferences.
- **Alarms:** retry the local Grace connection.
- **Declarative Net Request:** apply or release the blocking rules you configure in Grace.
- **Tabs:** check open tabs locally and show the extension's blocked page for a matching blocked site.
- **Native messaging:** connect to Grace desktop on the same computer for pairing and theme settings.
- **HTTP and HTTPS site access:** block any HTTP or HTTPS domain you choose in Grace.

## Privacy disclosures for listing setup

Use the policy in [privacy-policy.md](privacy-policy.md) as the authoritative data-handling description. Based on the current extension source:

- Data handled: authentication information and a persistent profile identifier, stored locally and shared only with Grace on the same computer; user-configured blocked domains are received locally and installed as browser rules.
- Data not collected for the publisher: browsing history, visited URLs, page contents, browser identity, device details, and error reports.
- Sale, advertising, or third-party transfer: none.
- Remote data collection or analytics: none.
- Purpose: local functionality, authentication, and security of the browser-to-desktop connection.

Verify these declarations against the final packaged build and Chrome Web Store data-use choices before submission.

## Listing assets and publication fields still required

- Store item ID: `cgibenlmgmblmalggjalnoaikjkdnoid`.
- Intended listing: https://chromewebstore.google.com/detail/cgibenlmgmblmalggjalnoaikjkdnoid (not public yet).
- Privacy policy: https://grace-chrome-support.springygranola16.chatgpt.site/privacy.html
- Support: https://grace-chrome-support.springygranola16.chatgpt.site/; publisher contact still requires owner selection/verification.
- Public setup instructions are included in the support page.
- Publisher account: **ready**; public identity and listing details still need to be finalized.
- Store icon and actual extension consent screenshot uploaded to draft; optional promo artwork omitted.
- Final release package, listing declarations, and Chrome Web Store review: **not submitted or approved**.

## Internal reference note — not part of the submitted description

Reviewed [BlockSite's official Chrome Web Store listing](https://chromewebstore.google.com/detail/blocksite-block-websites/eiimnmioipafcokbfikbljfdeojpcgbh) on 2026-11-11 for structure only: a benefit-led opening followed by feature sections and setup guidance. Grace's description above is original and uses no copied prose, competitor claims, or competitor statistics.
