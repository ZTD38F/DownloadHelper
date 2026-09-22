# Security model

DownloadHelper is intentionally **local-first**. Media bytes are downloaded by the browser extension, processed in a dedicated worker, staged in Origin Private File System (OPFS), and exported through the browser download manager.

## Security boundaries

- No native helper is required for the core downloader.
- No server receives browser cookies or media by default.
- No `eval`, Node.js, shell execution, arbitrary filesystem RPC, or arbitrary process spawning exists.
- Captured authentication headers are kept in `chrome.storage.session`, not persistent storage.
- Temporary DNR header rules are exact-URL, short-lived rules and are removed after the corresponding request.
- Long-running media work executes in a Dedicated Worker; the MV3 service worker remains the privileged orchestrator.
- OPFS files are isolated to the extension origin and removed after browser export completes.

## Known limitations in 0.1.x

- HLS supports common VOD/live playlists, byte ranges, init maps and AES-128. Complex alternate audio/subtitle groups are not yet muxed.
- DASH supports common static `SegmentTemplate` MPDs. Separate video/audio tracks are currently exported separately rather than muxed.
- DRM-protected streams are outside the downloader scope.
- Full video transcoding is intentionally not part of the browser core.

Please report security issues privately rather than publishing exploit details in a public issue.
