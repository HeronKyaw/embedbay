# EmbedBay Release Integrity, Signing & Privacy Policy

## 1. Release Integrity Overview

EmbedBay is an open-source, MIT-licensed Windows desktop application built directly from public tagged commits in GitHub Actions (`.github/workflows/release-windows.yml`).

- **Windows Installers (`.exe` / `.msi`):** Currently distributed **without a commercial Authenticode certificate** (community open-source release). On first launch, Windows SmartScreen may display *"Windows protected your PC"* — click **More info → Run anyway** after verifying the SHA-256 checksum from the GitHub Release page.
- **In-App Auto-Updater:** All self-updates delivered via `tauri-plugin-updater` are cryptographically signed with EmbedBay's Ed25519 release key and verified against `plugins.updater.pubkey` in `backend/tauri.conf.json` before installation.
- **Engine Downloads:** Local vector database binaries downloaded through the Engine Store are fetched directly from upstream HTTPS release URLs in `manifests/engines.json` and verified against pinned SHA-256 checksums before extraction.

---

## 2. Team & Roles

| Role | Member | Responsibility |
| --- | --- | --- |
| **Project Maintainer / Owner** | Wunna Kyaw ([@HeronKyaw](https://github.com/HeronKyaw)) | Repository administration, code review, release tagging |
| **Committers / Reviewers** | Wunna Kyaw ([@HeronKyaw](https://github.com/HeronKyaw)) | Reviewing and merging changes into `main` |

External contributions submitted via Pull Requests are reviewed by a maintainer before merging into `main`.

---

## 3. Build Provenance

- Official Windows releases are built exclusively from tagged commits (`v*.*.*`) on the public [`HeronKyaw/embedbay`](https://github.com/HeronKyaw/embedbay) GitHub repository via GitHub Actions (`.github/workflows/release-windows.yml`).
- The CI pipeline runs `cargo test --manifest-path backend/Cargo.toml`, `npm --prefix frontend test`, and `npm --prefix frontend run build` prior to packaging the NSIS and WiX MSI installers.

---

## 4. Scope of Distributed Artifacts

### Built & Published by EmbedBay CI
- `embedbay.exe` — Main Tauri v2 desktop application binary compiled from this repository
- `EmbedBay_<version>_x64-setup.exe` — Windows NSIS per-user installer
- `EmbedBay_<version>_x64_en-US.msi` — Windows WiX MSI installer
- `latest.json` & `.sig` — Ed25519-signed Tauri auto-updater metadata

### Not Bundled by EmbedBay
EmbedBay **does not** bundle third-party database binaries inside its installers. Local Tier 1 engines (Qdrant, Chroma, PostgreSQL + pgvector, Meilisearch, SurrealDB, Elasticsearch, OpenSearch, MariaDB 11.8 Vector, and DuckDB + vss) are downloaded on demand by the user directly from their official upstream HTTPS release URLs listed in `manifests/engines.json`, and every download is verified against its pinned SHA-256 checksum before extraction.

---

## 5. Privacy Policy (Zero-Telemetry Disclosure)

EmbedBay is a local-first desktop application designed to manage and inspect vector databases on your own machine or your own configured infrastructure.

- **No Telemetry or Analytics:** EmbedBay collects **no** usage analytics, crash telemetry, tracking identifiers, or behavioral metrics, and does not transmit data to EmbedBay authors or third-party analytics services.
- **Network Connections Initiated by EmbedBay:**
  1. **Engine Downloads:** When you click *Install* in the Engine Store, EmbedBay downloads the requested engine archive directly from the upstream HTTPS URL in `manifests/engines.json` and verifies its SHA-256 digest.
  2. **Auto-Updater Checks:** `tauri-plugin-updater` queries `https://github.com/HeronKyaw/embedbay/releases/latest/download/latest.json` and verifies any update payload against the bundled Ed25519 public key (`plugins.updater.pubkey` in `backend/tauri.conf.json`).
  3. **User-Configured Connections & Embeddings:** Remote vector database adapters and HTTP embedding profiles (Ollama, OpenAI-compatible, Google Gemini, Cohere, Voyage AI, HuggingFace TEI) connect only to endpoints you explicitly configure and invoke.
- **Local Storage & Credentials:** Application metadata and instance configurations reside locally under `%LOCALAPPDATA%\com.embedbay.app`. Remote API keys and tokens are stored in **Windows Credential Manager** via the OS keyring (`keyring`) and are never written in plaintext to SQLite or log files.

---

## 6. Security & Incident Reporting

If you discover a security vulnerability, suspect a compromised release artifact, or need to report abuse, please open a private report via [GitHub Security Advisories](https://github.com/HeronKyaw/embedbay/security/advisories/new).
