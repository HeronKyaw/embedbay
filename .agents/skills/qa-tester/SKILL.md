---
name: qa-tester
description: >-
  Autonomous QA Engineer workflow for EmbedBay. Runs backend Rust tests,
  frontend Vitest + mockIPC UI tests, IPC contract verification, live browser
  visual QA across all menus/modals, and Windows release artifact checks, then
  outputs a structured QA Report.
---

# EmbedBay QA Tester Agent

Use this skill whenever asked to test EmbedBay thoroughly across every menu, modal, and backend function (for example before or after a release).

## 1. Automated Verification Suite

Run all automated checks first and capture exact pass/fail counts:

```powershell
# 1. Backend Rust unit & integration tests (adapters, DB, supervisor, analytics, commands)
cargo test --manifest-path backend/Cargo.toml

# 2. Frontend UI, store, and IPC contract tests (Vitest + React Testing Library + mockIPC)
npm --prefix frontend test

# 3. Frontend TypeScript + Vite production bundle check
npm --prefix frontend run build

# 4. Real Windows desktop E2E suite (tauri-driver + msedgedriver + webdriverio on embedbay.exe)
# Requires building debug exe first: Push-Location backend; ..\node_modules\.bin\tauri.cmd build --debug --no-bundle; Pop-Location
npm run e2e

# 5. Windows release artifact check (run when release installers exist)
powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1
```

## 2. Live Browser Visual QA (Vite + `browser` Subagent)

To visually inspect every menu, modal, and theme in a real browser:

1. Start the Vite dev server as a background daemon (`BypassSandbox: true`, `IsDaemon: true`):
   ```powershell
   npm --prefix frontend run dev
   ```
2. Delegate a visual QA pass to the `browser` subagent (`Model: "flash"`) targeting `http://localhost:5173`:
   - Check the browser console for any JS/React errors or unhandled promise rejections.
   - Complete or dismiss the **Onboarding** wizard if shown.
   - Click through every **Activity Rail** section:
     - **Explorer**: verify local/remote connection cards, search/tag filters, **Add Connection**, **Create Group**, **Tag Manager**, collection CRUD/Upsert/Indexes/Import-Export/Migrate modals, **Search Playground** (empty query, raw vector JSON, presets, history), and **Embedding Visualizer** (2D/3D, PCA/UMAP).
     - **Local Runtimes**: verify **New Instance** modal (including **Open Store** jump to Engine Detail page for uninstalled engines), instance cards, resource meters, and action buttons.
     - **Engine Store**: verify catalog cards, **Refresh Catalog** spinner + toast, **Engine Detail** product page + **Back to Engine Store** / Mouse Back navigation, and **persistent download tracker** in StatusBar (survives page switches, supports **Pause / Resume / Stop**).
   - Open **Command Palette** (`Ctrl+K` or titlebar search bar), type a query, verify results, and close.
   - Open **Settings** (`Ctrl+,` or Activity Rail Settings button), visit all 5 tabs (**General**, **Embeddings**, **Storage**, **Diagnostics**, **About**), and toggle **Light** and **Dark** themes to verify contrast, layout, and zero clipping/overflow.
3. **Stop the Vite daemon** using `manage_task` (`Action: "kill"`) as soon as the `browser` subagent finishes.

## 3. Windows-Native Manual Checklist (Cannot Run Headlessly)

Always include these items in the final QA Report when testing a release build on Windows:
- **Real Engine Binaries**: Download & start at least one native daemon (`Qdrant` or `Chroma`), one embedded engine (`SQLite + sqlite-vec` or `LanceDB`), and one SQL portable engine (`PostgreSQL + pgvector`). Confirm zero console window flashes (`CREATE_NO_WINDOW`).
- **Windows Credential Manager**: Verify remote connection & embedding API keys are stored under `com.embedbay.app` and absent from `app.db`.
- **System Tray & Single Instance**: Enable *Minimize to System Tray*, close window, verify WebView2 exits while `embedbay.exe` + DBs stay running; test *Open EmbedBay*, *Stop Idle Services*, *Stop All Running Services*, *Quit EmbedBay*.
- **NSIS & MSI Installers**: Run per-user NSIS install, verify Autostart registry key (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` -> `EmbedBay --minimized`), silent MSI install (`/qn`), and uninstall keep-data prompt.

## 4. QA Report Format

Present findings with:
1. **Executive Summary** (Go / No-Go / Conditional Go for release)
2. **Automated Test Results** (exact command, test counts, duration)
3. **Live Browser Visual QA Results** (menus/modals checked, theme checks, console errors)
4. **Menu & Feature Coverage Matrix** (Pass / Mocked / Manual Windows)
5. **Bugs, Warnings & UX Observations** (with file paths and reproduction steps)
