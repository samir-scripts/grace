# Chrome Web Store submission · November 17, 2026

Google accepted version **1.1.4** for review under the existing Grace item, `cgibenlmgmblmalggjalnoaikjkdnoid`. The dashboard displayed **Pending review**. The submission selected automatic publication after approval. [Dashboard confirmation](submission.jpg)

The [submitted ZIP](grace-focus-companion-1.1.4.zip) has SHA-256 `a7413bea0b47f8f2405a4e8ce73f7c76bacb775d897c3be51c6925493c041825`. The candidate adds the Grace consent logo and describes site availability according to the session’s blocking rules. Its manifest requests the same permissions as the live 1.1.2 package. All JavaScript files shipped in 1.1.2 matched byte for byte.

In a disposable macOS 15.7.7 ARM64 Tart guest, Chrome 157.0.8103.79 installed the extracted candidate using Load unpacked in a fresh Chrome profile. Accept & connect activated the profile in the Grace 1.7.1 release, and a full Chrome quit and restart restored the connection. The initial automated loader used a temporary install. The persistent test used Chrome’s normal Load unpacked control. [Consent](consent.png) · [Connected](connected.png) · [After restart](restart.png)

The production build and type check passed. The full test suite passed 186 tests and skipped two opt-in captures.
