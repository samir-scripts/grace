# Gecko companion data-flow inventory

Source review: 2026-11-05 UTC. This inventory describes the current source, not a declaration, legal conclusion, or proof that an installed browser accepts the extension. See [baseline hashes and readiness](amo-ownership-consent-readiness.md). Actual user tokens, profile IDs, account identifiers and URLs must not be included in evidence.

## Scope and interpretation

The package builder copies all files in `extensions/focus/` alongside `extensions/firefox/manifest.json` (`scripts/build-browser-extensions.mjs:6-9,116-135`). The packaged set contains `background.js`, `bridge-auth.js`, `browser-identity.js`, `native-pairing.js`, `options.js`, `policy.js`, `blocked.js`, `options.html`, `blocked.html`, and `rules.json`. The initial rules file is empty (`rules.json:1`). `background.js:1-4` imports the policy, pairing, browser-identity and authentication modules; each HTML page loads its corresponding script. The manifest requests `storage`, `declarativeNetRequest`, `tabs`, `management`, `nativeMessaging`, and `*://*/*`; permissions alone do not prove a particular data transmission.

The table uses “extension-local” for data processed within the add-on/browser, “desktop” for the separate Pomotroid native application, and “browser UI” for extension pages/browser-managed network rules. Localhost is still outside the add-on when the desktop receives data. Browser-managed storage, dynamic-rule storage and tab-session persistence are not inspected here; their precise retention depends on the browser. `code` may contain arbitrary runtime API error text; do not assume it excludes personal data.

## Pairing and local configuration

| Boundary and fields | Origin → recipient | Storage, purpose, and source |
| --- | --- | --- |
| Native `{type: 'connect'}` | Extension-generated → `com.splode.pomotroid` native host | Automatic discovery of local pairing configuration. No user-entered payload in this request. `extensions/focus/native-pairing.js:48-56,104`; Rust message enum `src-tauri/src/focus/native_messaging.rs:11-15`. |
| Native `{type: 'config', token, port}` | Desktop-generated config → extension | Host reads local `focus_browser_config.json` and returns credential/port; missing port defaults to `1421`. Secret value must not be logged. `src-tauri/src/focus/native_messaging.rs:17-24,230-248`. |
| `token`, `port`, `profile_id`, `is_native_paired` | Native response and existing extension state → extension local storage | Pairing stores token, port, reused or generated `profile_id`, and `is_native_paired: true`; browser storage retention applies. `native-pairing.js:59-73`. |
| `token`, `profile_id`, `port` | User-entered token/profile ID and existing/default port → extension local storage | Manual options write and internal `{type: 'reconnect'}` request; `is_native_paired` is not changed there. `options.js:45-80`. The options page exposes pairing controls, not a data-consent choice (`options.html:54-71`). |
| `token`, `port`, `profiles[].profile_id`, `.browser`, `.is_required` | Desktop config → desktop app-data file | Desktop persists explicitly configured profiles and credential/port, not every connected client's transient metadata (`src-tauri/src/focus/browser.rs:38-50,143-165,214-230,271-275`). The native host reads the same desktop configuration; no file contents were inspected. |

## Authenticated loopback bridge

| Boundary and exact fields | Origin → recipient | Storage, purpose, and source |
| --- | --- | --- |
| Connection URL `ws://127.0.0.1:<port>/focus-browser` | Extension → desktop loopback bridge | Opens after local token/profile lookup, default port `1421`; URL itself carries no token. `background.js:87-103`. |
| `{type:'auth_init', version:2, client_nonce}` | Extension-generated → desktop | Initial handshake; random nonce. `bridge-auth.js:117-122`; sent at `background.js:119-129`. |
| `{type:'auth_challenge', version:2, server_nonce, proof}` | Desktop → extension | Server proves possession of the shared token before client response; `bridge-auth.js:42-53`; Rust handshake is `src-tauri/src/focus/browser.rs:312-344`. |
| `{type:'auth_response', version:2, metadata, proof}` | Extension → desktop | `metadata` is a JSON string serializing `[profile_id, browserKind, install_type, may_disable]`. Profile ID is persisted/generated or user-entered; browser kind is computed from browser info/user agent; install type and disableability derive from `management.getSelf`, with `development`/`true` fallback. HMAC proof derives from token; the token itself is not a WebSocket field. `background.js:36-48,96,124-128`; `browser-identity.js:1-16`; `bridge-auth.js:42-60`. The full browser info/user-agent string and browser version are not transmitted by the inspected identity function. |
| Authenticated envelope `{type:'authenticated', sequence, payload, mac}` | Either peer → other | `payload` is serialized JSON; MAC provides integrity/authentication, not confidentiality. `bridge-auth.js:67-76,88-108`; Rust receiver `browser.rs:433-440`. |
| Server policy payload `{type:'policy', version, revision, active, domains, lease_secs}` | Desktop → extension | `domains` are user-selected focus-profile configuration, not proof of websites visited. Revision/activity control rule application. `src-tauri/src/focus/browser.rs:87-96`; `background.js:148-162,212-228`. |
| Server heartbeat `{type:'heartbeat', revision}` | Desktop → extension | Bridge liveness and revision; `src-tauri/src/focus/browser.rs:97-99`; `bridge-auth.js:101-105`. |
| Client payload `{type:'ack', revision, profile_id}` | Extension → desktop | Confirms rule update for a revision; held as connection state. `background.js:245-247`; `browser.rs:447-453`. |
| Client payload `{type:'heartbeat', revision, profile_id}` | Extension → desktop | Repeated every two seconds after establishment; profile ID and last revision are sent. `background.js:202-209`; `browser.rs:455-457`. |
| Client payload `{type:'error', revision, profile_id, code}` | Extension → desktop | `code` is the API exception message when available, otherwise `dnr_error`. Desktop retains the received code in connection state; an enforcement error can include both profile ID and code. Its content is not bounded here beyond browser/API behavior. `background.js:248-254`; `browser.rs:80-84,459-463,589-597`. |

