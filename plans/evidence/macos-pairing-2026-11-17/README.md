# Grace companion pairing on macOS

Grace 1.7.1 ran in a disposable macOS 15.7.7 ARM64 Tart guest. Each browser used a fresh profile and ran by itself. Grace’s Sessions settings registered the native host. Chrome installed its companion directly from the Chrome Web Store. Firefox and Zen installed the XPI bundled with Grace through the app’s normal setup. Both reported the add-on active and signed, and their installed archives matched the bundled XPI byte for byte.

| Browser | Companion | Before consent | After consent | After full browser restart |
| --- | --- | --- | --- | --- |
| Chrome 157.0.8103.79 | Web Store 1.1.2 | [Disconnected](chrome-consent.png) | [Connected](chrome-connected.png) | [Connected](chrome-restart.png) |
| Firefox 160.0 | Mozilla-signed 1.1.4 | [Disconnected](firefox-consent.png) | [Connected](firefox-connected.png) | [Connected](firefox-restart.png) |
| Zen 1.24.1b | Mozilla-signed 1.1.4 | [Disconnected](zen-consent.png) | [Connected](zen-connected.png) | [Connected](zen-restart.png) |

In each browser, the companion paired after **Accept & connect** with Advanced pairing closed. Grace independently showed an **Active** profile after refreshing Browser Companions. A full browser quit and relaunch preserved the install and restored the connection without asking for consent again.

The initial Chrome attempt used a custom user-data directory and could not find the native host. The fresh profile passed from Chrome’s standard guest data directory after Grace registered the host again. Chrome briefly displayed a protocol compatibility hint while the first connection was still pending, then showed **Connected**. The Web Store 1.1.2 page has the earlier header without the Grace logo.

| Release input | SHA-256 |
| --- | --- |
| Grace macOS executable | `9c3c7aff95e1c0d5d3f7a79be0cca8cab6d941c7a8421a92b92999ba1631ff77` |
| Bundled Firefox XPI | `dc1c123567d898f998d46ce025f1a3782aeb74770384172e9a696b0de3b88cdb` |

This run covered consent, pairing, and reconnection with the local Grace 1.7.1 release.
