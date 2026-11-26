# EmbedBay

**Zero-Docker native vector database manager, runtime supervisor, and multi-engine explorer built with Tauri v2, Rust, and React 19.**

EmbedBay installs, runs, monitors, and explores local vector databases natively on Windows (with cross-platform foundations in place for macOS and Linux), without requiring Docker Desktop or heavy Electron runtimes.

---

## Key Features

- **Native Engine Store (`manifests/engines.json`)**
  One-click download, SHA-256 checksum verification, Zip-Slip-safe archive extraction, and versioned isolation for native engines.
- **Process Supervisor & System Tray Persistence**
  - Spawns managed engines with `CREATE_NO_WINDOW` (`0x08000000`) on Windows—no flashing console windows.
  - TCP port conflict detection + automatic port suggestion, HTTP/TCP health polling, exponential backoff crash restarts, graceful shutdown (`CTRL_BREAK_EVENT` / `pg_ctl stop`), and rotating log streaming (`10 MB x 3` files, 1,000-line memory ring buffer).
  - Live `sysinfo` per-instance RAM, CPU, uptime, and disk metrics.
  - **Destroy-on-close WebView** reclaims UI RAM while background databases continue running in the System Tray; supports **Start with Windows (`--minimized`)** and single-instance window focus locking.
  - **Per-instance Idle Auto-Stop** and **Unused Engine Cleanup** in Settings & Engine Store.
- **Groups & Color-Coded Tags**
  Organize local instances and remote connections in collapsible Groups (with bulk Start/Stop) and filter instantaneously with 8 preset swatch tags.
- **Multi-Tab Explorer & CRUD**
  Inspect multiple local or remote collections side-by-side with a collection tree, schema/stats header, virtualized record table (`@tanstack/react-table` + `@tanstack/react-virtual`), right-side JSON payload drawer, and Create/Edit/Delete record & collection modals.
- **Search Playground & Embedding Profiles**
  Run raw vector similarity search, "Find Similar" from any row, visual or raw-JSON metadata filtering, latency/score histograms, and plain-text semantic search powered by **Ollama**, **OpenAI-compatible**, **Google Gemini**, **Cohere**, **Voyage AI**, or **HuggingFace TEI** embedding endpoints.
- **2D/3D WebGL Visualizer & Import/Export/Backup**
  Interactive WebGL scatter plots (`plotly.js-dist-min`) driven by Rust-side **PCA** and **UMAP** dimensionality reduction, JSONL/CSV batch import (with optional auto-embedding) & export, plus safe stop-before-zip **Backup / Restore**.
- **OS Keyring Credential Security & Auto-Updater**
  Remote DB API keys and embedding provider tokens are stored in Windows Credential Manager via the Rust `keyring` crate (never plaintext in SQLite). In-app updates use cryptographically signed `tauri-plugin-updater` GitHub Releases.

---

## Supported Engines

### Tier 1 — Local Managed & Embedded Engines

| Engine | Mode | Default Port |
| --- | --- | --- |
| **Qdrant** | Native daemon (`qdrant.exe`) | `6333` (HTTP), `6334` (gRPC) |
| **Chroma** | Native CLI daemon (`chroma.exe run`) | `8000` |
| **PostgreSQL + pgvector** | Portable `postgres.exe` + `vector.dll` | `5432` |
| **LanceDB** | Built-in embedded `.lance` directory (`0 MB` idle RAM) | None |
| **Meilisearch** | Native daemon (`meilisearch.exe`) | `7700` |
| **SurrealDB** | Native daemon (`surreal.exe` + SurrealKV) | `8008` |
| **SQLite + sqlite-vec** | Built-in embedded `vec0` (`vectors.db`, `0 MB` idle RAM) | None |
| **Elasticsearch** | Bundled-JDK daemon (`elasticsearch.bat`) | `9200` |
| **OpenSearch** | Bundled-JDK daemon (`opensearch.bat`) | `9201` |
| **MariaDB 11.8 Vector** | Portable `mariadbd.exe` + `VECTOR(N)` | `3306` |
| **DuckDB + vss** | On-demand embedded CLI (`duckdb.exe`, `0 MB` idle RAM) | None |

### Tier 2 — Remote Connections

Connect to self-hosted or managed clusters via unified `VectorDbAdapter` clients:

- **Qdrant** (remote HTTP/HTTPS)
- **Chroma** (remote HTTP/HTTPS)
- **PostgreSQL + pgvector** (`postgresql://` with optional TLS via `tokio-postgres-rustls`)
- **Meilisearch** (remote HTTP/HTTPS)
- **SurrealDB** (remote HTTP/HTTPS)
- **Elasticsearch** (remote HTTP/HTTPS)
- **OpenSearch** (remote HTTP/HTTPS)
- **MariaDB 11.8 Vector** (`mysql://` / `mariadb://` with optional TLS via `rustls`)
- **Pinecone**
- **Weaviate**
- **Milvus / Zilliz**
- **Redis Stack** (RediSearch vector indexes)

