# EmbedBay — Local Vector DB Manager & Explorer (Architecture & Implementation Plan)

> **Purpose:** Blueprint for building **EmbedBay**, a standalone, Docker-free desktop application that combines a [VectorDBZ](https://github.com/vectordbz/vectordbz)-style visual vector database explorer with a native local runtime manager (one-click install, multi-instance orchestration, low-RAM background execution, and automatic startup on OS boot).
>
> **Platform Rollout Priority:** **1. Windows (Primary MVP & V1 — `.exe` NSIS & `.msi` Installers)** → **2. macOS (Priority 2 — Universal `.dmg`)** → **3. Linux (Priority 3 — `.AppImage` / `.deb` / `.rpm`)**. Core architecture isolates OS-specific code behind a platform abstraction layer from Day 1 so macOS and Linux ship cleanly without rewriting core logic.
>
> **Target Audience:** AI coding agents and developers implementing the application end to end.

## 1. Product Vision & Core Constraints

* **Zero Docker Dependency:** Download, verify, install, and run vector database engines natively without Docker Desktop, Hyper-V, or heavy VM overhead.
* **Minimal RAM Footprint:** Avoid Electron's bundled Chromium/Node.js overhead, destroy the UI WebView when closed to the System Tray / Menu Bar so only the lightweight Rust supervisor remains resident, and allow per-instance auto-start and optional idle-sleep policies.
* **Distinct, Modern Desktop UX:** Clean, keyboard-first developer workspace with a custom **EmbedBay** identity (inspired by Linear, Raycast, and TablePlus rather than cloning [VectorDBZ](https://github.com/vectordbz/vectordbz)), featuring multi-tabbed browsing, custom connection names, collapsible groups, and color-coded tags.
* **Seamless Local + Remote Workflow:** Auto-register every locally managed database instance directly into the visual explorer, while also supporting external/cloud connections.
* **Windows-First, Cross-Platform-Ready Reliability:** Ship a rock-solid Windows experience first (native `.msi` and `.exe` installers, boot auto-start, silent background processes, graceful shutdown), while isolating OS-specific paths, signals, and packaging behind Rust `#[cfg(target_os = "...")]` modules for clean macOS and Linux expansion.

## 2. Recommended Tech Stack

| Layer | Technology | Rationale |
| ----- | ----- | ----- |
| **Desktop Framework** | **Tauri v2** (Rust + OS Native WebView) | Uses native WebView2 (Windows), WKWebView (macOS), and WebKitGTK (Linux) instead of shipping Chromium. Destroying the WebView on close keeps the idle tray supervisor at minimal RAM. |
| **Backend / Supervisor** | **Rust** (`tokio`, `reqwest`, `sha2`, `zip`, `flate2`/`tar`, `sysinfo`, `keyring`) | Native process management, low memory footprint, `.zip` (Windows) + `.tar.gz` (macOS/Linux) extraction, and cross-platform OS secret storage (`keyring`). |
| **Local Metadata Store** | **SQLite** (`rusqlite` or `sqlx`) | Stores installed engine versions, instance configs, groups, tags, port allocations, remote connection profiles, and saved queries in a single portable local file. |
| **Frontend UI** | **React 19 + TypeScript + Vite** (with React Compiler) | Mature component ecosystem, strong typing for complex DB schemas, automatic memoization via React Compiler, and highest code-generation reliability with AI coding agents. *(Optional alternative: **Svelte 5** if you prefer a slightly smaller bundle and fine-grained runes.)* |
| **Styling & Components** | **Tailwind CSS v4 + shadcn/ui + Lucide Icons** | Crisp, high-contrast dark/light developer-tool aesthetic with full keyboard accessibility (`cmdk` for `Ctrl+K` / `Cmd+K` Command Palette). |
| **Data Grids & Charts** | **TanStack Table + TanStack Virtual** | Smooth virtualized rendering of collections with thousands of vector records and nested JSON metadata. |
| **2D/3D Embedding Plot** | **Plotly.js (WebGL `scattergl` / `scatter3d`)** or **Deck.gl** | Hardware-accelerated interactive cluster visualization without freezing the main UI thread. |
| **State & IPC** | **Zustand + TanStack Query + Tauri IPC (`invoke` / `listen`)** | Clean separation between local UI state, async DB queries, and real-time Rust backend events (download progress, logs, metrics). |
| **Packaging & Updates** | **Tauri Bundler + `tauri-plugin-updater`** | **1. Windows:** NSIS `.exe` + WiX `.msi` → **2. macOS:** Universal `.dmg` (Apple Silicon + Intel) → **3. Linux:** `.AppImage`, `.deb`, `.rpm`, with signed in-app auto-updates. |

## 3. Vector Database Engine Support Matrix

The engine manifest keys every binary download by **Rust target triple** (`x86_64-pc-windows-msvc`, `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-gnu`), so EmbedBay automatically shows native one-click installs supported on the user's current OS.

| Tier | Engine | Windows Strategy (Priority 1) | macOS & Linux Strategy (Priorities 2 & 3) | Official Reference |
| ----- | ----- | ----- | ----- | ----- |
| **Tier 1 (Native Managed)** | **Qdrant** | Official `qdrant-x86_64-pc-windows-msvc.zip` (~31 MB), runs `qdrant.exe` natively with custom `config.yaml`. | Official `aarch64-apple-darwin`, `x86_64-apple-darwin`, and `x86_64-unknown-linux-gnu` `.tar.gz` binaries. | [Qdrant Releases](https://github.com/qdrant/qdrant/releases) |
| **Tier 1 (Native Managed)** | **Chroma** | Official standalone Rust CLI binary (`chroma.exe`), runs `chroma run --path <dir> --host 127.0.0.1 --port <port>`—no Python or Docker required. | Official standalone Rust CLI binary (`chroma`) via the same `chroma run` command. | [Chroma CLI Install](https://docs.trychroma.com/docs/cli/install), [Chroma Server Docs](https://docs.trychroma.com/docs/cli/run) |
| **Tier 1 (Native Managed)** | **PostgreSQL + pgvector** | Portable Windows PostgreSQL binaries paired with native `pgvector` (`vector.dll`), managed via `initdb` + `pg_ctl`. | Portable/embedded PostgreSQL + compiled `pgvector` shared library (`.dylib` on macOS, `.so` on Linux). | [pgvector](https://github.com/pgvector/pgvector), [pgvector Windows Builds](https://github.com/andreiramani/pgvector_pgsql_windows/releases) |
| **Tier 1 (Embedded Zero-Daemon)** | **LanceDB** | Open-source embedded columnar vector DB (0 MB idle RAM); opens local `.lance` directories directly. | Identical embedded directory support on macOS and Linux. | [LanceDB](https://github.com/lancedb/lancedb) |
| **Tier 2 (Viewer / Remote Only)** | **Pinecone, Weaviate, Milvus, Elasticsearch, Redis Stack** | Connect via URL + API key/credentials to cloud or existing self-hosted instances, matching [VectorDBZ](https://github.com/vectordbz/vectordbz). | Same remote viewer support across all OSes. | [VectorDBZ](https://github.com/vectordbz/vectordbz) |
| **Tier 3 (OS-Conditional Native)** | **Weaviate & Milvus (Local)** | Neither [Weaviate](https://docs.weaviate.io/deploy) nor [Milvus / Milvus Lite](https://milvus.io/docs/operational_faq.md) offers official native Windows server binaries (requiring Linux, Docker, or WSL; see [Milvus Windows Docs](https://milvus.io/docs/install_standalone-windows.md)). Remote-only on Windows V1; optional opt-in WSL2 runner later. | Because the manifest is target-triple keyed, native local **Weaviate** binaries and **Milvus Lite** can be enabled directly on macOS and Linux in Phases 6–7 without Docker. | [Weaviate Deploy](https://docs.weaviate.io/deploy), [Milvus FAQ](https://milvus.io/docs/operational_faq.md) |

## 4. System Architecture

### 4.1 High-Level Component Separation

1. **System Tray / Menu Bar Supervisor & Backend Core (Rust / Tauri Main Process)**
   * Runs persistently in the OS tray (Windows System Tray, macOS Menu Bar, Linux AppIndicator/Tray).
   * Manages the SQLite registry, engine downloads, child DB processes, health checks, log ring buffers, and resource telemetry.
   * Continues running managed database instances even when the user closes the main UI window.
2. **Destroy-on-Close WebView UI (React / TypeScript)**
   * Opens on demand from the tray icon or app launcher.
   * Closing the window **destroys the WebView instance** (not just hiding it) to free UI memory completely while the Rust supervisor keeps DB services running.
   * Re-opening recreates the WebView and immediately rehydrates live state from the Rust backend via IPC.
3. **Platform Abstraction Layer (`backend/src/platform/`)**
   * Encapsulates all OS-specific behavior behind a single Rust interface so Windows is implemented first and macOS/Linux drop in cleanly later:
     * Child process spawn flags (`CREATE_NO_WINDOW` on Windows; detached process groups on Unix).
     * Graceful stop signals (`CTRL_BREAK_EVENT` / HTTP shutdown on Windows; `SIGTERM` / `SIGINT` on macOS & Linux).
     * Default data directories via Tauri's `app_local_data_dir()`.
     * Native secret storage via `keyring` (Windows Credential Manager, macOS Keychain, Linux Secret Service).
4. **Engine Plugin & Adapter Layer**
   * **Runtime Provider Trait (`EngineProvider`)**: Defines how each Tier 1 engine is downloaded, verified, configured, launched, health-checked, and gracefully stopped.
   * **Data Explorer Adapter (`VectorDbAdapter`)**: Normalizes collection listing, schema inspection, record pagination, CRUD, metadata filtering, and vector/hybrid search across all supported engines (both local managed and remote).

### 4.2 Cross-Platform Local Filesystem Layout

Resolve the default base directory via `tauri::Manager::path().app_local_data_dir()` (always user-configurable to another drive/mount):

* **Windows (Priority 1):** `%LOCALAPPDATA%\EmbedBay\`
* **macOS (Priority 2):** `~/Library/Application Support/EmbedBay/`
* **Linux (Priority 3):** `~/.local/share/embedbay/`

Internal directory structure (identical across all platforms using `std::path::PathBuf`):

* `<data_root>/app.db` — SQLite metadata database
* `<data_root>/manifest.json` — Cached target-triple engine catalog (versions, download URLs, SHA-256 hashes)
* `<data_root>/bin/<engine>/<version>/` — Extracted engine executables (shared across multiple instances of the same version)
* `<data_root>/instances/<instance_id>/config/` — Generated engine config files (`config.yaml`, `postgresql.conf`, etc.)
* `<data_root>/instances/<instance_id>/data/` — Persistent vector storage directory
* `<data_root>/instances/<instance_id>/logs/` — Rotating stdout/stderr log files (max size + rotation count)

### 4.3 OS Boot & Background Execution Strategy

* **Default Mode (Per-User Auto-Start, Zero Admin/UAC Friction):**
  * Use `tauri-plugin-autostart` with `--minimized` (automatically handles Windows `HKCU\...\Run`, macOS `LaunchAgents`, and Linux `~/.config/autostart/*.desktop`).
  * On OS login, EmbedBay launches directly into the System Tray / Menu Bar without creating a WebView window.
  * The supervisor queries SQLite for all instances where `auto_start = 1`, verifies port availability, and starts them sequentially with staggered startup delays to avoid disk I/O spikes.
* **Optional Advanced Mode (Pre-Login OS Service — Future Enhancement):**
  * A separate headless Rust binary (`embedbay-daemon`) can be added optionally for pre-login execution (Windows Service via `windows-service`, macOS `launchd` daemon, or Linux `systemd` service) communicating with the UI over a local IPC socket / named pipe (`\\.\pipe\embedbay`).
* **Process Hygiene:**
  * On Windows, spawn all child DB processes with `creation_flags(0x08000000)` (`CREATE_NO_WINDOW`) so no terminal windows pop up.
  * On macOS/Linux, ensure extracted binaries have executable permissions (`chmod +x` / `0o755`).
  * Bind all local services to `127.0.0.1` by default (require explicit user opt-in for `0.0.0.0` LAN exposure).
  * On full app quit (not tray close), send graceful shutdown signals (`pg_ctl stop`, HTTP shutdown, `CTRL_BREAK_EVENT` on Windows, or `SIGTERM` on Unix) with a 10-second timeout before force termination to prevent index corruption.

## 5. Complete Feature List

### 5.1 Local Engine & Service Manager (Core Differentiator)

* **Engine Catalog & One-Click Installer:** Browse available Tier 1 engines and versions for the current OS, view binary size, download with live progress bar, verify SHA-256 checksum, extract automatically (`.zip` or `.tar.gz`), and uninstall unused versions.
* **Multi-Instance Orchestration:** Create multiple isolated instances of the same engine (e.g., `chroma-dev` on port `8000` and `chroma-rag-test` on port `8001`), each with its own data folder, config, and port.
* **Lifecycle Controls:** Start, stop, restart, and force-kill individual instances, an entire **Group**, or all instances at once, from either the main dashboard or the System Tray / Menu Bar context menu.
* **Port Conflict Detection:** Automatically scan TCP ports before launch and suggest/assign the next free port if a conflict exists.
* **Boot Auto-Start Toggle:** Per-instance switch (`Start on OS boot`) plus a global `Launch EmbedBay on startup` setting.
* **Live Telemetry & Logs:** Real-time per-instance RAM usage (MB), CPU %, uptime, disk footprint of the data directory, and a filterable live stdout/stderr log viewer with search and export.
* **Low-RAM Power Controls:** Optional per-instance **Idle Auto-Stop** (stop an instance automatically after N minutes of zero API traffic) and one-click "Stop All Idle Services."
* **Backup & Restore:** Pause an instance cleanly, archive its `data/` directory to a timestamped `.zip`, or restore a previous snapshot.

### 5.2 Connection Organization (Names, Groups & Tags)

* **Custom Connection Naming & Visual Identity:** Give every local instance and remote connection a custom human-readable name, optional description/notes, and subtle accent color badge (e.g., teal for local dev, rose warning border for remote production).
* **Collapsible Groups (Folders):** Organize both local instances and remote connections into user-defined groups (e.g., `Work RAG`, `Personal Experiments`, `Client Staging`) with drag-and-drop reordering, custom group icons/colors, and bulk actions (**Start All in Group** / **Stop All in Group** for local instances).
* **Multi-Tag System:** Create reusable, color-coded tags (e.g., `local`, `prod`, `qdrant`, `openai-1536`, `benchmark`) and attach multiple tags to any connection or instance.
* **Instant Sidebar Filtering & Search:** Filter the connection tree by tag chips, group, engine type, or running status (`Running`, `Stopped`, `Remote`), plus fuzzy-search by connection name.

### 5.3 Vector DB Explorer & Analytics

* **Unified Multi-Tab Workspace:** Open multiple collections, search playgrounds, or live log streams in parallel tabs (like VS Code or TablePlus) without losing state when switching connections.
* **Collection & Index Inspector:** View collections/tables, vector count, vector dimensions, distance metric (Cosine, Dot, Euclidean), index type (HNSW, IVF), and storage/segment stats. Create and delete collections via UI forms.
* **Virtualized Record Browser:** Browse points/documents with pagination/cursor scrolling, expandable JSON metadata payload viewer, raw vector preview (truncated with copy button), and inline Edit/Delete/Upsert.
* **Search & Query Playground:**
  * **Text-to-Vector Search:** Enter natural language text and embed it on the fly using a configured embedding provider (local Ollama, OpenAI-compatible API, or built-in local ONNX embedder).
  * **Vector / Record-ID Search:** Paste a raw float array or click "Find Similar" on any existing record.
  * **Hybrid Search & Metadata Filters:** Visual filter builder (`equals`, `in`, `range`, `contains`) plus raw JSON filter mode, Top-K selector, and score threshold slider.
  * **Query Stats:** Display latency (ms), returned count, and similarity score distribution.
* **2D / 3D Embedding Visualizer:** Sample up to N vectors from a collection, compute dimensionality reduction (PCA / UMAP / t-SNE in a Rust background worker so the UI never freezes), render interactive WebGL scatter plots colored by metadata field, and inspect full record content on hover/click.
* **Import / Export Tools:** Import records from JSONL/CSV (with optional auto-embedding of a text column) and export query results or full collections to JSONL/CSV.

## 6. UI / UX Design System & EmbedBay Color Palette

To give **EmbedBay** a distinct, modern desktop identity (Linear / Raycast / TablePlus-inspired—not a clone of [VectorDBZ](https://github.com/vectordbz/vectordbz)), implement a **Deep Harbor Charcoal + Bay Teal** design system with full Dark Mode (default) and Light Mode parity.

### 6.1 Brand & Semantic Color Tokens (`frontend/app/styles/theme.css`)

| Token Name | Dark Mode (Default) | Light Mode | Usage |
| ----- | ----- | ----- | ----- |
| `--bg-canvas` | `#090C12` | `#F8FAFC` | Main app background & titlebar |
| `--bg-surface` | `#10151F` | `#FFFFFF` | Sidebar, cards, tab bar, inspector drawer |
| `--bg-elevated` | `#161D2B` | `#F1F5F9` | Modals, command palette, hover states, table headers |
| `--border-subtle` | `#1E2738` | `#E2E8F0` | 1px hairline dividers between panes and table rows |
| `--border-strong` | `#2B374D` | `#CBD5E1` | Input borders, active card outlines |
| `--text-primary` | `#F1F5F9` | `#0F172A` | Headings, record IDs, primary labels (WCAG AAA contrast) |
| `--text-secondary` | `#94A3B8` | `#475569` | Metadata keys, port numbers, subtitles |
| `--text-muted` | `#64748B` | `#64748B` | Timestamps, disabled states, placeholder text |
| `--accent-primary` | `#14B8A6` *(Bay Teal)* | `#0D9488` | Primary buttons, active tab bar, focus rings, brand icon |
| `--accent-primary-hover` | `#2DD4BF` | `#0F766E` | Hover state for primary interactive elements |
| `--accent-secondary` | `#38BDF8` *(Sky Cyan)* | `#0284C7` | Vector score bars, search match highlights, inline links |
| `--accent-ai` | `#818CF8` *(Signal Indigo)* | `#4F46E5` | Embedding profile badges & AI semantic search pills |
| `--status-running` | `#10B981` *(Emerald)* | `#059669` | Active/healthy local DB status dot |
| `--status-starting` | `#F59E0B` *(Amber)* | `#D97706` | Starting, downloading, or indexing pulse indicator |
| `--status-stopped` | `#64748B` *(Slate)* | `#94A3B8` | Stopped/idle local DB dot |
| `--status-error` | `#F43F5E` *(Rose)* | `#E11D48` | Crash alerts, destructive actions, remote `prod` warning border |

### 6.2 Curated Group & Tag Color Swatches

Provide these 8 harmonious preset swatches in the Group and Tag color pickers (rendered as soft 15% opacity tinted pills with full-saturation text/border in Dark Mode, and 10% tint with darker text in Light Mode):

* **Teal:** `#14B8A6` | **Sky:** `#38BDF8` | **Indigo:** `#818CF8` | **Violet:** `#A78BFA`
* **Pink:** `#F472B6` | **Orange:** `#FB923C` | **Emerald:** `#10B981` | **Rose:** `#F43F5E`

### 6.3 Logo & Icon Specification

* **App Icon (`installer/icons/`):** Rounded dark-charcoal squircle (`#090C12` to `#10151F` subtle vertical gradient) featuring a minimalist U-shaped "docking bay" bracket cradling 3 geometric vector nodes/bars in **Bay Teal (`#14B8A6`)** and **Sky Cyan (`#38BDF8`)**.
* **Tray / Menu Bar Icon:** Pure monochrome 16×16 / 32×32 SVG silhouette of the bay bracket + 3 nodes so it remains crisp on Windows 11 taskbar, macOS Menu Bar, and Linux panels.

### 6.4 Typography & 3-Pane Workspace Layout

* **Adaptive Window Chrome:**
  * **Windows & Linux:** Custom frameless titlebar (`decorations: false`) integrating the EmbedBay mark, workspace tab bar, a compact `Ctrl+K` quick-search trigger, and right-aligned minimize/maximize/close controls.
  * **macOS (Phase 6):** Native `titleBarStyle: "Overlay"` keeping macOS traffic-light buttons on the left with left-padded workspace tabs and `Cmd+K` shortcuts.
* **Typography:**
  * **UI Chrome:** Native OS system stack (`Segoe UI Variable` on Windows, `-apple-system` on macOS, `Inter` / `system-ui` on Linux)—clean, crisp, zero webfont bloat.
  * **Data & Telemetry:** `JetBrains Mono` (with `Cascadia Code` / `SF Mono` fallback) for ports, RAM/CPU readouts, UUIDs, JSON payloads, vector floats, and live logs.
* **3-Pane Workspace Layout:**
  1. **Far-Left Slim Activity Rail (48px):** Icon switchers for *Explorer*, *Local Runtimes*, *Engine Store*, and *Settings*, plus a bottom live badge showing total local DB RAM usage (e.g., `214 MB`).
  2. **Resizable Connection & Group Tree (260px):** Top search input + clickable **Tag Filter Bar**, followed by collapsible **Groups** containing named instances/connections with inline Start/Stop hover buttons and status dots.
  3. **Main Tabbed Canvas + Collapsible Right Inspector:** Multi-tabbed editor/table/playground in the center, paired with an optional right-side slide-over drawer for inspecting full JSON payloads, editing metadata, or viewing live instance RAM/CPU sparklines.
* **Keyboard-First Command Palette (`Ctrl+K` / `Cmd+K`):** Instant access to switch connections, filter by tag, start/stop any local DB instance, open a collection, or jump to logs without touching the mouse.

## 7. Data Models & IPC Contract

### 7.1 SQLite Schema (`app.db`)

```sql
CREATE TABLE installed_engines (
    id TEXT PRIMARY KEY,              -- e.g. 'qdrant-1.20.2'
    engine_type TEXT NOT NULL,        -- 'qdrant' | 'chroma' | 'pgvector' | 'lancedb'
    version TEXT NOT NULL,
    target_triple TEXT NOT NULL,      -- e.g. 'x86_64-pc-windows-msvc'
    binary_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    installed_at INTEGER NOT NULL
);

CREATE TABLE connection_groups (
    id TEXT PRIMARY KEY,              -- UUID
    name TEXT NOT NULL UNIQUE,        -- e.g. 'Work RAG', 'Local Experiments'
    color TEXT,                       -- Hex swatch e.g. '#14B8A6'
    icon TEXT,                        -- Lucide icon name
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_collapsed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE tags (
    id TEXT PRIMARY KEY,              -- UUID
    name TEXT NOT NULL UNIQUE,        -- e.g. 'dev', 'prod', 'local', 'openai-1536'
    color TEXT NOT NULL DEFAULT '#14B8A6'
);

CREATE TABLE instances (
    id TEXT PRIMARY KEY,              -- UUID
    name TEXT NOT NULL UNIQUE,        -- Custom display name e.g. 'Local Qdrant Dev'
    description TEXT,
    color TEXT,                       -- Optional badge color
    group_id TEXT REFERENCES connection_groups(id) ON DELETE SET NULL,
    engine_type TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    host TEXT NOT NULL DEFAULT '127.0.0.1',
    port INTEGER NOT NULL,
    grpc_port INTEGER,                -- Optional (e.g. Qdrant 6334)
    data_dir TEXT NOT NULL,
    config_json TEXT NOT NULL,        -- Engine-specific overrides
    auto_start INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE remote_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,               -- Custom display name e.g. 'Prod Pinecone US-East'
    description TEXT,
    color TEXT,                       -- e.g. '#F43F5E' for production warning
    group_id TEXT REFERENCES connection_groups(id) ON DELETE SET NULL,
    engine_type TEXT NOT NULL,        -- 'qdrant' | 'chroma' | 'pgvector' | 'pinecone' | 'weaviate' | 'milvus'
    endpoint_url TEXT NOT NULL,
    auth_type TEXT NOT NULL,          -- 'none' | 'api_key' | 'basic'
    secret_ref TEXT,                  -- Key stored in OS keyring (never plaintext)
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE entity_tags (
    entity_type TEXT NOT NULL,        -- 'instance' | 'remote_connection'
    entity_id TEXT NOT NULL,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (entity_type, entity_id, tag_id)
);

CREATE TABLE embedding_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,           -- 'ollama' | 'openai_compatible' | 'local_onnx'
    model_name TEXT NOT NULL,
    base_url TEXT,
    dimensions INTEGER,
    secret_ref TEXT
);
```

### 7.2 Core Tauri IPC Commands

* **Engine Management:** `list_engine_catalog()`, `list_installed_engines()`, `install_engine(engine_type, version)` (emits `install-progress` events), `uninstall_engine(id)`
* **Instance Lifecycle:** `list_instances()`, `create_instance(payload)`, `update_instance(id, payload)`, `delete_instance(id, delete_data)`, `start_instance(id)`, `stop_instance(id)`, `restart_instance(id)`, `start_group_instances(group_id)`, `stop_group_instances(group_id)`, `get_all_instance_metrics()`, `subscribe_instance_logs(id)`
* **Groups & Tags:** `list_groups()`, `create_group(payload)`, `update_group(id, payload)`, `delete_group(id)`, `reorder_items(payload)`, `list_tags()`, `create_tag(name, color)`, `delete_tag(id)`, `set_entity_tags(entity_type, entity_id, tag_ids)`
* **System & Boot:** `get_platform_info()`, `get_autostart_enabled()`, `set_autostart_enabled(bool)`, `check_port_available(port)`, `backup_instance(id, dest_zip)`
* **Explorer & Analytics:** `test_connection(target)`, `list_collections(target)`, `get_collection_info(target, collection)`, `browse_records(target, collection, limit, offset, filter)`, `upsert_record(target, collection, record)`, `delete_records(target, collection, ids)`, `search_vectors(target, collection, query)`, `compute_embedding_projection(vectors, method, dims)`

## 8. Project Directory Structure

Instead of Tauri's default `src/` + `src-tauri/` layout, organize the **EmbedBay** repository into clear top-level domains (`frontend/`, `backend/`, `manifests/`, `installer/`, `scripts/`):

```text
embedbay/
├── frontend/                         # React 19 + TypeScript UI (Vite root)
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── app/                          # Application code
│       ├── components/
│       │   ├── layout/               # AdaptiveTitlebar, ActivityRail, WorkspaceTabs, CommandPalette
│       │   ├── sidebar/              # GroupTree, TagFilterBar, ConnectionItem, GroupModal
│       │   ├── manager/              # EngineCatalog, InstanceCards, LogViewer, ResourceMeters
│       │   ├── explorer/             # CollectionTree, RecordTable, MetadataDrawer, CrudModal
│       │   ├── search/               # SearchPlayground, FilterBuilder, ScoreChart
│       │   └── visualizer/           # EmbeddingScatterPlot (2D/3D WebGL)
│       ├── stores/                   # Zustand stores (instances, groups, tags, tabs, theme)
│       ├── ipc/                      # Typed wrappers around Tauri invoke/listen
│       ├── types/                    # Shared frontend domain & adapter types
│       ├── styles/                   # theme.css (EmbedBay dark/light tokens) & global CSS
│       └── App.tsx
├── backend/                          # Rust Tauri v2 host & background supervisor
│   ├── Cargo.toml
│   ├── tauri.conf.json               # Points frontendDist -> ../frontend/dist
│   ├── capabilities/                 # Tauri v2 granular security permissions
│   └── src/
│       ├── main.rs                   # Entry point, --minimized flag, tray setup
│       ├── platform/                 # OS-specific isolation layer
│       │   ├── mod.rs                # Shared PlatformProcess trait & target_triple()
│       │   ├── windows.rs            # Priority 1: CREATE_NO_WINDOW, CTRL_BREAK_EVENT
│       │   ├── macos.rs              # Priority 2: POSIX SIGTERM, chmod +x, Menu Bar hooks
│       │   └── linux.rs              # Priority 3: POSIX SIGTERM, chmod +x, AppIndicator
│       ├── db/                       # SQLite init & migrations (incl. groups & tags)
│       ├── engines/
│       │   ├── mod.rs                # EngineProvider trait
│       │   ├── manifest.rs           # Target-triple version catalog & SHA-256 registry
│       │   ├── installer.rs          # Streaming download, checksum, .zip + .tar.gz extract
│       │   ├── qdrant.rs             # Qdrant binary & config provider
│       │   ├── chroma.rs             # Chroma standalone CLI provider
│       │   ├── pgvector.rs           # Portable PostgreSQL + pgvector provider
│       │   └── lancedb.rs            # Embedded LanceDB directory provider
│       ├── supervisor/
│       │   ├── process_manager.rs    # OS-agnostic lifecycle, healthcheck, backoff
│       │   ├── metrics.rs            # Per-PID RAM/CPU polling via sysinfo
│       │   ├── logs.rs               # Rotating file + ring buffer log broadcaster
│       │   └── autostart.rs          # Cross-platform startup & tray menu sync
│       ├── adapters/                 # Unified VectorDbAdapter trait + engine clients
│       ├── analytics/                # PCA / UMAP dimensionality reduction
│       └── commands/                 # Tauri #[tauri::command] handlers
├── manifests/                        # Target-triple engine catalog JSON & checksums
│   └── engines.json
├── installer/                        # Packaging assets, installer scripts & icons
│   ├── icons/                        # EmbedBay icons (.ico, .icns, .png) + monochrome tray icons
│   ├── windows/
│   │   ├── nsis/                     # Custom NSIS hooks (keep-data-on-uninstall prompt)
│   │   └── wix/                      # Custom WiX .msi fragments (upgrade code, registry)
│   ├── macos/                        # Entitlements.plist & DMG background/layout
│   └── linux/                        # embedbay.desktop entry & AppStream metadata
├── scripts/                          # Dev & release helper scripts
│   ├── update-manifest.ts            # Fetch latest engine releases & compute SHA-256
│   └── verify-release.ps1            # Smoke-test Windows .exe/.msi installer & autostart
├── .github/
│   └── workflows/
│       ├── release-windows.yml       # Priority 1: Build, sign & publish .exe + .msi
│       ├── release-macos.yml         # Priority 2: Build, sign, notarize Universal .dmg
│       └── release-linux.yml         # Priority 3: Build .AppImage, .deb, .rpm
└── package.json                      # Root workspace scripts (dev, build, bundle)
```

> **Tauri v2 Wiring Note for the AI Agent:** Run Tauri CLI commands targeting `backend/` (e.g., `tauri dev` / `tauri build` from `backend/` or via root `package.json` scripts using `--config backend/tauri.conf.json`), with `backend/tauri.conf.json` setting `productName` to `"EmbedBay"`, `identifier` to `"com.embedbay.app"`, `build.frontendDist` to `"../frontend/dist"`, `build.beforeDevCommand` to `"npm --prefix ../frontend run dev"`, and `build.beforeBuildCommand` to `"npm --prefix ../frontend run build"`.

## 9. Release Packaging, Installers & Auto-Update Strategy

### 9.1 Windows Installers (Priority 1)

Ship **both** standard Windows installer formats from Tauri v2's bundler (`bundle.targets: ["nsis", "msi"]`):

| Format | Output Artifact | Target Use Case & Behavior |
| ----- | ----- | ----- |
| **NSIS Setup (`.exe`)** | `EmbedBay_<ver>_x64-setup.exe` | Primary installer for individual developers. Supports per-user install (no UAC admin prompt needed), optional desktop shortcut, optional "Start with Windows" checkbox, and a custom uninstaller hook asking whether to preserve or remove `%LOCALAPPDATA%\EmbedBay\instances\`. |
| **WiX MSI (`.msi`)** | `EmbedBay_<ver>_x64_en-US.msi` | Enterprise/IT-friendly Windows Installer supporting silent installs (`msiexec /i EmbedBay.msi /qn`), Group Policy deployment, clean in-place upgrades via fixed WiX UpgradeCode, and `winget` distribution. |

* **WebView2 Handling:** Configure `bundle.windows.webviewInstallMode: { "type": "downloadBootstrapper" }` in `backend/tauri.conf.json`. Windows 11 already includes WebView2; Windows 10 machines missing it will download the runtime automatically without bloating the installer binary.
* **Code Signing:** Sign both the application binary and the `.exe`/`.msi` installers with an Authenticode certificate (e.g., Azure Trusted Signing or EV code-signing cert) in CI to prevent Windows SmartScreen warnings.
* **In-App Auto-Updater:** Enable `tauri-plugin-updater` pointed at GitHub Releases (`latest.json` + cryptographic `.sig` signatures) so users receive one-click app updates while keeping all local vector databases and data directories intact.

### 9.2 macOS & Linux Releases (Priorities 2 & 3)

* **macOS (Priority 2):** Universal `EmbedBay_<ver>_universal.dmg` (Apple Silicon `aarch64` + Intel `x86_64`), signed with Apple Developer ID and notarized via `notarytool` in `.github/workflows/release-macos.yml`, plus optional Homebrew cask (`brew install --cask embedbay`).
* **Linux (Priority 3):** `.AppImage` (distro-agnostic), `.deb` (Ubuntu/Debian), and `.rpm` (Fedora/RHEL) built in `.github/workflows/release-linux.yml`.

### 9.3 Automated Release Pipeline (CI/CD)

* Trigger GitHub Actions workflows via `tauri-apps/tauri-action` on version tags (`v*.*.*`).
* Automatically compile, bundle installers (`.exe` + `.msi` on Windows first), generate `latest.json` updater manifests + signatures, and publish draft GitHub Releases.

## 10. Phased Implementation Roadmap (For Your AI Coding Agent)

Execute Phases 1–5 to ship **Windows (Priority 1)** first, then execute Phase 6 for **macOS (Priority 2)** and Phase 7 for **Linux (Priority 3)**.

### Phase 1 — Tauri v2 Foundation, Clean Workspace, Theme Tokens & Tray Supervisor (Windows)
1. Scaffold the `frontend/` (React 19 + TypeScript + Tailwind v4 + shadcn/ui + React Compiler) and `backend/` (Tauri v2 Rust) workspace structure with root `package.json` scripts wired to `backend/tauri.conf.json` (`productName: "EmbedBay"`).
2. Implement `frontend/app/styles/theme.css` with all Dark/Light color tokens from Section 6.1 and the 8 preset Group/Tag swatches from Section 6.2.
3. Create `backend/src/platform/` with `windows.rs` implemented and `macos.rs`/`linux.rs` stubbed so no raw Windows APIs leak into shared modules.
4. Build the adaptive titlebar, Activity Rail, and `Ctrl+K` / `Cmd+K` Command Palette shell.
5. Set up SQLite (`app.db`) using `app_local_data_dir()` with schema migrations for engines, instances, remote connections, groups, and tags.
6. Implement System Tray integration, **destroy-on-close** WebView behavior, `tauri-plugin-autostart`, and `--minimized` startup flag handling.

### Phase 2 — Native Engine Installer, Process Supervisor & Groups/Tags UI (Windows)
1. Build `EngineProvider` trait, target-triple manifest loader (`manifests/engines.json`), streaming HTTP downloader with SHA-256 verification, and `.zip` / `.tar.gz` extractor.
2. Implement **Qdrant** (`qdrant.exe`) and **Chroma** (`chroma.exe` via `chroma run`) providers with isolated config and data directories.
3. Build `ProcessManager` using the platform abstraction (`CREATE_NO_WINDOW` on Windows), TCP port conflict checks, HTTP health polling (`/healthz` / `/api/v2/heartbeat`), crash auto-restart with backoff, graceful shutdown, live log streaming, and `sysinfo` RAM/CPU metrics.
4. Build the **Services Dashboard & Sidebar UI**: Engine Catalog, Create/Rename Instance wizard, collapsible Groups with bulk Start/Stop, color-coded Tags with instant filtering, live RAM/CPU badges, and Log Viewer.

### Phase 3 — Multi-Tab Vector DB Explorer & Search Playground
1. Implement `VectorDbAdapter` in Rust for **Qdrant** and **Chroma** (auto-wired to local managed instances + manual remote connections).
2. Build the **Multi-Tab Explorer UI**: Collection list, schema/stats header, virtualized record table, right-side JSON payload inspector drawer, and Create/Edit/Delete record modals.
3. Build the **Search Playground**: Raw vector search, "Find Similar" from any record, visual metadata filter builder, and latency/score metrics.
4. Integrate **Embedding Profiles** (Ollama + OpenAI-compatible endpoints) so users can run plain-text semantic queries directly in the playground.

### Phase 4 — Additional Native Engines, 2D/3D Visualizer & Import/Export
1. Add **LanceDB** (embedded local folder explorer with zero background RAM) and **PostgreSQL + pgvector** (portable Windows binary + `vector.dll` provider).
2. Add Rust-side PCA/UMAP projection and a WebGL **2D/3D Embedding Visualizer** with metadata color-coding and point inspection.
3. Implement JSONL/CSV collection import (with batch embedding) and export, plus one-click instance backup/restore (`.zip`).

### Phase 5 — Remote Adapters, Security & Windows `.exe` / `.msi` GA Release (Priority 1)
1. Add Tier 2 remote viewer adapters (Pinecone, Weaviate, Milvus, Elasticsearch, Redis Stack) and store API keys securely via `keyring` (Windows Credential Manager).
2. Add optional **Idle Auto-Stop** policy for local instances and storage cleanup for old engine versions.
3. Configure `installer/windows/nsis/` and `installer/windows/wix/` (upgrade code, keep-data-on-uninstall hook, WebView2 bootstrapper), wire `tauri-plugin-updater`, and add `.github/workflows/release-windows.yml`.
4. Build and smoke-test both `EmbedBay_<ver>_x64-setup.exe` and `EmbedBay_<ver>_x64_en-US.msi` on clean Windows 10/11 machines, verify reboot auto-start, and profile idle RAM usage.

### Phase 6 — macOS Release (Priority 2)
1. Complete `backend/src/platform/macos.rs` (POSIX `SIGTERM` graceful stop, executable permissions on extracted `.tar.gz` binaries, Menu Bar tray icon & `ActivationPolicy::Accessory` when window is closed).
2. Add `aarch64-apple-darwin` and `x86_64-apple-darwin` entries to `manifests/engines.json` (Qdrant, Chroma, portable PostgreSQL + pgvector, plus optional native Weaviate/Milvus Lite).
3. Adapt window chrome to macOS native traffic-light `Overlay` style and `Cmd+K` shortcuts; configure `installer/macos/` and `.github/workflows/release-macos.yml` to sign, notarize, and publish `EmbedBay_<ver>_universal.dmg`.

### Phase 7 — Linux Release (Priority 3)
1. Complete `backend/src/platform/linux.rs` (POSIX `SIGTERM`, `chmod +x`, XDG autostart verification, AppIndicator tray support, and `libsecret` keyring integration).
2. Add `x86_64-unknown-linux-gnu` entries to `manifests/engines.json` (Qdrant, Chroma, portable PostgreSQL + pgvector, plus optional native Weaviate/Milvus Lite).
3. Configure `installer/linux/` and `.github/workflows/release-linux.yml` to build and test `.AppImage`, `.deb`, and `.rpm` bundles on Ubuntu and Fedora.

## 11. Critical Implementation Guardrails

* **Isolate OS-Specific Code from Day 1:** Never scatter `std::os::windows` calls or hardcoded `\` path separators across core business logic. Keep all OS-specific code inside `backend/src/platform/` and always construct paths with `std::path::PathBuf`.
* **No Flashing Command Prompts (Windows):** Always pass `.creation_flags(0x08000000)` (`CREATE_NO_WINDOW`) on child processes inside `backend/src/platform/windows.rs`.
* **No Plaintext Secrets:** Store remote DB API keys and embedding provider keys in the OS keyring via the Rust `keyring` crate (Windows Credential Manager → macOS Keychain → Linux Secret Service), saving only a reference key in SQLite.
* **Safe Shutdown Before Backup/Quit:** Never zip a live database's `data/` directory while the process is writing (especially SQLite-backed Chroma or PostgreSQL); always pause/stop the instance or use the engine's native snapshot API first.
* **Preserve User Data on App Upgrade/Uninstall:** Upgrading via `.exe`/`.msi` or `tauri-plugin-updater` must never touch `%LOCALAPPDATA%\EmbedBay\instances\`; uninstalling should explicitly ask before deleting database files.
* **Log Rotation:** Cap log files (e.g., 10 MB x 3 files per instance) and keep only the latest 1,000 lines in memory so long-running background services never leak RAM or fill disk space.
* **Single-Instance App Lock:** Use `tauri-plugin-single-instance` so launching EmbedBay while it is already running in the tray simply opens/focuses the existing window instead of spawning duplicate DB supervisors.