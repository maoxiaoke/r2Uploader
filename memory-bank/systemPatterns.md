# System Patterns: R2Uploader

## Architecture Overview
This application follows a standard Electron architecture, utilizing Nextron to integrate Next.js for the renderer process.

- **Main Process:** Manages application lifecycle, window creation, native OS interactions, and potentially sensitive operations like credential handling and direct Cloudflare R2 API interaction. Entry point appears to be `app/background.js`.
- **Renderer Process:** Responsible for rendering the User Interface (UI) using Next.js and React. Handles user interactions and displays data. Code resides primarily in the `renderer/` directory.
- **Inter-Process Communication (IPC):** Electron's built-in IPC (`ipcMain`/`ipcRenderer`) is assumed to be the primary mechanism for communication between the main and renderer processes. The renderer likely requests actions (e.g., list buckets, upload file) from the main process via IPC.

## Key Technical Decisions & Patterns
- **Electron + Next.js:** Leveraging Nextron combines the power of Electron for desktop app capabilities with the modern web development experience of Next.js/React for the UI.
- **TypeScript:** Used for enhanced code quality and maintainability.
- **Tailwind CSS:** Utility-first CSS framework for styling the UI.
- **Component-Based UI:** Using React and potentially Radix UI components promotes modularity and reusability.
- **Local Persistent Storage:** `electron-store` is used for saving configuration, likely including API credentials (should be stored securely) and user preferences.
- **GitHub for Updates/Distribution:** `electron-builder` and `electron-updater` are configured to use GitHub Releases for packaging, distribution, and automatic updates.
- **R2 API Interaction:** Likely performed in the main process for security, using `node-fetch` to communicate with the Cloudflare R2 API.

## Component Relationships (Hypothesized)
- `renderer/` (Next.js/React UI) <--> IPC <--> `app/background.js` (Main Process Logic, API Calls, Native Features)
- `app/background.js` --> `electron-store` (Load/Save Config)
- `app/background.js` --> Cloudflare R2 API (via `node-fetch`)
- `renderer/` UI Components --> Radix UI / `lucide-react`

## Critical Implementation Paths
- Secure handling and storage of Cloudflare API credentials using `electron-store`.
- Implementation of R2 API calls (List Buckets, List Objects, Upload Object, Delete Object, Get Object Info) likely within the main process.
- Efficient IPC communication design between main and renderer processes.
- State management within the React application (renderer process).
- Implementation of the Masonry layout for object browsing.
- Handling file uploads, including progress indication and overwrite prevention.
- Custom domain link generation.
- Auto-update mechanism integration.

*(Note: This is based on configuration files and standard Electron/Nextron patterns. Analysis of source code in `app/`, `renderer/`, and `shared/` is needed for confirmation and further detail.)*
