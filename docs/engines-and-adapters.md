# Engines & Remote Adapters

EmbedBay supports **Tier 1** locally managed or embedded engines and **Tier 2** remote vector databases through a shared `VectorDbAdapter` trait (`backend/src/adapters/mod.rs`).

---

## 1. Tier 1 Local Engines (`manifests/engines.json`)

| Engine | Binary / Mechanism | Default Ports | Health Probe | Notes |
| --- | --- | --- | --- | --- |
| **Qdrant** | `qdrant.exe` | HTTP `6333`, gRPC `6334` | `GET /healthz` | Generates isolated `config/qdrant.yaml` with local storage & snapshots paths; honors `log_level` & `enable_cors` config JSON overrides. |
| **Chroma** | `chroma.exe run` | HTTP `8000` | `GET /api/v2/heartbeat` | Standalone Rust CLI binary (`telemetry: false` snapshot written to `config/chroma.json`), zero Python/Docker required. Uses Chroma v2 REST API (`/api/v2/tenants/default_tenant/databases/default_database/collections`). |
| **PostgreSQL + pgvector** | `pgsql/bin/postgres.exe` + `vector.dll` | TCP `5432` | PostgreSQL `SELECT 1` (`tokio-postgres`) | Automatically initializes a UTF-8 cluster via `initdb` on first start, configures low-RAM defaults (`postgresql.auto.conf`), ensures `CREATE EXTENSION IF NOT EXISTS vector`, and stops cleanly via `pg_ctl stop -m fast`. |
| **LanceDB (Embedded)** | Zero-daemon local reader | None | In-process directory check | Opens `.lance` table directories (`_versions/*.manifest` + Arrow/Lance storage) directly with `0 MB` background daemon RAM. |

### Updating the Engine Manifest

Use `scripts/update-manifest.ts` to query upstream GitHub releases and recompute SHA-256 digests for `manifests/engines.json`:

```powershell
# Inspect latest upstream Windows binaries and hashes without writing
npx tsx scripts/update-manifest.ts

# Update manifests/engines.json in place
npx tsx scripts/update-manifest.ts --write
```

> **pgvector Windows Checksums:** EDB's portable `postgresql-17.9-1-windows-x64-binaries.zip` does not ship a `.sha256` sidecar file, so its manifest entry uses `"sha256": ""` while the paired `vector.v0.8.6-pg17.zip` archive is strictly SHA-256 verified and extracted into `pgsql/`.

---

## 2. Tier 2 Remote Adapters

Remote connections are managed via **Add Remote Connection** in the Explorer sidebar and persisted in SQLite (`remote_connections`) with secrets stored exclusively in OS Credential Manager.

| Adapter | File | Expected Endpoint Format | Secret / Auth | Extra JSON Options |
| --- | --- | --- | --- | --- |
| **Qdrant** | `adapters/qdrant.rs` | `https://your-cluster.qdrant.io:6333` | Optional `api-key` header | — |
| **Chroma** | `adapters/chroma.rs` | `http(s)://host:8000` | Optional Bearer/Token | — |
| **PostgreSQL + pgvector** | `adapters/pgvector.rs` | `postgresql://user:pass@host:5432/db?sslmode=require` | Optional password / URI credentials | Supports TLS via `rustls` (`webpki-roots`). |
| **Pinecone** | `adapters/pinecone.rs` | `https://your-index-host.svc.pinecone.io` | `Api-Key` header | `{"namespace": "", "control_plane_url": "https://api.pinecone.io"}` |
| **Weaviate** | `adapters/weaviate.rs` | `https://your-cluster.weaviate.network` | Bearer token (`Authorization`) | Uses Weaviate v1 schema/objects + GraphQL `Get` vector queries. |
| **Milvus / Zilliz** | `adapters/milvus.rs` | `https://in01-xxxx.serverless.zilliz.com` | Bearer token | `{"dbName": "default"}` (v2 REST API). |
| **Elasticsearch** | `adapters/elasticsearch.rs` | `https://localhost:9200` | `ApiKey` (`auth_type: "api_key"`) or `Bearer` / `Basic` | Uses ES 8.x+ `dense_vector` + kNN search APIs. |
| **Redis Stack** | `adapters/redis_stack.rs` | `redis://127.0.0.1:6379` | Optional password injected cleanly | Uses RediSearch `FT._LIST`, `FT.INFO`, `FT.CREATE`, `FT.SEARCH ... KNN`. |

---

## 3. Embedding Profiles (`adapters/embeddings.rs`)

Configure any number of Embedding Profiles in **Settings -> Embedding Profiles** to convert plain-text queries (in **Search Playground**) and imported rows (in **Import / Export**) into dense vectors:

- **Ollama:** `http://127.0.0.1:11434` (`/api/embed`, falls back cleanly for older Ollama versions if needed).
- **OpenAI-compatible:** Any `/v1/embeddings` endpoint (`https://api.openai.com/v1`, LM Studio, vLLM, LocalAI, OpenRouter, etc.) with optional Bearer key stored in the OS keyring.
