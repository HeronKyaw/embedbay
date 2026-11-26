# EmbedBay Roadmap

EmbedBay is a zero-Docker native vector database manager, runtime supervisor, and multi-engine explorer built with Tauri v2, Rust, and React 19.

---

## v0.1 — Windows Launch

### Core Platform & Runtime Supervision
- **Native Engine Store (`manifests/engines.json`):** One-click download, SHA-256 verification, Zip-Slip-safe archive extraction, and versioned isolation for Qdrant, Chroma, PostgreSQL + pgvector, Meilisearch, SurrealDB, Elasticsearch, OpenSearch, MariaDB 11.8 Vector, plus embedded LanceDB, SQLite + sqlite-vec, and DuckDB + vss.
- **Process Supervisor (`CREATE_NO_WINDOW`):** Hidden Win32 child process spawning (`0x08000000 | 0x00000200`), TCP port conflict detection + suggestions, health polling, exponential-backoff crash recovery, graceful shutdown (`CTRL_BREAK_EVENT` / `pg_ctl stop` / `mariadb-admin shutdown`) with Windows process-tree termination (`taskkill /T /F`) for bundled-JDK / child-tree engines, rotating log ring buffer, and `sysinfo` CPU/RAM/disk telemetry.
- **System Tray & Storage:** Destroy-on-close WebView RAM reclamation, `--minimized` autostart, per-instance idle auto-stop, stop-before-zip Backup & Restore, OS Keyring credential storage (`keyring`), and signed `tauri-plugin-updater` updates.
- **Multi-Engine Explorer:** Unified `VectorDbAdapter` across Tier 1 local engines and Tier 2 remote clusters (Qdrant, Chroma, pgvector, Meilisearch, SurrealDB, Elasticsearch, OpenSearch, MariaDB 11.8 Vector, Pinecone, Weaviate, Milvus/Zilliz, Redis Stack), Groups & color-coded Tags, virtualized record table, JSON metadata drawer, and 2D/3D WebGL PCA/UMAP scatter plot.

### v0.1 Launch Feature Set
- **Read-Only / Production Safety Mode:** Per-connection `read_only` flag enforced on both backend mutating commands and frontend explorer controls to protect production clusters from accidental writes or deletes.
- **Copy-as-Code Snippets:** One-click Python, TypeScript, `curl`, and `psql`/SQL connection and search query snippets with placeholder env-var credentials (never leaking keyring secrets).
- **Expanded HTTP Embedding Providers:** Support for **Ollama**, **OpenAI-Compatible**, **Google Gemini**, **Cohere**, **Voyage AI**, and **HuggingFace Text Embeddings Inference (TEI)** via `reqwest` + OS Keyring.
- **Search History & Saved Presets:** Automatic per-collection search history (pruned to the latest 100 entries) and named reusable search presets with filters, thresholds, and parameters.
- **Side-by-Side A/B Search Comparison:** Concurrent two-panel comparison with overlap count, Jaccard similarity, latency delta, and per-hit rank-delta badges.
- **Collection Migration & Re-Embedding Wizard:** Guided cross-instance/cross-engine collection migration with optional metadata filtering and batch re-embedding via any configured embedding profile.
- **Document Ingestion & Chunking Previewer (`.md` / `.txt`):** Recursive character and Markdown-header-aware chunking with live chunk preview before embedding and upserting.
- **Index & Schema Management:** Inspect, create, and drop Qdrant payload indexes and pgvector HNSW / IVFFlat indexes directly from the Explorer.

> [!NOTE]
> **Embedded LanceDB Format in v0.1:** Embedded LanceDB instances currently use EmbedBay's portable directory format (`data/records.jsonl` + `_embedbay_schema.json` + minimal `_versions/*.manifest`) ahead of native binary Arrow/Lance support in v0.2.

---

## v0.2 — Engine & Ingestion Depth

- **Native Binary `.lance` & `.parquet` Support:** Integrate native `lancedb` / Arrow binary table reader/writer and `.parquet` import/export.
- **Zero-Setup Local ONNX Embeddings (`local_onnx`):** On-demand Engine Store download for local ONNX embedding models without requiring an external daemon.
- **PDF Document Ingestion:** Native `.pdf` parsing and page/section metadata extraction inside the Document Ingestion pipeline.
- **Visualizer Query Overlay:** Project the active search query vector and top-K result hits directly onto the 2D/3D PCA/UMAP scatter plot.

---

## Future / Exploring

- **Local MCP Server Integration:** Expose managed local instances and read/search collections as Model Context Protocol (MCP) tools for AI coding agents.
- **Hybrid Search, Named Vectors & Reranking:** Dense + sparse/BM25 fusion (RRF), multi-vector / named-vector schema support, and cross-encoder reranking profiles.
- **macOS & Linux Support:** Complete `backend/src/platform/macos.rs` and `backend/src/platform/linux.rs`, multi-OS engine manifests, and automated CI release builds.
