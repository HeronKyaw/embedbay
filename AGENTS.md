# EmbedBay Agent Rules
- Follow `PLAN.md` strictly as the source of truth.
- Folder layout MUST stay `frontend/` and `backend/` (never create `src-tauri/`).
- Keep all OS-specific Rust code inside `backend/src/platform/`.
- On Windows, always spawn child DB processes with `CREATE\_NO\_WINDOW` (`0x08000000`).
- Use the exact Dark/Light CSS tokens in `PLAN.md` Section 6.1.
- Before finishing any phase, run `cargo check` / `cargo test` in `backend/` and `npm run build` in `frontend/`.
