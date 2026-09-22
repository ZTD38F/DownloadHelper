# CRX signing

The extension ID is pinned to:

```text
fbmgfeaacclomopchagckemhdbimfdhm
```

The matching **public** key is embedded in `extension/manifest.json`. The RSA private key must never be committed.

GitHub Actions expects one repository secret:

```text
CRX_PRIVATE_KEY_B64
```

Set it to the Base64 encoding of the PEM private key that matches the manifest public key. After the secret is configured, run **CI and rolling build** once (or push to `main`). The rolling `nightly` release will then contain:

- `DownloadHelper.crx`
- `DownloadHelper.zip`
- `updates.xml`
- `extension-id.txt`

The workflow verifies that the private signing key derives the pinned extension ID before publishing. A different key fails the build instead of silently changing the extension identity.

## Packer

CRX3 packaging is implemented in `scripts/pack-crx3.mjs` using only Node.js built-in `node:crypto`. It follows Chromium's CRX3 protobuf/header/signature format and performs an internal RSA-SHA256 verification before writing the package. CI smoke-tests this packer with an ephemeral key on every run, independently of the production signing secret.