The desktop keeps connected client identity, installation metadata, last-seen time, ACK revision, and received error in memory; it removes a connection when closed (`browser.rs:102-112,382-393`). `BrowserConfig` persists explicitly configured profiles, but not the transient installation metadata or error code. Browser identity/version category and necessity of each transmitted field remain policy questions, not conclusions from the protocol.

## Local browsing and browser-managed rules

| Data / operation | Origin → recipient | Storage, purpose, and source |
| --- | --- | --- |
| `domains`, derived `urlFilter` values and generated rule IDs | User-selected profile via desktop → extension → browser DNR | Extension canonicalizes domains and builds block rules for `main_frame`, `sub_frame`, `xmlhttprequest` and `websocket`; it reads and replaces dynamic rules. Browser manages their storage/lifetime. `policy.js:1-32`; `background.js:212-228`. |
| Open-tab `tab.url`, `tab.id` | Browser tabs API → extension-local comparison/browser UI | Only when there are active new rules, extension queries open tabs, compares URL hostnames, and navigates matches to an extension page with the **full URL encoded in its query string**. This is open-tab access, not a browser-history API read. The query may appear in browser-managed tab/session state; retention is not established. `background.js:230-240`; `policy.js:35-48`. |
| Redirect query `url` | Local extension page → local page rendering | `blocked.js` reads the query and displays the parsed hostname; on URL parsing failure it displays the raw value. `blocked.js:1-11`; `blocked.html:57-63`. No inspected explicit bridge message sends `tab.url`; the separate error-text channel above cannot be proven to exclude URL-containing messages. |

## Diagnostics, startup, and error paths

- `background.js:17,87-103,119-161,169-197,228-250` emits local console diagnostics for connection stages, presence booleans, port, browser kind, version, revision, active state, counts, close code and error stage. The inspected diagnostic calls do not explicitly print token values, profile IDs, or tab URLs; arbitrary API errors sent as `code` remain sensitive.
- `native-pairing.js:53-104` reports native pairing stages and coarse error reasons locally. `native_messaging.rs:230-248` writes native-host diagnostics to stderr with port and a token-presence boolean, while the framed config response is written to stdout. Do not capture native stdout as shared evidence.
- `browser.rs:370-380,447-463,589-597` logs connection ID, browser kind, revision and status; the client-error debug log does not directly print the received error code, but the returned enforcement error can include profile ID and error text. Downstream UI/log propagation needs redaction before sharing evidence.
- `background.js:258-300` handles reconnect messages, startup/install, alarms and tab activation; `bootstrap()` automatically requests native pairing and then connects. The inspected startup and options paths have no separate collection-consent gate. Whether a given transfer requires such a gate is a separate Mozilla-policy determination.

## Completeness check and unresolved boundaries

The source audit searched every packaged module for `connectNative`, `postMessage`, `.send`, local storage, tab-query/update, rule-update and diagnostics. Wrapper-level storage calls in `native-pairing.js:1-45` and `options.js:11-42` lead to the concrete writes above. `options.js:77-80` sends only an extension-internal reconnect message. No inference is made that all browser- or OS-level persistence is known, that error strings cannot include browsing data, or that user-visible consent behavior has been verified in Firefox or Zen.
