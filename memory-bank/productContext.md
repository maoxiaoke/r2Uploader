# Product Context: R2Uploader

## Problem Solved
Interacting with Cloudflare R2 storage often requires technical knowledge (CLI) or navigating the potentially complex Cloudflare dashboard. This presents a barrier for non-technical users or those seeking a more streamlined workflow for managing R2 assets.

## Solution
R2Uploader provides a dedicated, intuitive Graphical User Interface (GUI) specifically for Cloudflare R2. It simplifies common tasks like uploading, browsing, searching, and managing objects.

## User Experience Goals
- **Simplicity:** The UI should be clean, intuitive, and easy to navigate, even for users unfamiliar with cloud storage concepts.
- **Convenience:** Common R2 operations should be easily accessible (e.g., via "Super Right-Click").
- **Visual Appeal:** The Masonry layout for browsing objects enhances visual understanding and interaction.
- **Efficiency:** Features like prefix search, folder navigation, and smart overwrite prevention should streamline workflows.
- **Trust:** Clear communication about local credential storage and licensing.

## How it Should Work (User Flow - High Level)
1. User launches the app.
2. User provides Cloudflare Account ID and R2 API Token (with necessary permissions).
3. App connects to R2 and displays buckets/objects.
4. User can browse objects (visual layout), navigate folders.
5. User can upload new objects (drag-and-drop or file selection).
6. User can search for objects.
7. User can right-click objects for management options (delete, copy link, export, etc.).
8. App handles custom domain configuration for shareable links.
9. App notifies user of available updates.
