# Secret-scanning alert investigation — 2026-11-11

## Report

The owner received a GitHub alert identifying an OpenVSX Access Token in `extensions/tests/chrome-web-store.test.mjs:15`, introduced in commit `ca510d8318ec97a88fc6f842190cb701cfac321c`. The reported value is deliberately omitted from this report.

## Findings

- The flagged field is `publisher_id`. Its value matched the production Chrome Web Store publisher UUID, which Google documents as the identifier used in API endpoint paths. Authentication separately requires an OAuth bearer token. This UUID is not an OpenVSX personal access token or a Chrome publishing credential.
- The test's RSA keys are generated at runtime. No static private key was found in this test file.
- The local Chrome publishing private key was not found in any currently tracked file. Its ignored local filename is absent from reachable Git history. This scoped check did not enumerate unrelated credentials or expose credential contents.
- Independent Terra source review reached the same classification: false positive at the reported location. GitHub separately documents OpenVSX detector changes intended to avoid treating unrelated UUIDs as credentials.

## Remediation and rotation decision

- Replaced the live publisher identifier in the test fixture with `randomUUID()`. Tests now use a runtime-generated publisher identity rather than duplicating production metadata.
- Focused API-helper tests passed 11/11 after the change.
- No affected credential was identified, so there is no key to rotate for this alert. Rotating the extension's public signing identity would change its ID and break installation/pairing, and rotating an unrelated service-account key would not remediate this identifier match.
- Secret scanning remains enabled. No history rewrite or pattern suppression was used.
- Authenticated inspection found GitHub alert #1 with validity Unknown and two locations: the test publisher_id and the production release configuration publisher_id. Both matched the Google publisher identifier.
- A scoped independent scan of 2,978 reachable text blobs found zero matches for the recognized credential formats checked. It skipped 239 binary/large blobs and cannot rule out other formats, unreachable history, or local-file exposure.
- Automatic approval review initially rejected dismissal without explicit owner approval. The owner subsequently approved closing as a false positive. Authenticated GitHub inspection then showed the alert already closed as false positive, with an explanation that it is the publisher ID. The assistant did not reopen it. No key rotation was needed or performed.

## Sources

- [Google: Chrome Web Store API authentication and publisher identifiers](https://developer.chrome.com/docs/webstore/using-api)
- [GitHub: OpenVSX UUID false-positive filtering](https://github.blog/changelog/2026-11-05-secret-scanning-upgrades-detectors-adds-spacex-as-partner/)
- [OpenVSX: publishing uses a personal access token](https://github.com/eclipse-openvsx/openvsx/blob/main/cli/README.md)
