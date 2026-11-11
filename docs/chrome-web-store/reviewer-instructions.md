# Chrome Web Store Reviewer Instructions

**Status:** The Chrome Web Store item is an unpublished private draft with ID `cgibenlmgmblmalggjalnoaikjkdnoid`. Its production extension package has been uploaded to the draft, but it has not been submitted for review or publicly released. Restricted testers are not assigned. Compatible Grace downloads for review are pending CI production and publication.

## Compatible Grace builds

Use only a release candidate built by the current CI pipeline and matched to the OS being reviewed. These placeholders are not download links yet:

- **macOS universal — Grace 1.7.1:** `PENDING_CI_ARTIFACT_URL`
- **Windows x64 — Grace 1.7.1:** `PENDING_CI_ARTIFACT_URL`
- **Linux x86_64 — Grace 1.7.1:** `PENDING_CI_ARTIFACT_URL`

The existing local macOS build is not a public reviewer artifact. Windows and Linux packages have not been built. Do not use an older public release, local path, unpacked extension, or Chromium test fixture as a substitute for a matching release candidate.

## Access and requirements

- Use Google Chrome desktop 116 or later on macOS, Windows, or Linux.
- Install the Grace release candidate matching the review OS. Keep Grace and Chrome on the same computer.
- The companion is an unpublished private draft. A Chrome Web Store install link and restricted tester access will be supplied after the owner assigns testers and CI artifacts are published. The item is not publicly installable now.
- The extension version is 1.1.0 and uses native protocol version 3. It requires Grace with the matching native host and protocol.
- No Grace account or publisher credentials are required. For private draft installation, use the invited Google account once access is assigned. Use only disposable local test profiles and credentials.

## Suggested review flow

After the compatible download links and store access are available:

1. Install the matching Grace release candidate and Google Chrome.
2. Install grace. Focus Companion from the private Chrome Web Store item using the invited account.
3. Open extension options. Before consent, verify the disclosure offers **Accept & connect** and **Keep disconnected** and that the extension has not paired.
4. Select **Keep disconnected** and verify it stays disconnected. Reopen options, accept the disclosure, and verify local pairing begins.
5. In Grace, create a disposable focus profile with a harmless test domain such as `example.com`. Assign the connected profile to the Chrome profile under test.
6. Start a work session. Verify the configured domain is blocked and the bundled blocked page displays its hostname.
7. End the blocking interval and verify Grace sends a release and the domain becomes available again. Repeat for break, completion, stop, and emergency release as the review environment permits.
8. Select **Stop sharing and disconnect**. Verify the connection closes. If a rule was installed, it can remain until Grace reconnects and sends an authenticated release; this is described in the disclosure and privacy policy.

These steps are instructions for future store-installed acceptance. Passing unpacked Chromium integration tests does not establish this native installation flow. The macOS store-installed UI path remains blocked by the recorded guest input failure; Windows and Linux acceptance have not been run.

## Permissions and data use

The extension requests storage, alarms, declarativeNetRequest, tabs, nativeMessaging, and HTTP/HTTPS site access. It stores consent, pairing values, a persistent profile ID, cached appearance settings, and browser blocking rules locally. It receives the user's configured block policy from Grace over the local connection and checks open tab URLs locally to apply it.

The extension does not send visited URLs, browsing history, or page contents to a publisher service. When a blocked tab is redirected, the original tab URL is included in the extension's local blocked-page URL so the page can identify the blocked hostname; Chrome may retain that local extension URL in browser history. No analytics or advertising are included.

The requested site access covers HTTP and HTTPS sites because users may choose any such domain in Grace. Native messaging and the loopback connection communicate with Grace on the same computer.

## Troubleshooting and withdrawal

- **No profile appears:** confirm Grace is running, consent is enabled, and the matching native host is installed. Reopen options or restart Grace and Chrome.
- **Wrong profile assignment:** assign the connected profile to the actual Chrome profile in Grace's Sessions settings.
- **Blocking does not start:** confirm that the profile is connected, assigned, and marked required in Grace.
- **Blocking remains after withdrawal:** keep Grace available so the extension can reconnect and receive an authenticated release. Removing the extension removes its browser rules, but also removes the companion.

The public privacy and support pages are available at [privacy policy](https://grace-chrome-support.springygranola16.chatgpt.site/privacy.html) and [support](https://grace-chrome-support.springygranola16.chatgpt.site/).
