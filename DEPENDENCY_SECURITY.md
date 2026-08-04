# Dependency security baseline

Last reviewed: 2026-08-04

## Repeatable check

```bash
npm ci
npm run audit:prod
```

Expected production result at this revision: **0 low, 0 moderate, 0 high, 0 critical**.

## Runtime boundaries

- Electron main process: AWS S3 SDK, `node-fetch`, `electron-updater`, and `zod`.
- Preload: Electron APIs plus the fixed channel contract only.
- Renderer: React and `@openai/apps-sdk-ui`; no Node integration.
- Build/test-only packages are kept in `devDependencies` and evaluated separately from shipped runtime reachability.

## Decisions

- Removed the previous Radix/shadcn, Ant Design, `electron-dl`, animation, masonry, and helper dependency set after the renderer migration. Those packages were no longer reachable but still inflated the production audit surface.
- Replaced `electron-store` with a small atomic window-state file because its older `conf` chain pinned vulnerable AJV/fast-uri versions.
- Upgraded `electron-updater` to a release containing the redirect credential-leak fix.
- `@openai/apps-sdk-ui@0.2.2` pins an older lodash. The root override selects lodash 4.18.1, which is API-compatible with the package's lodash 4 usage and clears the published advisories. The UI build and component smoke tests must run whenever this override changes.
- New high or critical production advisories fail CI. A temporary exception requires the advisory, reachable code path, mitigation, owner, and removal date in this file.
