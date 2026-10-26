# DownloadHelper

A local-first Manifest V3 media downloader for Chromium browsers (Chrome, Edge, Brave and compatible browsers).

The project is being built from the architecture lessons of legacy native companion downloaders and modern browser-only media pipelines: **browser networking + OPFS + a dedicated media worker**, with no native OS bridge in the core product.

## Current working scope

- Detect direct video/audio requests from the page and network stack.
- Detect HLS (`.m3u8`) and DASH (`.mpd`) manifests.
- Download direct media with resumable HTTP Range support when the origin supports it.
- HLS VOD and live recording with segment retries through the browser network stack.
- HLS byte ranges, `EXT-X-MAP`, AES-128 keys/IVs and master-playlist best-variant selection.
- Common static DASH `SegmentTemplate` downloads; highest-bandwidth video/audio representations are exported.
- OPFS-backed writes through `FileSystemSyncAccessHandle`, so large downloads do not need to live in JS RAM.
- Captured Cookie/Origin/Referer context restored only through temporary exact-URL DNR rules.
- Job journal in `chrome.storage.local`; interrupted browser sessions are marked recoverable.
- Browser-native final export through `chrome.downloads`.

See [SECURITY.md](SECURITY.md) for trust boundaries and current limitations.

## Development install

```bash
npm test
npm run check
npm run build
```

Then open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/`.

## Always-current builds

Every push to `main` is tested and packaged by GitHub Actions. A rolling `nightly` release always points to the current `main` build and contains:

- `DownloadHelper.zip` — always produced.
- `DownloadHelper.crx` — produced when the repository signing secret is configured.
- `updates.xml` and `extension-id.txt` — produced with the signed CRX.

The pinned extension ID is `fbmgfeaacclomopchagckemhdbimfdhm`. The signing secret is `CRX_PRIVATE_KEY_B64`: the Base64 form of its matching persistent RSA private key. **Never commit the private key to this public repository.** Keeping the same key keeps the extension ID stable across updates. See [SIGNING.md](SIGNING.md).

## Chrome / Edge installation reality

Chrome on unmanaged Windows/macOS does not permit normal users to one-click install a self-hosted CRX. Chrome's supported direct-user distribution path is the Chrome Web Store; self-hosting is for managed environments. The repository still publishes CRX3 for testing/managed deployment and for browsers that allow it.

Microsoft Edge supports self-hosted extensions through enterprise policies. After the signing secret is configured and the rolling release contains `DownloadHelper.crx`, a **Windows administrator** can explicitly install the machine-wide Edge policy in three steps:

1. **Win + R** — open Windows Run.
2. **Ctrl + V** — paste the complete command below.
3. **Enter** — review and approve the Windows UAC prompt for the elevated installer.

```text
powershell.exe -NoExit -NoProfile -Command "$p=Join-Path $env:TEMP 'DownloadHelper-install-edge.ps1'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/ZTD38F/DownloadHelper/main/install/install-edge.ps1' -OutFile $p; Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList ('-NoProfile -File '+[char]34+$p+[char]34)"
```

**Administrator-only change:** This writes `HKLM\SOFTWARE\Policies\Microsoft\Edge\ExtensionInstallForcelist` to force-install the specified signed extension for managed Edge; approve the UAC prompt only if you intend this device-wide policy change. This is **not** a consumer/Chrome installer. The readable command downloads the public [source installer](https://github.com/ZTD38F/DownloadHelper/blob/main/install/install-edge.ps1) as a local `.ps1` and invokes a separate elevated PowerShell process. Enterprise execution-policy restrictions remain in force. A short Pages link may replace the GitHub source URL only after proven Cloudflare deployment and readback.

For true consumer one-click installation in both Chrome and Edge, publish the same built package to **Chrome Web Store** and **Microsoft Edge Add-ons**. The codebase is shared; store-specific packaging is not required for the core MV3 extension.

## Architecture

```text
Web page / media requests
          │
          ▼
MV3 service worker
  ├─ media detection
  ├─ request-header capture
  ├─ exact temporary DNR rules
  ├─ persistent job metadata
  └─ download/export orchestration
          │
          ▼
Offscreen document
          │
          ▼
Dedicated download worker
  ├─ Direct HTTP
  ├─ HLS
  ├─ DASH
  └─ OPFS sync writer
          │
          ▼
OPFS temporary file
          │ Blob URL
          ▼
chrome.downloads
          │
          ▼
Downloads folder
```

## Roadmap

1. Browser-side lossless muxing of separate DASH/HLS audio+video tracks.
2. Stronger journaled resume with manifest snapshots and per-track checkpoints.
3. Alternate HLS audio/subtitle groups and richer live-stream handling.
4. Site adapters isolated behind typed capabilities.
5. Sandboxed resolver VM only where a changing site algorithm makes it necessary, with strict CPU/memory limits.
6. Optional native processing engine only for heavy transcoding/GPU acceleration/arbitrary output paths.
7. Chrome Web Store and Edge Add-ons automated publication once store credentials are connected.
