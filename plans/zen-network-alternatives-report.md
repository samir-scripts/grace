# Zen/Firefox diagnosis and unsigned network-blocking alternatives

## Decision and current status

Retain the browser extension while fixing the demonstrated Gecko transport failure. A DNS sinkhole with narrowly owned firewall rules is worth prototyping as a **cooperative-user, hostname-resolution control**, not as a proven replacement for browser-level blocking. Do not remove the extension or merge the current focus-blocking work until actual installed Zen and Firefox pairing, blocked and allowed navigation, release and packaged native-host behavior are observed. The original personal installation's failure has not been independently traced.

This report specifies an experiment; it does not implement a network helper, modify production DNS/firewall settings, or demonstrate unsigned distribution. A separate implementation plan must settle helper IPC authorization, DNS library and platform-specific recovery before production code is written.

## Diagnosis evidence

- Host: Apple Silicon (`arm64`), macOS 15.8.2 (24H232), 107 GiB available before provisioning, 16 GiB RAM. macOS and Tart license applicability depends on the installation's circumstances; consult the [macOS Sequoia license](https://www.apple.com/legal/sla/docs/macOSSequoia.pdf) and [Tart licensing](https://tart.run/licensing/).
- `brew install cirruslabs/cli/tart` failed because the tap's formula uses disabled `depends_on :macos` syntax. Homebrew automatically updated its metadata and added the Cirrus tap. The official Tart 2.41.1 archive SHA-256 matched the published release digest `e680a734febccfce7d4e910c1f7f13fc3b00f19a181c945e2d746de3214c32c2`. `tart --version` returned `2.41.1`. The downloaded Sequoia image resolved to `sha256:eee659985b01e4df2a6c0754bd8d25e54969933c43fdcd4edef8bea337b3d354`; auto-pruning was disabled. The untouched clean clone is stopped; a separate guest booted macOS 15.7.7 (24G720), reached `example.com`, and has Zen 1.24b and Firefox 159.0.1 installed under guest `/Applications`.
- A frozen source archive transferred to the guest has SHA-256 `43c3f240ce2c9d5a0c7b73a2f29cd40a5c688b53766ccbf817092de7f519a146`. It includes the dirty source and excludes Git metadata, build targets, generated extension distributions and dependencies. Browser installation in the guest is not yet evidence of extension installation or enforcement.
- In the guest, `npm ci --ignore-scripts` installed 94 packages and reported 9 audit findings (3 low, 1 moderate, 5 high); no audit remediation was applied. `npm run extensions:build` produced the same XPI hash as the existing host artifact. Rust 1.99.1 built the debug native host; `npm run tauri dev` launched the actual desktop app. A fresh `npm run tauri build -- --bundles app` succeeded.
- With the actual debug app's **Install Extension** buttons, guest Zen and Firefox each received a `force_installed` policy pointing at the existing unsigned debug XPI; the Mozilla host manifest allowed `focus@pomotroid.local` and pointed to the existing debug host. Fresh guest profile `extensions.json` files did not list that ID. This is a diagnostic observation, not conclusive proof of rejection: browser installation may be asynchronous or reported elsewhere. Headless Firefox `about:policies` showed the policy as Active; a headless Zen capture showed the packaged policy with “Not fully applied.” Neither proves a running add-on, and the precise installation error remains unobserved.
- The guest's active session had no blocked apps and `blocked.test` as its only blocked domain. Clicking the actual timer Play button reproduced `25:00` and the banner “Distraction blocking could not start. Check the selected apps and browser extension, then retry.” With Verbose Logging enabled, retry at 19:58:37 produced `apply apps=0 domains=1` followed by `apply_failed reason=no_companion`. This identifies the immediate start failure, not why a companion did not connect or whether the original personal installation failed for the same reason.
- **Reproduced transport cause in temporary add-ons:** Zen 1.24b and Firefox 159.0.1 both obtained credentials but their extension consoles reported `Firefox can’t establish a connection to the server at wss://127.0.0.1:1421/focus-browser.` The extension source constructs `ws://127.0.0.1:1421/focus-browser`; the desktop listener was confirmed on `127.0.0.1:1421` and answered an ordinary HTTP request with status 400. Their close diagnostics showed code 1015. [Mozilla's MV3 CSP documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy#upgrade_insecure_network_requests_in_manifest_v3) states that the default extension CSP upgrades insecure requests; this manifest has no CSP override.
- **One-variable guest comparison:** a disposable copy of the built extension retained every manifest field and added only `content_security_policy.extension_pages: "script-src 'self'; object-src 'none';"`; the original built files and working tree were not changed. `web-ext run` temporarily loaded the copy in Zen and Firefox. The desktop log recorded authenticated `hello_accepted` for Zen and Firefox and their matching inactive-policy revision 0 ACKs. The original temporary add-ons showed the failed `wss://` attempt. This demonstrates the transport cause in these guest builds; it does not prove persistent deployment or justify a broad security-policy relaxation without review.
- With both experimental temporary companions online, a 60-second guest work session with `example.com` as the only blocked domain started. The bridge sent revision 1 to two participants, received both ACKs, and skipped the application monitor because no targets remained. The native timer was later observed on `SHORT BREAK` at `00:58`. Actual blocked/allowed page navigation and policy cleanup were not established, so neither website enforcement nor release is marked passed.
- The fresh packaged app contains executable `Contents/MacOS/pomotroid-native-host` and `Contents/Resources/_up_/extensions/dist/firefox/focus@pomotroid.local.xpi`; the XPI hash matches the debug artifact. The packaged app's actual Zen remove/install actions registered the packaged executable and packaged XPI paths. A direct framed subprocess call to that registered binary returned one valid `config` frame and exit 0, without exposing the token. Browser-initiated host launch and pairing remain unobserved; older bundle observations do not describe this fresh build.
- Guest GUI automation required macOS prompts for `tart-guest-agent` controlling System Events and screen capture. Approval was given within the disposable guest only; it is not evidence of Pomotroid Accessibility authorization. Firefox displayed a first-run Terms of Use consent screen; no consent was accepted on the user's behalf.
- Existing built `extensions/dist/firefox/focus@pomotroid.local.xpi`: SHA-256 `60e2f40a3876e63e21447195b966ff2f40a8131a4237623fc2c70c9f7f85ea1e`; archive listing contains no `META-INF/` signing entries. The source manifest declares ID `focus@pomotroid.local`, version `1.0.0` and Firefox minimum `115.0`. This is package evidence, not evidence that Zen or Firefox accepted or rejected it.
- `scripts/build-browser-extensions.mjs` creates the Firefox XPI as a ZIP. `focus_native_host_register` searches beside the main executable, then in the resource directory; `register_native_messaging_manifests` rejects a missing executable. `src-tauri/tauri.conf.json` declares extension resources, but inspecting source alone does not prove the contents of a newly built application bundle.
- `node --test extensions/tests/browser-identity.test.mjs extensions/tests/native_pairing.test.mjs extensions/tests/policy.test.mjs extensions/tests/policies.test.mjs`: **20 passed**, 0 failed. `cargo test --manifest-path src-tauri/Cargo.toml --test native_messaging`: **6 passed**, 0 failed; three compiler warnings. The macOS subprocess test supplies a temporary child `HOME` and verifies framed stdout and redacted stderr. These are not installed-browser tests.
- The previous evidence and unverified candidate boundaries are recorded in [the Zen handoff](zen-extension-omp-handoff.md). The package-policy-present flag, host packaging and silent pairing wait are candidates, not demonstrated causes of the screenshot.

| Acceptance item | Status | Evidence needed |
| --- | --- | --- |
| Actual installed Zen and Firefox add-on accepted | BLOCKED | Browser inventory, console and package identity |
| Native pairing, authenticated WebSocket, policy ACK | PARTIAL | Experimental temporary Zen/Firefox add-ons connected and ACKed; persistent signed add-on still unverified |
| Timer, blocked and allowed navigation, release and restart | PARTIAL | Temporary-add-on timer and active-policy ACK observed; real page blocking, release and restart remain unverified |
| Fresh packaged native host | PARTIAL | Fresh app contents, UI registration and direct framed host launch observed; browser-initiated host launch unverified |
| DNS/firewall prototype and restoration | NOT TESTED | Separate guest-only implementation and crash/reboot tests |
| Unsigned distribution and VPN coexistence | NOT TESTED | Clean OS installations and representative VPN/split-DNS tests |

## What unsigned distribution can and cannot promise

| Question | Documented basis and decision |
| --- | --- |
| macOS privileges | A user can authorize installation of a root-owned launch daemon; do not store a password or make the GUI root. [Apple ServiceManagement](https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos) describes daemon registration and authorization on macOS 13+. User approval, installation, and a running helper are separate states. Legacy support needs its own design. |
| Windows privileges | UAC elevation may require consent or administrator credentials and may be restricted by policy. Creating a Windows service requires appropriate Service Control Manager rights. Use an elevated installer and a narrowly authorized service, not a permanently elevated GUI. [UAC](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works), [service access rights](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights). |
| One-time prompts | Neither Gatekeeper/Open Anyway, SmartScreen nor UAC can be promised exactly once across installs, updates, security settings or devices. Opening an unsigned app is not proof a helper, driver or system extension can load. [Apple Gatekeeper](https://support.apple.com/en-us/102445). |
| macOS Network Extensions | Apple describes DNS proxy and content-filter providers as system-extension deployment types on macOS; system-extension distribution and entitlements are separate constraints. A normal unsigned executable cannot be assumed to deploy an unsigned Network Extension. See [Apple deployment guidance](https://developer.apple.com/documentation/technotes/tn3134-network-extension-provider-deployment) and [System Extensions](https://developer.apple.com/documentation/systemextensions). Do not disable SIP as a distribution solution. |
| Windows filtering | Windows Filtering Platform supports built-in permit/block filters without necessarily shipping a custom callout driver; these filters do not automatically classify arbitrary domain names. [WFP overview](https://learn.microsoft.com/en-us/windows/win32/fwp/about-windows-filtering-platform). WinDivert uses a kernel driver even though its application API is user mode. Upstream documents prebuilt signed drivers and administrator rights; verify the selected release, Windows security compatibility and [LGPL v3 or GPL v2 licensing](https://github.com/basil00/WinDivert/blob/master/LICENSE) before redistribution. [WinDivert documentation](https://www.reqrypt.org/windivert-doc.html). |

## Encrypted DNS, ECH, and coverage

A network-level DNS proxy only sees requests that reach it. Firefox's [`DNSOverHTTPS` enterprise policy](https://firefox-admin-docs.mozilla.org/reference/policies/dnsoverhttps/) controls its supported modes. The [`use-application-dns.net` canary](https://support.mozilla.org/en-US/kb/canary-domain-use-application-dnsnet) is an automatic-DoH opt-out signal, not a firewall and not a guarantee against explicit configuration. Chromium has a separate [`DnsOverHttpsMode`](https://raw.githubusercontent.com/chromium/chromium/main/components/policy/resources/templates/policy_definitions/Miscellaneous/DnsOverHttpsMode.yaml) policy (`off`, `automatic`, `secure`); do not apply its policy schema to Firefox or assume Zen honors a policy until observed.

Blocking port 53 and DoT port 853 reduces ordinary bypasses. A finite list of DoH resolver IPs cannot block every DoH service using HTTPS 443, arbitrary proxies, VPNs, direct IP access, other interfaces or administrator changes. IP rules can overblock shared services. A system DNS change also does not retroactively close existing connections or erase all caches. No universal bypass guarantee is justified.

[RFC 9460](https://www.rfc-editor.org/rfc/rfc9460.html) defines HTTPS/SVCB records; they can carry connection parameters, including ECH configuration. [RFC 9848 §8](https://www.rfc-editor.org/rfc/rfc9848.html#section-8) explains how preventing SVCB resolution can downgrade ECH discovery. Stripping type 65 is not a general guarantee that ECH is unavailable; it can impair privacy, service discovery and DNSSEC validation. Test it explicitly rather than deploying it by default. SNI inspection is incomplete when ECH hides the inner ClientHello, and QUIC and fragmented TLS add parsing requirements.

## Minimal prototype outline — disposable guests only

1. Build a standalone loopback DNS proxy for TCP and UDP port 53. Normalize domain names; return NXDOMAIN for the exact blocked hostname and label-boundary subdomains, for A and AAAA queries. Forward allowed queries to the previously configured resolver without a loop; account separately for split DNS, encrypted upstreams, VPN interfaces and IPv6. Do not hardcode a public resolver as a replacement for private DNS.
2. Keep the GUI unprivileged. A separately supervised root/Administrator helper owns privileged changes; protect executable and configuration from unprivileged writes. Its authenticated local interface accepts only fixed operations, never arbitrary shell commands or paths. An elevated installation is explicit and cannot save passwords.
3. Before each change, journal original per-interface DNS state, ownership identifiers for firewall objects and the session lease. Verify proxy health before directing DNS to loopback. Restore only state still equal to the helper's own written value; report concurrent changes instead of overwriting them. Recover after partial application, GUI loss, helper crash and reboot without depending on the GUI process. A 15-second in-process watchdog alone is not proof of recovery after process death.
4. Use only an owned PF anchor or owned Windows Firewall/WFP objects. Verify PF anchor ordering, enable-state handling, permitted upstream traffic and independent rollback in a guest. Never flush or replace the user's global ruleset. DNS/DoT restrictions and any known DoH-IP restrictions remain measured heuristics.
5. Keep initial scope outside the production Tauri timer. For eventual integration, reassess the existing `NativeEnforcer` interface and perform a separate, fully specified migration and security review.

### Illustrative OS commands — do not run on the personal host

The proxy must already be healthy. These examples are incomplete without a journal, independently tested recovery and an identified guest interface; they are **not an installer**.

macOS, inside the disposable guest:

```sh
networksetup -listallnetworkservices
networksetup -getdnsservers "$SERVICE"
sudo networksetup -setdnsservers "$SERVICE" 127.0.0.1
dig @127.0.0.1 example.com
# Restore the exact saved static addresses; only for originally automatic DNS:
sudo networksetup -setdnsservers "$SERVICE" Empty
```

Windows PowerShell, elevated inside a disposable guest:

```powershell
Get-DnsClientServerAddress
Set-DnsClientServerAddress -InterfaceIndex $Index -ServerAddresses 127.0.0.1
Resolve-DnsName example.com -Server 127.0.0.1
# Restore the exact saved static addresses; only for originally automatic DNS:
Set-DnsClientServerAddress -InterfaceIndex $Index -ResetServerAddresses
```

Microsoft documents that setting static DNS overrides DHCP and `-ResetServerAddresses` restores DHCP defaults: [Set-DnsClientServerAddress](https://learn.microsoft.com/en-us/powershell/module/dnsclient/set-dnsclientserveraddress?view=windowsserver2025-ps). Run no example before a working recovery procedure exists.

## Future prototype verification matrix

All rows are **NOT TESTED**. Run only in disposable macOS and Windows guests. Mark missing signed artifacts, operating systems, browser builds, VPN accounts or clean-install environments BLOCKED.

- Resolver behavior: blocked apex and subdomain; allowed domain; A/AAAA; UDP/TCP; forwarding and DNSSEC; both loopback families; pre-existing cache and existing HTTP/2/HTTP/3 connection.
- Browser behavior: real Zen and Firefox default and explicitly configured DoH, enterprise-policy recognition, canary behavior, fresh and existing tabs, restart, direct-IP access, arbitrary DoH and DNS over port 53/853. Distinguish a blocked browser request from an independently verified network-layer denial.
- Network conditions: IPv4/IPv6, alternate adapters, adapter changes, representative VPN and split DNS, reconnect, internal names and external names. No authorized test VPN means coexistence remains unverified.
- HTTPS/ECH: controlled authoritative/resolver fixture with ordinary versus type 65 suppression, cached records and DNSSEC. Observe actual ClientHello/ECH outcomes; an ECH GREASE extension alone does not prove an encrypted origin.
- Restoration and security: abort during each apply step; kill GUI and helper; expire lease; reboot; uninstall; compare DNS, routes, unrelated firewall rules and policies to baseline. Ensure concurrent external edits are not overwritten and unprivileged clients cannot command arbitrary operations.
- Distribution: download the actual unsigned GitHub-style artifacts with normal quarantine/reputation checks, then record Gatekeeper, SmartScreen, UAC, service/driver installation, update and uninstall behavior in clean guests. Do not claim prompts appear only once.
