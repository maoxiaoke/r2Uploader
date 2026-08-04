# R2Uploader

R2Uploader is a private-first desktop asset manager for Cloudflare R2 and compatible S3 object storage. It runs on macOS and Windows, browses private buckets through authenticated APIs, and never enables public access merely because a bucket was opened.

Version 2.0 is a product and security rebuild. The renderer uses the real `@openai/apps-sdk-ui` component library, typography, semantic color tokens, and icons; secrets and cloud access remain isolated in the Electron main process.

## What users can do

### Browse and organize

- Browse private buckets without an `r2.dev` or custom domain.
- Switch between grid and list views, sort and filter objects, search the current folder, or run a contains search across the whole bucket.
- Navigate with breadcrumbs, favorites, recent locations, keyboard controls, range selection, and box selection.
- Create persistent empty folders, upload folders recursively, and move, copy, rename, or Trash complete prefixes through background tasks. Internal folder markers stay hidden during normal browsing.
- Preview images, video, audio, PDF, and text through an authenticated, five-minute local preview grant.
- Inspect and edit HTTP metadata, `Cache-Control`, and custom metadata when S3 credentials are available.
- Maintain a local asset index with checksums, dimensions, duration, tags, and descriptions.

### Transfer safely

- Stage files before upload and preview image conversion, naming, target keys, duplicates, and sizes.
- Resolve destination conflicts with skip, overwrite, automatic rename, or a decision applied to all files.
- See uploads, downloads, server-side copies, moves, and expanded folder operations in one persistent Transfer Center, including aggregate and per-item status, source, destination, progress, speed, remaining time, bounded concurrency, pause, cancel, and retry where the underlying operation can safely stop.
- Use multipart upload for large files. R2 REST-only profiles require S3 credentials above 300 MB.
- Verify remote size after upload and local size after download before reporting completion.
- Open a completed download with the operating system or reveal its validated destination in the file manager directly from the Transfer Center.
- Recover from interrupted app sessions: unfinished transfers reopen paused instead of being reported as complete.
- Use recoverable Trash by default. Permanent deletion is separate and requires explicit confirmation.
- Rename and move by copy, remote verification, source deletion, and a persistent recovery journal. A failed source deletion is reported as partial success, with both objects preserved.

### Share without confusing access levels

- See whether a bucket is private, public through `r2.dev`, or public through a custom domain.
- Create temporary bearer links with an exact expiry when S3 credentials are configured.
- Copy permanent public URLs only from an explicitly enabled domain whose reported ownership and SSL state are ready, with a per-bucket default domain.
- Attach a custom domain in a disabled state, refresh ownership/SSL state, explicitly enable or disable it, and remove it from the bucket. Pending domains never generate links.
- Export multi-object link manifests as plain text, Markdown, HTML, JSON, or CSV while preserving successful selection order.
- Enable or disable the managed public domain only through an explicit warning and confirmation flow.

### Automate personal workflows

- Quick Upload a clipboard image with `⌘/Ctrl + Shift + U`, or choose files from the tray menu; the resulting link is copied after verified upload.
- Create upload-only local directory sync tasks with preview, exclusions, pause/resume, and conflict policies.
- Create manual, daily, or weekly local backup tasks. Each snapshot includes a manifest and SHA-256 hashes; restore verifies every selected file against the manifest before queueing it to its original key, a selected key/prefix, or a new destination prefix.
- Create post-upload rules for copying to another location, copying a temporary or public link, and desktop notification. Completed actions and failures are journaled, visible in the rule panel, and checkpointed to avoid duplicate execution.
- Refresh open buckets through a dedicated Cloudflare Queue, with visible polling fallback when event delivery is unavailable.
- Temporarily expose one private prefix to another device on the trusted local network through an expiring, read-only HTTPS companion session.
- Send files from a CLI or plugin through the `r2uploader://` protocol. The desktop app always asks for confirmation before reading the paths or queueing an upload.

### Understand usage and policy

- View Cloudflare analytics samples, operation counts, storage, free-tier progress, and a clearly dated cost estimate linked to the pricing source.
- Manage lifecycle and CORS rules through editable JSON with confirmation.
- Check custom-domain DNS, TLS, and HTTP health without changing the domain.
- Export a redacted diagnostic bundle after previewing its contents.
- Inspect profile-scoped local operation history, export it, clear it, and run supported safe recovery actions. Records are retained for at most 90 days or 2,000 entries.

