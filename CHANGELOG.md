# Changelog

All notable changes to EmbedBay are documented in this file.
Release notes for each tagged build are automatically extracted from the matching version section below and included in both the GitHub Release and the in-app updater feed (`latest.json`).

## v0.1.3

### What's New
- **In-App Update Module:** Added an offline-first update check during the splash screen, a slim top workspace **Update Banner** with **What's New** / **Update Now** actions, indicator dots on **Settings** and **About**, and a **Command Palette (`Ctrl+K`)** update action.
- **Background Download & Restart Prompt:** Updates now download in the background (tracked in the bottom **Status Bar** Downloads popover) and prompt with **Install & Restart Now** or **Later** once finished.
- **Formatted Live Release Notes:** Fetches the live GitHub Release description and renders formatted Markdown (**What's New / Bug Fixes**) cleanly inside **Settings → About**, stripping web-only installer boilerplate.
- **Clickable Windows Tray Notifications:** When running in the background (`--minimized`), EmbedBay sends a native Windows toast notification once per new release; clicking it opens EmbedBay directly to **Settings → About**.

### Bug Fixes
- **Post-Update Relaunch:** Reopens the full EmbedBay window automatically after installing an update instead of staying minimized in the system tray.
- **Safe Database Shutdown on Update:** Gracefully stops running local vector database services before applying an in-app update.

## v0.1.2

### Bug Fixes
- **Launch on OS Startup (Windows):** Fixed an issue where EmbedBay failed to start minimized in the system tray after a reboot when Windows Explorer's taskbar was not yet ready. Tray initialization now retries in the background and falls back to opening the main window if the tray remains unavailable.
- **Autostart Path Refresh:** Re-registers the autostart entry on launch when enabled so it always points to the current executable with `--minimized` after upgrades or moves.

## v0.1.1

### What's New
- Added Engine Detail product views, downloadable engine progress tracking with pause/resume/stop, and Migrations page.
- Added full-page animated onboarding flow and engine last-used grace period.
- Fixed clearing instance group to Ungrouped and live-editing running instance metadata.