---

## Quick Start (Development)

**Prerequisites:** Node.js 22+, Rust stable toolchain (`x86_64-pc-windows-msvc`), and Microsoft Edge WebView2 Runtime (pre-installed on Windows 11).

```powershell
# Install root Tauri CLI and frontend packages
npm install
npm --prefix frontend install

# Start Tauri desktop app in hot-reload dev mode
npm run dev

# Run backend Rust test suite
npm run backend:test

# Typecheck & bundle production frontend
npm run frontend:build
```

To generate Windows installers locally (`EmbedBay_<ver>_x64-setup.exe` NSIS + `EmbedBay_<ver>_x64_en-US.msi` WiX), see [docs/development.md](docs/development.md) and [docs/releasing.md](docs/releasing.md).

---

## Repository Structure

```text
embedbay/
├── frontend/                   # React 19 + TypeScript + Tailwind v4 UI
├── backend/                    # Tauri v2 + Rust core (supervisors, adapters, analytics, commands)
├── manifests/engines.json      # Engine download URLs, sizes, and SHA-256 checksums
├── installer/                  # App icons + Windows NSIS/WiX custom installer hooks & fragments
├── scripts/                    # Manifest updater & release verification helpers
├── docs/                       # User, developer, architecture, engine, and release docs
└── .github/workflows/          # Windows CI/CD release pipeline
```

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full public milestone breakdown.

### v0.1 (Windows Launch)
- [x] Native Engine Store (Qdrant, Chroma, PostgreSQL + pgvector, Meilisearch, SurrealDB, Elasticsearch, OpenSearch, MariaDB 11.8 Vector, embedded LanceDB, SQLite + sqlite-vec, DuckDB + vss) & `CREATE_NO_WINDOW` process supervision
- [x] System Tray persistence, idle auto-stop, stop-before-zip Backup/Restore, OS Keyring secrets, and signed auto-updater
- [x] Multi-Tab Explorer, 2D/3D PCA/UMAP WebGL Visualizer, JSONL/CSV Import/Export, and Tier 2 remote adapters
- [x] Read-Only Safety Mode & Copy-as-Code Snippets (Python, TypeScript, `curl`, `psql`/SQL)
- [x] Expanded HTTP Embedding Providers (Ollama, OpenAI-Compatible, Gemini, Cohere, Voyage AI, HuggingFace TEI)
- [x] Search History, Saved Presets & Side-by-Side A/B Search Comparison
- [x] Collection Migration & Re-Embedding Wizard
- [x] Document Ingestion & Chunking Previewer (`.md` / `.txt`)
- [x] Index & Schema Management for Qdrant & pgvector

> *Note: Embedded LanceDB uses EmbedBay's portable directory format (`records.jsonl`) in v0.1 ahead of native Arrow/Lance binary support in v0.2.*

### v0.2 (Engine & Ingestion Depth)
- [ ] Native binary `.lance` table reader/writer (`lancedb` / Arrow) + `.parquet` import/export
- [ ] Zero-setup local ONNX embeddings (`local_onnx`) via on-demand Engine Store downloads
- [ ] PDF document ingestion (`.pdf`)
- [ ] Visualizer query overlay (project live query vector + top-K hits onto 2D/3D scatter plot)

### Future / Exploring
- [ ] Local MCP Server integration for AI coding agents
- [ ] Hybrid Search (dense + sparse/BM25 + RRF), Named Vectors & Reranking profiles
- [ ] macOS & Linux platform implementations & multi-OS CI release builds

---

## Documentation

- [Getting Started & User Guide](docs/getting-started.md) — Installing EmbedBay on Windows, running your first vector database, searching, visualizing, and backing up data.
- [System Architecture](docs/architecture.md) — Platform isolation (`backend/src/platform/`), process supervision, SQLite + Keyring storage, analytics, and IPC design.
- [Engines & Remote Adapters](docs/engines-and-adapters.md) — Tier 1 managed binaries, LanceDB/pgvector details, Tier 2 remote connection formats, and manifest updates.
- [Developer Guide](docs/development.md) — Toolchain setup, tests, UI theme tokens, and local build workflow.
- [Release & Packaging Guide](docs/releasing.md) — Updater keypair setup, NSIS/WiX installers, GitHub Actions CI/CD, and release verification.

---

## License, Privacy & Code Signing

- **License:** Released under the [MIT License](LICENSE).
- **Privacy:** EmbedBay collects zero telemetry, analytics, or crash reports. Local data is stored under `%LOCALAPPDATA%\com.embedbay.app`, and API keys live in Windows Credential Manager (`keyring`). See [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md) for full details.
- **Code Signing:** Free open-source Windows code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/) (enrolling after the `v0.1.0` initial public release).