## Connections and credentials

A Cloudflare R2 connection can contain two credential types:

1. **Cloudflare API Token** — bucket administration, domain state, analytics, lifecycle, CORS, event notifications, and R2 REST object operations. Use the narrowest permissions that fit the workflow.
2. **R2 S3 Access Key ID + Secret Access Key** — multipart upload, presigned temporary links, metadata replacement, and efficient server-side copy.

An S3-compatible connection uses an HTTPS endpoint, region, access key, secret key, and optional path-style addressing. It supports private bucket/object workflows, transfer management, search, sync, backups, and local indexing. Cloudflare-specific domains, analytics, lifecycle, CORS, and Queue event configuration are intentionally unavailable for generic S3 providers.

Credentials are encrypted with Electron `safeStorage`, backed by the signed-in user's operating-system credential protection. Secrets are decrypted only in the main process and never returned to renderer state. Old plaintext `~/r2uploader/r2uploader.json` credentials are migrated on first launch and removed from that file.

Official setup references:

- [Cloudflare R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/)
- [Cloudflare R2 S3 credentials](https://developers.cloudflare.com/r2/get-started/s3/)

The connection test separately reports credential-vault availability, authentication, bucket listing, object read, optional reversible write/cleanup, and multipart/temporary-link readiness. The write check uses a dedicated temporary key and attempts cleanup immediately.

## Optional OpenAI asset intelligence

AI indexing is off by default and never runs automatically. After the user enables it and stores an OpenAI API key, each image still requires an explicit **Analyze** confirmation.

For an analysis request, R2Uploader privately downloads the selected PNG, JPEG, WebP, or non-animated GIF, rotates and resizes it to fit within 1568 × 1568, converts it to a quality-78 JPEG, and sends only that derivative to the OpenAI Responses API. The request uses `store: false` and a strict JSON schema for tags and description. Semantic search sends the query text to the Embeddings API, then performs cosine ranking against vectors stored locally. API usage may incur charges from OpenAI.

The OpenAI API key is encrypted in the main-process vault. **Remove key & AI data** disables the feature and removes all locally stored AI descriptions and vectors while preserving manual tags.

## Local data and recovery boundaries

- App configuration, encrypted profiles, journals, history, indexes, task definitions, and transfer state live below Electron's per-user application data directory.
- The preview cache is size-bounded, ETag-validated, and clearable. Prefixes explicitly pinned for offline use may serve a stale cached copy only when the authenticated remote check is unavailable; the response is marked as offline cache data.
- Sync is deliberately upload-only. It never deletes local or remote files.
- Folder intake skips `.DS_Store` and symbolic links, keeps other dotfiles, and cannot represent empty local directories. A dropped directory keeps its top-level folder name; the folder chooser uploads its contents.
- A backup snapshot is promoted as the latest restorable snapshot only when every listed object has downloaded and verified. Partial attempts do not prune the previous complete snapshot.
- Trash is an R2 prefix convention, not provider-side object versioning. Permanently deleting an object from Trash is irreversible unless another backup or provider feature exists.
- The Web/mobile companion uses an ephemeral self-signed certificate and a 256-bit one-time URL token. Browsers will show a certificate warning; compare the displayed fingerprint and use it only on a trusted local network. The session expires after 5–120 minutes and stops when the app exits.

## Keyboard and quick access

- `⌘/Ctrl + Shift + U` — Quick Upload the clipboard image.
- `⌘/Ctrl + Shift + X` — show or hide the desktop window.
- `⌘/Ctrl + ,` — open Settings.
- `⌘/Ctrl + J` — open the Transfer Center.
- `⌘/Ctrl + R` — refresh the current bucket.
- `⌘/Ctrl + A` — select visible objects.
- `Shift + click` — select a range.
- `Enter` — open the focused object.
- `Space` — toggle selection for the focused object.
- `Escape` — close the active dialog or clear selection.

All core actions remain reachable through normal keyboard focus. Dialogs trap focus, close with Escape, and restore the previous focus. Reduced motion follows the app preference.

## CLI and protocol integration

From a source checkout:

```bash
node cli/r2uploader-cli.mjs --help
node cli/r2uploader-cli.mjs upload ./asset.png --bucket my-assets --prefix incoming
```

For local development, `npm link` exposes the package's `r2uploader` bin. Packaged desktop builds include the CLI source under the app resources, but do not silently modify the user's `PATH`; an installer or plugin can invoke the registered `r2uploader://upload?v=1&client=your-client-id` protocol directly. Requests without the supported version are rejected.

The CLI does not receive cloud credentials. It resolves existing local files, asks the operating system to open R2Uploader, and the app displays the protocol version, caller identity, exact target, and paths for approval. Profile and bucket options are requests, not authority to bypass the confirmation. There is no persistent caller authorization to revoke: every external request must be approved independently.

## Encrypted portable settings

Profiles, preferences, favorites, naming presets, sync tasks, backup tasks, and automation rules can be exported without credentials or, after a second warning, with API, S3, and OpenAI credentials. The portable file uses AES-256-GCM with a random salt and IV; its key is derived with scrypt (`N=32768`, `r=8`, `p=1`). The recovery passphrase is never stored. Import supports explicit merge and replace modes; matching IDs are reported, a non-secret merge preserves credentials already stored on the receiving device, and all imported tasks and automations start paused until their local paths and effects are reviewed.

This is user-controlled, manual end-to-end encrypted sync rather than a hosted R2Uploader account service: place the ciphertext in an iCloud Drive, Dropbox, OneDrive, or similar folder if desired. To revoke an old device from decrypting future generations, export with a new passphrase and replace the old file. This does not remotely erase settings or revoke cloud credentials already imported by that device; revoke those credentials at their provider when needed.

Treat an export that includes credentials like a password vault: choose a unique recovery passphrase, keep a separate recovery copy, and remove obsolete ciphertext generations.

## Download and updates

Use the [latest GitHub release](https://github.com/maoxiaoke/r2Uploader/releases/latest). A single tag is configured to publish versioned artifacts from the same commit:

- macOS Apple Silicon DMG and ZIP
- macOS Intel DMG and ZIP
- Windows x64 NSIS installer

The release workflow rejects a tag that does not match `package.json`, requires signing secrets, requires macOS notarization credentials, and publishes artifacts named with product, version, OS, and architecture. The app checks that same GitHub channel for updates and retains the release page as a manual fallback.

These guarantees apply to artifacts produced by the configured release workflow. A local unsigned build is suitable for development but is not evidence of platform signing or notarization.

## Development

Requirements: Node.js 22, npm, and the platform toolchain required by Electron Builder.

```bash
npm ci
npm run verify
npm run dev
```

Build the renderer and Electron main process:

```bash
npm run build
```

Create local unsigned packages:

```bash
npm run package
```

Run the production dependency audit:

```bash
npm run audit:prod
```

Release publishing is tag-driven through [`.github/workflows/release.yml`](./.github/workflows/release.yml). Set `RELEASE_BUILD=true` only in an environment that supplies the macOS or Windows signing credentials required by [`electron-builder.config.cjs`](./electron-builder.config.cjs).

## Product scope and verification

- [Detailed 58-requirement specification](./R2UPLOADER_REQUIREMENTS_DETAIL.md)
- [Code-to-requirement traceability and remaining live acceptance](./docs/REQUIREMENTS_TRACEABILITY.md)
- [Production dependency security decisions](./DEPENDENCY_SECURITY.md)

Team workspaces, member management, RBAC, and team audit are explicitly outside this product scope. The implemented roadmap is for an individual asset-management workflow.

## License and pricing

The source code and self-built application are licensed under [GPL-3.0](./LICENSE.txt). Core R2 management is free and has no activation gate.

Official signed binaries, automatic-update distribution, or support may be offered separately in the future, but they must not change the GPL rights of the source or silently disable the free core. Any future paid offering must be documented before it is enforced.

## Security model

- The sandboxed renderer has no Node integration and cannot request arbitrary IPC channels.
- Every IPC command has an explicit preload method and a Zod-validated payload.
- File and directory operations use paths selected or explicitly confirmed by the user.
- External navigation is HTTPS-only and host-allowlisted; new windows and webviews are denied.
- The production renderer uses a restrictive Content Security Policy.
- Private previews use opaque, single-purpose, five-minute local grants.
- Diagnostic bundles are bounded and redacted; they omit credentials, full object identities, and custom domains. Operation-history exports are separate, stay local until explicitly exported, and contain full bucket names and object keys so recovery remains actionable.
- Production dependencies are audited in CI. Exceptions must be recorded in [DEPENDENCY_SECURITY.md](./DEPENDENCY_SECURITY.md).
