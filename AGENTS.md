# EmbedBay Agent Rules
- Follow [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md) as the engineering reference.
- Folder layout MUST stay `frontend/` and `backend/` (never create `src-tauri/`).
- Keep all OS-specific Rust code inside `backend/src/platform/`.
- On Windows, always spawn child DB processes with `CREATE_NO_WINDOW` (`0x08000000`).
- Use the Dark/Light CSS tokens defined in `frontend/app/styles/theme.css`.
- Before finishing any change, run `cargo test --manifest-path backend/Cargo.toml` and `npm --prefix frontend run build`.
