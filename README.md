<div align="center">
  <img src="installer/icons/128x128.png" width="84" height="84" alt="EmbedBay logo" />
  <h1>EmbedBay</h1>
  <p><strong>Zero-Docker native vector database manager, runtime supervisor, and multi-engine explorer.</strong></p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Platform-Windows%20x64-0078D6.svg" alt="Platform: Windows x64" />
    <img src="https://img.shields.io/badge/Stack-Tauri%20v2%20%C2%B7%20Rust%20%C2%B7%20React%2019-14b8a6.svg" alt="Tauri v2, Rust, React 19" />
    <a href="https://github.com/HeronKyaw/embedbay/releases"><img src="https://img.shields.io/github/v/release/HeronKyaw/embedbay?include_prereleases&label=Release" alt="Latest Release" /></a>
  </p>
  <p>
    <a href="#features">Features</a> ·
    <a href="#supported-engines">Supported Engines</a> ·
    <a href="#installation">Installation</a> ·
    <a href="#development">Development</a> ·
    <a href="#roadmap">Roadmap</a> ·
    <a href="#documentation">Docs</a>
  </p>
</div>

EmbedBay installs, runs, monitors, and explores local and remote vector databases natively on Windows—without Docker Desktop or heavy Electron runtimes. Built with Tauri v2, Rust, and React 19, it stays local-first with zero telemetry and stores API credentials strictly in the OS keyring.

---

## Features

### Native Runtime & Supervision
- **One-Click Engine Store** — Downloads official native binaries over HTTPS, verifies SHA-256 checksums, and isolates versions cleanly.
- **Silent Process Management** — Runs background engines with zero console window flashes, automatic port conflict suggestions, health polling, and crash restarts.
- **System Tray & Idle Auto-Stop** — Reclaims UI RAM when closed to the tray, tracks live CPU/RAM/disk metrics and rotating logs, and stops idle instances automatically.
- **Safe Backup & Restore** — Stops running instances before zipping data directories to guarantee consistent snapshots.

### Multi-Tab Explorer & Organization
- **Side-by-Side Collections** — Browse schemas, stats, and large vector tables across multiple local or remote tabs with a dedicated JSON record inspector.
- **Index & Schema Controls** — Inspect, create, and drop Qdrant payload indexes and pgvector HNSW / IVFFlat indexes directly in the UI.
- **Groups, Tags & Read-Only Mode** — Organize instances into collapsible groups (with bulk start/stop), filter by color tags, and lock production clusters against accidental writes.

### Search, Ingestion & Migration
- **Search Playground & A/B Compare** — Run vector or plain-text queries, filter metadata, inspect latency histograms, and compare two queries or collections side-by-side.
- **History, Presets & Code Snippets** — Save reusable search presets, browse per-collection history, and copy Python, TypeScript, `curl`, or SQL snippets (with placeholder env vars).
- **Ingestion & Cross-Engine Migration** — Preview recursive or Markdown-header chunking for `.md` / `.txt` files, import/export JSONL and CSV, and migrate/re-embed collections across engines.

### Visualization, Embeddings & Security
- **2D/3D WebGL Visualizer** — Explore vector clusters interactively with Rust-native PCA and UMAP dimensionality reduction.
- **6 Embedding Providers** — Connect Ollama, OpenAI-compatible APIs, Google Gemini, Cohere, Voyage AI, or HuggingFace TEI.
- **Keyring Security & Auto-Updater** — Keeps remote tokens in Windows Credential Manager (never plaintext in SQLite), supports Light/Dark/Auto themes, and verifies updates cryptographically.

---

## Supported Engines

