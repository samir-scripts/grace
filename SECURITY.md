# Security

## Verify direct downloads

Release automation requires a verified detached Tauri/Minisign signature (`.sig`) for every published desktop package. Releases include `grace-updater.pub`, the decoded public verification key, and `SHA256SUMS`. Checksums detect changed bytes; verify the signature before installing.

Obtain the package, its matching `.sig`, and `grace-updater.pub` from the same versioned Grace release. Compare the public key with the updater key in `src-tauri/tauri.conf.json` at that release's source revision; that configuration stores the same key as base64-encoded text. The public-key fingerprint is recorded in the release plan.

Tauri wraps its Minisign signature text in base64. With Python 3 and [Minisign](https://jedisct1.github.io/minisign/) installed, replace `PACKAGE` with the downloaded filename:

```sh
python3 -c "import base64; from pathlib import Path; Path('PACKAGE.minisig').write_bytes(base64.b64decode(Path('PACKAGE.sig').read_bytes().strip(), validate=True))"
minisign -Vm PACKAGE -p grace-updater.pub -x PACKAGE.minisig
```

A successful verification authenticates the exact package bytes against that public key. Missing, invalid, or mismatched signatures must stop installation. Do not treat a checksum alone as publisher authentication.

These detached signatures are distinct from Windows Authenticode, Apple Developer ID signing/notarization, and Linux repository signing. They do not establish operating-system publisher trust or prove native runtime acceptance. Windows x64 and Ubuntu x64 beta blocking and recovery remain unverified / deferred to contributors.

### Optional GPG signatures

A release may additionally include ASCII-armored GPG signatures (`.asc`) when a maintainer has configured that separate key. They are optional and do not replace the required `.sig` files. Verify any GPG key's fingerprint through a trusted maintainer source before importing it, then use `gpg --verify PACKAGE.asc PACKAGE`.

APT/RPM repository, Flatpak, Snap, and AUR signing are separate distribution mechanisms; direct-download signatures do not establish those channels.

## Maintainer key handling

Keep private signing material in an owner-readable ignored file or a secure secret store. Configure `TAURI_SIGNING_PRIVATE_KEY` and, if applicable, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in GitHub Actions. Transfer values through secure input rather than command-line arguments; never commit or print them. The public updater key belongs in `src-tauri/tauri.conf.json`.

Before publication, the release job signs packages without changing their bytes, verifies every detached signature against the configured public key, and includes the public key and signature hashes in the release checksums. Existing signatures are verified rather than silently replaced. Stable publication additionally requires exact-source, exact-package, independently reviewed platform acceptance.

### Grace signing identity transition

The original updater public key was inherited from upstream Pomotroid. Grace's owner approved a new signing identity for `1.7.2-beta.1`. Existing installations using the inherited key need a manually downloaded installer before they can accept future Grace-key-signed updates. The beta does not publish or modify a stable updater feed. There is no unsigned-update fallback.

Back up the private key through an owner-controlled secure store. A future key change requires an explicit trust transition; changing only the public key in new source does not authorize updates for already installed clients.
