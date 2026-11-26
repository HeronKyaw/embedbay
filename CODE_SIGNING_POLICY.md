# EmbedBay Code Signing & Privacy Policy

## 1. Code Signing Overview & Attribution

Free code signing provided by [SignPath.io](https://signpath.io/), using a code signing certificate provided by the [SignPath Foundation](https://signpath.org/).

> **Note on Initial Release (`v0.1.0`):** SignPath Foundation requires an already-published public open-source release in the target distribution format before reviewing an organization application. Accordingly, `v0.1.0` is published without an Authenticode signature solely to establish initial public availability; once approved by SignPath Foundation, official Windows release builds (`v0.1.1+`) will be signed automatically through SignPath.io.

---

## 2. Team & Roles

| Role | Member | Responsibility |
| --- | --- | --- |
| **Project Maintainer / Owner** | Wunna Kyaw ([@HeronKyaw](https://github.com/HeronKyaw)) | Repository administration, code review, release tagging |
| **Committers / Reviewers** | Wunna Kyaw ([@HeronKyaw](https://github.com/HeronKyaw)) | Reviewing and merging changes into `main` |
| **Signing Approvers** | Wunna Kyaw ([@HeronKyaw](https://github.com/HeronKyaw)) | Approving production signing requests in SignPath.io |

External contributions submitted via Pull Requests are reviewed by a maintainer before merging into `main`.

---

## 3. Build Provenance & Signing Pipeline

- Official Windows releases are built exclusively from tagged commits on the public [`HeronKyaw/embedbay`](https://github.com/HeronKyaw/embedbay) GitHub repository via GitHub Actions (`.github/workflows/release-windows.yml`).
- Build artifacts are never signed from local developer workstations using a SignPath certificate.
- Production signing requests submitted from CI require explicit approver sign-off in SignPath.io before release artifacts are published.

---

## 4. Scope of Signed Artifacts

### Signed by EmbedBay (once enrolled with SignPath Foundation)
- `embedbay.exe` — Main Tauri v2 desktop application binary compiled from this repository
- `EmbedBay_<version>_x64-setup.exe` — Windows NSIS per-user installer
- `EmbedBay_<version>_x64_en-US.msi` — Windows WiX MSI installer

### Not Bundled or Signed by EmbedBay
EmbedBay **does not** bundle or re-sign third-party database binaries or runtimes inside its installers. Local Tier 1 engines (Qdrant, Chroma, PostgreSQL + pgvector, Meilisearch, SurrealDB, Elasticsearch, OpenSearch, MariaDB 11.8 Vector, and DuckDB + vss) are downloaded on demand by the user directly from their official upstream HTTPS release URLs listed in `manifests/engines.json`, and every download is verified against its pinned SHA-256 checksum before extraction.

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
