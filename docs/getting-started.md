# Getting Started with EmbedBay

This guide walks through installing EmbedBay on Windows and using its core workflows.

---

## 1. Installing on Windows

EmbedBay ships in two standard Windows installer formats:

| Installer | Filename | Recommended For |
| --- | --- | --- |
| **NSIS Setup (`.exe`)** | `EmbedBay_0.1.2_x64-setup.exe` | Individual developers. Installs per-user (`currentUser`, no UAC elevation required), supports upgrading over an existing running tray instance, and prompts on uninstall before removing local database files. |
| **WiX Installer (`.msi`)** | `EmbedBay_0.1.2_x64_en-US.msi` | Enterprise / scripted deployments (`msiexec /i EmbedBay_0.1.2_x64_en-US.msi /qn`), stable in-place upgrades via fixed WiX UpgradeCode, and Group Policy distribution. |

> **Windows SmartScreen Note:** Public community installers are currently unsigned. If Windows SmartScreen warns on first launch, click **More info → Run anyway** after checking the SHA-256 digest from the GitHub Release.

> **WebView2 Note:** EmbedBay configures `downloadBootstrapper` in `backend/tauri.conf.json`. Windows 11 includes WebView2 out of the box; Windows 10 machines without WebView2 fetch the lightweight runtime automatically during installation.

---

## 2. Installing a Local Engine & Creating an Instance

1. Open **Engine Store** (`store` in the left Activity Rail) and click any engine card to open its product page (or click **Install** directly to pick a version).
2. Choose **Qdrant**, **Chroma**, **PostgreSQL + pgvector**, or **LanceDB (Embedded)** and confirm the version:
   - Binary downloads stream directly into `%LOCALAPPDATA%\com.embedbay.app\bin\<engine>\<version>\` and are verified against SHA-256 checksums from `manifests/engines.json`.
   - Active downloads remain tracked in the bottom **StatusBar** (`Downloads` popover) even when switching pages, with **Pause**, **Resume**, and **Stop** controls.
   - **LanceDB (Embedded)** requires no download or background daemon; clicking **Enable Runtime** registers the built-in zero-RAM reader immediately.
3. Click **Create Instance** (or switch to **Runtimes** -> **New Instance**):
   - Give the instance a name, optional Group & color-coded Tags, host/port (EmbedBay automatically checks for port conflicts and suggests free ports), custom config overrides, boot **Auto-Start**, and an optional **Idle Auto-Stop** timeout in minutes.
4. Click **Start** in **Runtimes** or the sidebar. Watch live stdout/stderr logs in the **Log Viewer** and live RAM/CPU telemetry badges.

---

## 3. Groups, Tags, and System Tray Persistence

- **Groups:** Create collapsible workspace folders (e.g., `Dev RAG`, `Prod Staging`) and use bulk **Start Group** / **Stop Group** actions.
- **Tags:** Assign color-coded pills from the 8 preset swatches and click tags in the top filter bar for instant sidebar filtering.
- **System Tray & Autostart:**
  - Closing the main window (`X`) destroys the WebView2 UI process to reclaim frontend memory while all managed databases keep running in the System Tray.
  - Enable **Autostart: Enabled** under **Settings** to launch `EmbedBay.exe --minimized` quietly into the tray on Windows sign-in.
  - Press `Ctrl+K` anywhere in the UI to open the **Command Palette** for fast navigation across views and connections.

---

## 4. Exploring Data & Running Semantic Search

1. Click any running local instance (or open `.lance` folder / saved Remote Connection) to load it into **Explorer**.
2. Open multiple collections as parallel browser-like tabs:
   - Inspect schemas, vector dimensions, distance metrics, and segment/disk stats in the Collection Header.
   - Scroll large collections cleanly in the virtualized table and inspect full nested metadata + vector slices in the right-hand JSON Drawer.
   - Create, edit, or delete collections and individual vector records using the CRUD modals.
3. Switch to the **Search Playground** tab inside any collection:
   - Paste raw float vectors, trigger **Find Similar** directly from any table row, or select an **Embedding Profile** (**Ollama** or **OpenAI-compatible** configured in **Settings**) to run plain-text semantic queries.
   - Combine queries with the visual Metadata Filter Builder (`AND` / `OR` operators) or switch to raw JSON filter mode.

---

## 5. Visualizing, Migrating, Snippets & Backing Up

- **2D / 3D Embedding Visualizer:** Open the Visualizer tab to project collection vectors onto 2D or 3D interactive WebGL scatter plots using **PCA** or **UMAP**, colored by metadata fields with hover/click inspection.
- **Cross-Engine Migrations:** Open **Migrations** in the left sidebar (or click **Migrate** inside a collection) to copy, filter, or re-embed collections between any two ready local or remote databases.
- **Code Snippets:** Copy syntax-highlighted **Python**, **TypeScript**, **C# (.NET)**, **cURL**, or **SQL** snippets from any instance card or Search Playground.
- **Import / Export:** Bulk-import `.jsonl` or `.csv` files (optionally generating embeddings in batches using a configured Embedding Profile) or export browse/search results.
- **Instance Backup & Restore:** In **Runtimes**, click **Backup** to safely pause/stop any active daemon first, archive its data directory into a `.zip`, and restore later with Zip-Slip path validation and rollback protection.

---

## 6. Storage Cleanup & App Updates

- **Storage & Engine Cleanup:** Open **Settings** (or check the banner in **Engine Store**) to inspect disk usage per engine version and remove downloaded engine versions that are no longer referenced by any instance.
- **Idle Auto-Stop:** Configure `idle_timeout_minutes` per instance so unused local daemons stop automatically after inactivity.
- **Application Updates:** Click **Check for Updates** in **Settings -> Application Updates** to check GitHub Releases and install cryptographically signed updates in place without touching `%LOCALAPPDATA%\com.embedbay.app` instance data.
