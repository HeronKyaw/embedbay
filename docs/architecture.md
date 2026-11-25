# System Architecture

EmbedBay uses a strict separation between the React frontend UI (`frontend/`) and the Rust/Tauri v2 backend (`backend/`), intentionally avoiding any `src-tauri/` directory.

---

## 1. High-Level Layers

| Layer | Location | Responsibilities |
| --- | --- | --- |
| **UI & State** | `frontend/app/` | React 19 + TypeScript UI, Zustand stores (`useAppStore`, `useRuntimeStore`, `useTabsStore`), Tailwind CSS v4 tokens (`styles/theme.css`), virtualized tables, WebGL Plotly scatter plots, Tauri IPC wrappers (`ipc/`). |
| **Command API** | `backend/src/commands/` | `#[tauri::command]` handlers for engines, instances, groups/tags, remote connections & embedding profiles, explorer CRUD/search, analytics projections, and JSONL/CSV transfer. |
| **Engine Providers** | `backend/src/engines/` | Manifest loader (`manifest.rs`), streaming SHA-256 installer & `.zip`/`.tar.gz` extractor (`installer.rs`), and per-engine `EngineProvider` configs (`qdrant.rs`, `chroma.rs`, `pgvector.rs`, `lancedb.rs`). |
| **Process Supervisor** | `backend/src/supervisor/` | Lifecycle state machine (`process_manager.rs`), `sysinfo` metrics polling (`metrics.rs`), rotating log ring buffer (`logs.rs`), tray integration (`tray.rs`), OS autostart (`autostart.rs`), and stop-before-zip backup/restore (`backup.rs`). |
| **Unified Adapters** | `backend/src/adapters/` | Async `VectorDbAdapter` trait implemented uniformly across Tier 1 local engines and Tier 2 remote engines, plus Ollama/OpenAI embedding clients (`embeddings.rs`). |
| **Analytics** | `backend/src/analytics/` | Rust-native 2D/3D PCA (power-iteration covariance eigensolver) and UMAP dimensionality reduction (`projection.rs`). |
| **Storage** | `backend/src/db/` | Embedded `rusqlite` registry (`app.db`) with idempotent SQL migrations (`0001_initial_schema.sql`, `0002_extended_settings.sql`). |
| **OS Isolation** | `backend/src/platform/` | All OS-specific system APIs isolated under `windows.rs`, `macos.rs`, `linux.rs`, plus cross-platform `keyring` wrapper (`secrets.rs`). |

---

## 2. Windows Platform Isolation (`backend/src/platform/windows.rs`)

All Win32 process flags and console signal APIs live strictly in `backend/src/platform/windows.rs`:

- **Hidden Process Creation:** Every child database process is configured via `configure_std_command` / `configure_tokio_command` with `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` (`0x08000000 | 0x00000200`) so Qdrant, Chroma, and PostgreSQL never flash console windows.
- **Graceful Termination:** `graceful_stop_process` sends `CTRL_BREAK_EVENT` via `GenerateConsoleCtrlEvent` to the child process group (and `pgvector` uses `pg_ctl stop -m fast` with clean checkpoint shutdown) before falling back to force-kill after 10 seconds.

---

## 3. Process Supervision, Metrics, Logs & Tray Lifecycle

- **Health Polling & Crash Recovery:** `ProcessManager` validates TCP port availability before spawning, polls engine health endpoints (`/healthz`, `/api/v2/heartbeat`, or PostgreSQL `SELECT 1`), and restarts crashed daemons with exponential backoff (up to 5 retries).
- **Live Telemetry:** Background polling samples per-PID memory (`ram_bytes`) and CPU (`cpu_percent`) via `sysinfo`, plus throttled disk footprint (`disk_bytes`), pushing updates to the frontend through `supervisor::EventSink`.
- **Log Rotation:** `InstanceLogStore` retains a bounded in-memory ring buffer (`1,000` lines per instance) and rotates on-disk logs at `10 MB x 3` files (`logs.rs`).
- **Idle Auto-Stop & Activity Tracking:** Calling `resolve_adapter` (`backend/src/adapters/mod.rs`) records instance activity timestamps; a background sweep runs `stop_idle_instances` every 30 seconds to stop idle daemons whose configured `idle_timeout_minutes` has elapsed.
- **Destroy-on-Close Tray Mode:** Intercepting window close destroys the WebView2 main window while keeping `ProcessManager` alive in the System Tray; `tauri-plugin-single-instance` focuses or re-opens the window when the app is launched again without `--minimized`.

---

## 4. On-Disk Storage & Secrets

Default app data root on Windows (via Tauri `app_local_data_dir()`):

```text
%LOCALAPPDATA%\com.embedbay.app\
├── app.db                      # SQLite metadata registry (engines, instances, groups, tags, connection refs)
├── manifests\engines.json      # Writable cached engine catalog (seeded from bundled manifests/engines.json)
├── bin\<engine>\<version>\     # Extracted native binaries (plus extra archives such as pgsql\ vector.dll)
└── instances\<instance-id>\    # Isolated config/, data/, logs/, snapshots/ per instance
```

- **Keyring Secrets (`backend/src/platform/secrets.rs`):** Remote connection credentials and embedding profile API keys are saved under service `"com.embedbay.app"` in **Windows Credential Manager** via the Rust `keyring` crate. SQLite rows store only a non-sensitive `secret_ref` UUID/key.
- **Safe Backup / Restore (`backend/src/supervisor/backup.rs`):** Before zipping an instance's `data_dir`, running instances are stopped first so SQLite-backed Chroma and PostgreSQL WAL files remain consistent; restore validates every archive path against Zip-Slip traversal and keeps a temporary backup rollback copy until extraction succeeds.
