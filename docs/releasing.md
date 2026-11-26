# Releasing EmbedBay (Windows)

This document covers preparing cryptographic update signing keys, optional Windows Authenticode signing, GitHub Actions CI/CD, and release verification.

---

## 1. Configure Tauri Auto-Updater Keys & Endpoint

EmbedBay ships `tauri-plugin-updater` configured in `backend/tauri.conf.json`. **Before publishing your first production release**, replace the placeholder public key and repository URL:

1. Generate an Ed25519 signing keypair locally (never commit the private key):
   ```powershell
   npx tauri signer generate -w $HOME\.tauri\embedbay.key
   ```
2. Copy the generated base64 **public key** into `backend/tauri.conf.json` under `plugins.updater.pubkey`.
3. Update `plugins.updater.endpoints` in `backend/tauri.conf.json` to point at your real GitHub repository:
   ```json
   "endpoints": [
     "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
   ]
   ```
4. Add the private key and password to **GitHub Repository Secrets**:
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `$HOME\.tauri\embedbay.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — passphrase used when generating the key

---

## 2. Optional Windows Authenticode Code Signing

Without an Authenticode signature, Windows SmartScreen warns users on first launch.

### Option A: SignPath Foundation (Free for Open Source — Recommended)

EmbedBay uses the [MIT License](../LICENSE) and documents its build provenance and zero-telemetry guarantee in [CODE_SIGNING_POLICY.md](../CODE_SIGNING_POLICY.md) to qualify for free open-source Authenticode signing via [SignPath Foundation](https://signpath.org/):

1. **Publish an initial public release (`v0.1.0`):** SignPath Foundation requires an already-published open-source release in the target distribution format (`.exe` / `.msi`) before reviewing an application.
2. **Apply at [`https://signpath.org/apply`](https://signpath.org/apply):** Reference `https://github.com/HeronKyaw/embedbay`, `LICENSE`, `CODE_SIGNING_POLICY.md`, and the published `v0.1.0` release.
3. **Configure GitHub Secrets (once approved):**
   - `SIGNPATH_API_TOKEN`
   - `SIGNPATH_ORG_ID`
   - `SIGNPATH_PROJECT_SLUG`
4. **CI Order of Operations with `tauri-plugin-updater`:** Because SignPath signs artifacts asynchronously via `signpath/github-action-submit-signing-request` rather than a local `signtool` command, the CI pipeline for `v0.1.1+` must follow this sequence:
   1. Build unsigned Windows installers (`.exe` / `.msi`) via Tauri.
   2. Upload and submit the installers to `signpath/github-action-submit-signing-request` and download the SignPath-signed installers.
   3. Generate Tauri updater `.sig` files and `latest.json` against the **SignPath-signed** installers using `TAURI_SIGNING_PRIVATE_KEY` (`tauri signer sign`), then upload everything to the GitHub Release.

### Option B: Commercial Certificate or Azure Artifact Signing

1. Obtain an EV / OV code-signing certificate or Azure Artifact Signing setup.
2. Store certificate secrets (`WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`, or Azure credentials) in GitHub Secrets.
3. Configure `bundle.windows.signCommand` in `backend/tauri.conf.json` and uncomment the certificate env vars in `.github/workflows/release-windows.yml`.

---

## 3. Automated CI/CD Workflow (`.github/workflows/release-windows.yml`)

The workflow triggers automatically on version tags matching `v*.*.*` (or manually via `workflow_dispatch`):

1. Checks out the repository and installs Node 22 + Rust (`x86_64-pc-windows-msvc`).
2. Runs `cargo test --manifest-path backend/Cargo.toml` and `npm --prefix frontend run build`.
3. Executes `tauri-apps/tauri-action@v0` targeting `projectPath: backend` with `includeUpdaterJson: true`.
4. Uploads `EmbedBay_<ver>_x64-setup.exe`, `EmbedBay_<ver>_x64_en-US.msi`, `.sig` updater signatures, and `latest.json` into a **draft GitHub Release**.

Ensure the version in `package.json`, `frontend/package.json`, `backend/Cargo.toml`, and `backend/tauri.conf.json` matches the git tag (e.g., `0.1.0` for `v0.1.0`).

---

## 4. Installer Customization Details

- **NSIS Hooks (`installer/windows/nsis/hooks.nsh`):**
  - `NSIS_HOOK_PREINSTALL` terminates any background tray `EmbedBay.exe` process before overwriting files during interactive/silent upgrades.
  - `NSIS_HOOK_PREUNINSTALL` skips prompts when running silently (`IfSilent keepData`) and otherwise prompts users whether to keep or delete `%LOCALAPPDATA%\com.embedbay.app` and `%LOCALAPPDATA%\EmbedBay`.
- **WiX Fragment (`installer/windows/wix/embedbay-registry.wxs`):**
  - Pins a fixed `upgradeCode` (`7C3D4A1E-8B2F-4F1A-9D6C-5E8A1B2C3D4E`) in `backend/tauri.conf.json` for clean MSI in-place upgrades and writes `HKCU\Software\EmbedBay` metadata via `EmbedBayRegistryComponent`.
- **Verification Script:**
  Run `powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1` after building to verify `.exe` + `.msi` artifact paths, file sizes, SHA-256 checksums, and Authenticode signature status.
