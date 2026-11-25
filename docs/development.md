# Developer Guide

## 1. Prerequisites

- **OS:** Windows 10/11 (`x86_64`) — Primary target (macOS and Linux OS modules are stubbed in `backend/src/platform/{macos,linux}.rs` for future phases).
- **Node.js:** v22+ with `npm`.
- **Rust:** Stable toolchain (`rustup target add x86_64-pc-windows-msvc`).
- **WebView2:** Pre-installed on Windows 11; install Microsoft Edge WebView2 Evergreen Runtime on Windows 10 if needed.

---

## 2. Installing Dependencies & Running Locally

```powershell
# 1. Install workspace Tauri CLI (@tauri-apps/cli)
npm install

# 2. Install frontend packages (React 19, Vite 6, Tailwind CSS v4, Plotly, TanStack)
npm --prefix frontend install

# 3. Launch full Tauri app in hot-reload development mode
npm run dev
```

Root convenience scripts in `package.json`:

| Script | Command | Purpose |
| --- | --- | --- |
| `npm run dev` | `cd backend && npx tauri dev` | Launches Vite dev server + Rust backend + Tauri desktop window |
| `npm run build` | `cd backend && npx tauri build` | Builds frontend (`npm --prefix frontend run build`) + release installers |
| `npm run frontend:build` | `npm --prefix frontend run build` | Runs `tsc -b && vite build` |
| `npm run backend:check` | `cargo check --manifest-path backend/Cargo.toml` | Fast Rust compile check |
| `npm run backend:test` | `cargo test --manifest-path backend/Cargo.toml` | Runs all Rust unit tests |

---

## 3. Building Local Windows Installers Without Release Signing Keys

`backend/tauri.conf.json` has `"createUpdaterArtifacts": true`, which expects `TAURI_SIGNING_PRIVATE_KEY` during `tauri build`. For local unsigned builds without a signing key:

1. Create a temporary JSON override file `backend/tauri.local-build.json`:
   ```json
   {
     "bundle": {
       "createUpdaterArtifacts": false
     }
   }
   ```
2. Run Tauri build from `backend/`:
   ```powershell
   Push-Location backend
   ..\node_modules\.bin\tauri.cmd build --config tauri.local-build.json --ci
   Pop-Location
   ```
3. Delete `backend/tauri.local-build.json` and run verification:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1
   ```

Outputs are written to:
- `backend/target/release/bundle/nsis/EmbedBay_<ver>_x64-setup.exe`
- `backend/target/release/bundle/msi/EmbedBay_<ver>_x64_en-US.msi`

---

## 4. Engineering Conventions & Testing Notes

- **Directory Layout:** Always keep `frontend/` and `backend/` separate—never create `src-tauri/`. Note that Tauri CLI executes `build.beforeDevCommand` and `build.beforeBuildCommand` from the repo root (`npm --prefix frontend ...`), whereas bundle paths (`frontendDist`, `icon`, `installerHooks`, `fragmentPaths`) resolve relative to `backend/tauri.conf.json`.
- **Platform Isolation:** Keep all `std::os::windows` and `windows_sys` imports inside `backend/src/platform/windows.rs`. Spawned DB commands must pass `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`.
- **Windows Unit Tests & `EventSink`:** Core supervisor/command/engine modules emit UI notifications through `supervisor::EventSink` (`TauriEventSink` lives in `backend/src/lib.rs`) and do not import `tauri::AppHandle` directly, avoiding Windows `comctl32.dll` manifest errors in `cargo test` binaries.
- **No Plaintext Secrets:** Store secrets strictly through `backend/src/platform/secrets.rs` (`keyring`). Under `#[cfg(test)]`, `secrets.rs` uses an isolated in-memory store so tests never pollute Windows Credential Manager.
- **Theme Tokens:** Dark (`Deep Harbor Charcoal + Bay Teal`) and Light CSS custom properties + the 8 preset swatches live in `frontend/app/styles/theme.css`.
