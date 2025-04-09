# Technology Context: R2Uploader

## Core Technologies
- **Framework:** Electron (v31.0.1)
- **UI Framework/Library:** Next.js (v14.2.4) with React (v18.3.1)
- **Language:** TypeScript (v5.6.3)
- **Build Tool:** Nextron (v9.4.0) for integrating Next.js with Electron
- **Packaging:** electron-builder (v24.13.3)
- **Styling:** Tailwind CSS (v3.4.3) with `clsx`, `tailwind-merge`, `tailwindcss-animate`.

## Key Dependencies
- **UI Components:** Radix UI (`context-menu`, `dialog`, `scroll-area`, `select`, `slot`, `tooltip`), `lucide-react` (icons), `cmdk` (command palette)
- **State Management/Hooks:** `@uidotdev/usehooks`
- **Animation:** `@react-spring/web`, `motion`
- **Electron Utilities:** `electron-dl` (downloads), `electron-log` (logging), `electron-serve`, `electron-store` (persistent storage), `electron-updater` (auto-updates), `electron-util`
- **Networking:** `node-fetch` (v2.7.0)
- **Utilities:** `uuid`, `react-hot-toast` (notifications)

## Development Setup
- Uses `npm` for package management (based on `package-lock.json`).
- **Run Dev:** `npm run dev` (using `nextron`)
- **Build:** `npm run build` (using `nextron build`)
- **Build & Publish:** `npm run publish` (builds and uses `electron-builder` to publish to GitHub Releases)
- TypeScript is configured via `tsconfig.json` (targeting ES5, using ESNext modules).
- Post-install script (`electron-builder install-app-deps`) handles native dependencies.

## Technical Constraints/Notes
- Targets ES5 JavaScript for broader compatibility (from `tsconfig.json`).
- Builds distributables for macOS (arm64, x64 - dmg, zip) and Windows (exe - implied by `nextron build`).
- Uses ASAR packaging (`asar: true` in `electron-builder.yml`).
- Maximum compression is enabled for builds.
- GitHub Releases are used for distribution and auto-updates (`publish: provider: github`).
- Main process code likely in `app/` directory (`main: "app/background.js"` in `package.json`).
- Renderer process code likely in `renderer/` directory (standard Nextron structure).
- Shared code might be in `shared/`.
