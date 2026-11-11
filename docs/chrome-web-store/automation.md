# Chrome Web Store API Automation

This helper uses Chrome Web Store API V2 for two operations: check the item's status and upload a validated package to the item's draft. It has no publish operation. Uploading changes the draft in the Developer Dashboard; a draft is not submitted for public review by this helper.

## One-time store setup

The Chrome Web Store API cannot create the first store item. Create the item in the Chrome Web Store Developer Dashboard first, and complete its initial package, listing, and Privacy details there. Copy the publisher ID from the dashboard and configure the public release identity in `extensions/chrome/release.json`:

- `publisher_id`: the public publisher UUID.
- `extension_id`: the 32-character Chrome extension ID for the release signing identity.
- `public_key`: the matching public key.
- `privacy_policy_url` and `support_url`: the hosted public HTTPS pages.

The release builder validates the extension key and ID. The upload helper also checks the ZIP's manifest against that configured identity before making a network request.

## Credentials

Preferred: use a service account linked to the Chrome Web Store publisher. Store its JSON key in the repository-root `.env.chrome-service-account.local` file with owner-only permissions (`chmod 600`). The helper checks that it is a regular, non-symlink file, restricts its mode, and checks the owner where the operating system exposes file ownership. Or set `CHROME_SERVICE_ACCOUNT_FILE` in the environment to an owner-only JSON key file elsewhere.

The helper signs a short-lived RSA SHA-256 JWT with the service-account private key and exchanges it for a one-hour Google access token. It requests the Chrome Web Store write scope. The private key and assertion are never printed. Google recommends careful handling of service-account key files; keep the file local, outside artifacts, and never commit or share it.

OAuth refresh credentials are also supported through a secure environment secret store or a repository-root `.env.chrome.local` file with these values:

```dotenv
CWS_CLIENT_ID=your-oauth-client-id
CWS_CLIENT_SECRET=your-oauth-client-secret
CWS_REFRESH_TOKEN=your-oauth-refresh-token
```

Restrict the file to its owner (`chmod 600 .env.chrome.local`). The repository ignores `.env.*`; keep either credential file local and never stage, commit, paste, or log it. A service-account file takes precedence over OAuth credentials. If `CHROME_SERVICE_ACCOUNT_FILE` is explicitly set but unavailable or insecure, the helper stops. Otherwise OAuth environment variables take precedence only when all three are set. If environment credentials are incomplete, the helper stops instead of silently falling back to the OAuth file. It rejects credential files that are not regular owner-readable files with no group or other permissions, whose ownership cannot be verified as the current user, that are symlinks, or that are missing required values. On systems where Node cannot verify file ownership, use an environment secret store instead of a credential file.

For OAuth credentials, create credentials for the Chrome Web Store API and authorize the refresh token using a Google account that has access to the publisher. `status` needs the Chrome Web Store read-only scope or the full scope. `upload` requires the full `https://www.googleapis.com/auth/chromewebstore` scope. The refresh token must already have the appropriate scope; the helper does not initiate an interactive consent flow. For service-account setup, follow [Google's Chrome Web Store service-account instructions](https://developer.chrome.com/docs/webstore/service-accounts); add the service-account email to the publisher in the Developer Dashboard.

## Commands

Build the release package after the public item identity and URLs are configured:

```sh
npm run extensions:build -- --chrome-release
```

Inspect the current store item status:

```sh
node scripts/chrome-web-store.mjs status
```

Upload the default `extensions/dist/chrome.zip` draft package:

```sh
node scripts/chrome-web-store.mjs upload
```

Or name another release ZIP explicitly:

```sh
node scripts/chrome-web-store.mjs upload /path/to/chrome-release.zip
```

The command prints only allow-listed item status or upload state fields. Provider response bodies, OAuth tokens, and credential values are omitted from output and errors. Requests go only to Google's fixed HTTPS OAuth and Chrome Web Store API endpoints, redirects are rejected, and requests time out after 30 seconds.

## Public submission gate

No `publish` command is implemented. Uploading a package updates the existing item's draft and does not submit it for review. Review the uploaded package, listing, privacy declarations, support destination, and acceptance evidence in the Developer Dashboard before using its explicit submit-for-review control. The Chrome Web Store API V2 likewise separates package upload from the `publish` operation; this helper intentionally does not call that operation.

## API references

- [Chrome Web Store API V2 overview and setup](https://developer.chrome.com/docs/webstore/using-api)
- [Chrome Web Store API V2 REST reference](https://developer.chrome.com/docs/webstore/api/reference/rest)
- [Chrome Web Store service accounts](https://developer.chrome.com/docs/webstore/service-accounts)
- [V2 `fetchStatus` method](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus)
- [V2 API introduction and endpoint migration](https://developer.chrome.com/blog/cws-api-v2)
- [Google OAuth 2.0 service-account JWT flow](https://developers.google.com/identity/protocols/oauth2/service-account)