| Engine | Local Mode | Remote | Default Port |
| --- | --- | --- | --- |
| **Qdrant** | Native daemon (`qdrant.exe`) | HTTP / HTTPS | `6333`, `6334` (gRPC) |
| **Chroma** | Native CLI daemon (`chroma.exe`) | HTTP / HTTPS | `8000` |
| **PostgreSQL + pgvector** | Portable `postgres.exe` + `vector.dll` | `postgresql://` (+ TLS) | `5432` |
| **Meilisearch** | Native daemon (`meilisearch.exe`) | HTTP / HTTPS | `7700` |
| **SurrealDB** | Native daemon (`surreal.exe` + SurrealKV) | HTTP / HTTPS | `8008` |
| **Elasticsearch** | Bundled-JDK daemon | HTTP / HTTPS | `9200` |
| **OpenSearch** | Bundled-JDK daemon | HTTP / HTTPS | `9201` |
| **MariaDB 11.8 Vector** | Portable `mariadbd.exe` | `mysql://` (+ TLS) | `3306` |
| **LanceDB** | Embedded directory (`0 MB` idle RAM) | — | None |
| **SQLite + sqlite-vec** | Embedded `vec0` (`0 MB` idle RAM) | — | None |
| **DuckDB + vss** | On-demand CLI (`0 MB` idle RAM) | — | None |
| **Pinecone** | — | HTTPS | — |
| **Weaviate** | — | HTTP / HTTPS | — |
| **Milvus / Zilliz** | — | HTTP / HTTPS | — |
| **Redis Stack** | — | Redis (`FT.SEARCH`) | — |

> *Note: Embedded LanceDB uses EmbedBay's portable directory format (`records.jsonl`) in v0.1 ahead of native binary `.lance` / Arrow support in v0.2.*

---

## Installation

Download the latest Windows `x64` installer from [GitHub Releases](https://github.com/HeronKyaw/embedbay/releases):
- **Recommended (Per-User):** `EmbedBay_<version>_x64-setup.exe` (NSIS installer, no admin prompt required)
- **Enterprise / MSI:** `EmbedBay_<version>_x64_en-US.msi` (WiX installer)

Requires Windows 10/11 (`x86_64`) and Microsoft Edge WebView2 Runtime (pre-installed on Windows 11). See the [Getting Started Guide](docs/getting-started.md) for your first database setup.

---

## Development

**Prerequisites:** Node.js 22+, Rust stable toolchain (`x86_64-pc-windows-msvc`), and WebView2 Runtime.

```powershell
# Install workspace Tauri CLI and frontend dependencies
npm install
npm --prefix frontend install

# Launch desktop app in hot-reload dev mode
npm run dev

# Run backend Rust tests & verify production frontend build
npm run backend:test
npm run frontend:build
```

<details>
<summary>Repository Structure</summary>

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

</details>

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full milestone breakdown.

- **v0.1 — Windows Launch (Complete):** All 11 local/embedded engines, 12 remote adapters, process supervisor & tray persistence, multi-tab Explorer, Search Playground + A/B compare, `.md`/`.txt` chunking, cross-engine migration, 2D/3D PCA/UMAP visualizer, and Qdrant/pgvector index management.
- **v0.2 — Engine & Ingestion Depth:** Native binary `.lance` & `.parquet` support, zero-setup local ONNX embeddings (`local_onnx`), PDF ingestion, and visualizer query/top-K overlay.
- **Future / Exploring:** Local MCP Server for AI coding agents, hybrid dense + sparse/BM25 search with RRF & reranking, and macOS/Linux support.

---

## Documentation

| Guide | Covers |
| --- | --- |
| [Getting Started](docs/getting-started.md) | Installing EmbedBay, launching your first engine, searching, visualizing, and backups |
| [System Architecture](docs/architecture.md) | Platform isolation, process supervision, SQLite + Keyring storage, and analytics |
| [Engines & Remote Adapters](docs/engines-and-adapters.md) | Tier 1 local binaries, embedded engines, Tier 2 remote connections, and manifest updates |
| [Developer Guide](docs/development.md) | Toolchain setup, testing conventions, theme tokens, and unsigned local builds |
| [Release & Packaging Guide](docs/releasing.md) | Updater keypair, SignPath Foundation setup, NSIS/WiX installers, and CI/CD |

---

## License, Privacy & Code Signing

- **License:** Released under the [MIT License](LICENSE).
- **Privacy:** Zero telemetry, analytics, or crash reporting. Data is stored locally under `%LOCALAPPDATA%\com.embedbay.app`, and secrets stay in Windows Credential Manager (`keyring`). See [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md) for full details.
- **Code Signing:** Free open-source Windows code signing provided by [SignPath.io](https://signpath.io/), certificate by [SignPath Foundation](https://signpath.org/) (enrolling after the `v0.1.0` initial public release).
