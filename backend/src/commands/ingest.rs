use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use uuid::Uuid;

use crate::adapters::embeddings;
use crate::adapters::{assert_writable, resolve_adapter, ConnectionTarget, VectorRecord};
use crate::commands::transfer::TransferProgressEvent;
use crate::db::Database;
use crate::platform::secrets;
use crate::supervisor::process_manager::ProcessManager;
use crate::supervisor::EventSink;
use crate::AppState;

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "__pycache__",
];

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChunkStrategy {
    Recursive,
    MarkdownHeaders,
}

impl Default for ChunkStrategy {
    fn default() -> Self {
        Self::MarkdownHeaders
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChunkOptions {
    #[serde(default)]
    pub strategy: ChunkStrategy,
    #[serde(default = "default_chunk_size")]
    pub chunk_size: usize,
    #[serde(default = "default_chunk_overlap")]
    pub chunk_overlap: usize,
}

fn default_chunk_size() -> usize {
    800
}

fn default_chunk_overlap() -> usize {
    120
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentChunk {
    pub source_file: String,
    pub file_name: String,
    pub chunk_index: usize,
    pub heading: Option<String>,
    pub text: String,
    pub char_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentChunkPreview {
    pub total_files: usize,
    pub total_chunks: usize,
    pub avg_chunk_length: usize,
    pub chunks: Vec<DocumentChunk>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IngestResult {
    pub files_processed: usize,
    pub chunks_ingested: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

fn emit_ingest_progress(sink: Option<&dyn EventSink>, evt: TransferProgressEvent) {
    if let Some(s) = sink {
        if let Ok(val) = serde_json::to_value(evt) {
            s.emit_json("transfer-progress", val);
        }
    }
}

fn is_supported_doc(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("md") | Some("txt")
    )
}

fn should_skip_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    name.starts_with('.') || IGNORED_DIRS.contains(&name)
}

fn walk_dir_docs(dir: &Path, out: &mut BTreeSet<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if !should_skip_dir(&path) {
                walk_dir_docs(&path, out)?;
            }
        } else if path.is_file() && is_supported_doc(&path) {
            out.insert(path);
        }
    }
    Ok(())
}

pub fn collect_document_files(paths: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut set = BTreeSet::new();
    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let p = PathBuf::from(trimmed);
        if p.is_dir() {
            walk_dir_docs(&p, &mut set)?;
        } else if p.is_file() {
            if is_supported_doc(&p) {
                set.insert(p);
            }
        } else {
            return Err(format!("Path does not exist: {}", trimmed));
        }
    }
    Ok(set.into_iter().collect())
}

fn take_tail_chars(s: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let total = s.chars().count();
    if total <= max_chars {
        return s.to_string();
    }
    s.chars().skip(total - max_chars).collect()
}

fn split_units_by_separator(text: &str, sep: &str) -> Vec<String> {
    if sep.is_empty() {
        return text.chars().map(|c| c.to_string()).collect();
    }
    let parts: Vec<&str> = text.split(sep).collect();
    let mut out = Vec::with_capacity(parts.len());
    for (idx, part) in parts.iter().enumerate() {
        if idx + 1 < parts.len() {
            out.push(format!("{}{}", part, sep));
        } else if !part.is_empty() {
            out.push((*part).to_string());
        }
    }
    out
}

fn split_with_separators(text: &str, max_size: usize, seps: &[&str]) -> Vec<String> {
    if text.chars().count() <= max_size {
        return vec![text.to_string()];
    }
    let Some((&sep, rest)) = seps.split_first() else {
        // Hard char-boundary fallback
        let chars: Vec<char> = text.chars().collect();
        return chars
            .chunks(max_size)
            .map(|c| c.iter().collect::<String>())
            .collect();
    };

    let units = split_units_by_separator(text, sep);
    if units.len() <= 1 {
        return split_with_separators(text, max_size, rest);
    }

    let mut pieces = Vec::new();
    let mut current = String::new();
    let mut current_len = 0usize;

    for unit in units {
        let u_len = unit.chars().count();
        if u_len > max_size {
            if !current.trim().is_empty() {
                pieces.push(current.trim().to_string());
                current.clear();
                current_len = 0;
            }
            pieces.extend(split_with_separators(&unit, max_size, rest));
            continue;
        }
        if current_len + u_len > max_size && !current.trim().is_empty() {
            pieces.push(current.trim().to_string());
            current.clear();
            current_len = 0;
        }
        current.push_str(&unit);
        current_len += u_len;
    }

    if !current.trim().is_empty() {
        pieces.push(current.trim().to_string());
    }
    pieces
}

pub fn recursive_split(text: &str, chunk_size: usize, chunk_overlap: usize) -> Vec<String> {
    let size = chunk_size.clamp(64, 16_000);
    let overlap = chunk_overlap.min(size.saturating_sub(1) / 2);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let base_pieces = split_with_separators(trimmed, size, &["\n\n", "\n", ". ", " "]);
    if overlap == 0 || base_pieces.len() <= 1 {
        return base_pieces
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }

    let mut out = Vec::with_capacity(base_pieces.len());
    for (idx, piece) in base_pieces.into_iter().enumerate() {
        let clean = piece.trim();
        if clean.is_empty() {
            continue;
        }
        if idx == 0 {
            out.push(clean.to_string());
        } else {
            let prev = out.last().map(|s| s.as_str()).unwrap_or("");
            let tail = take_tail_chars(prev, overlap);
            let tail_trimmed = tail.trim_start();
            let combined = if tail_trimmed.is_empty() {
                clean.to_string()
            } else {
                format!("{}\n{}", tail_trimmed, clean)
            };
            // Ensure combined stays bounded within size + overlap
            if combined.chars().count() > size + overlap {
                out.push(clean.to_string());
            } else {
                out.push(combined);
            }
        }
    }
    out
}

fn parse_markdown_heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('#') {
        return None;
    }
    let level = trimmed.bytes().take_while(|&b| b == b'#').count();
    if level == 0 || level > 3 {
        return None;
    }
    let after = &trimmed[level..];
    if !after.starts_with(' ') && !after.starts_with('\t') {
        return None;
    }
    let title = after.trim().trim_end_matches('#').trim().to_string();
    if title.is_empty() {
        None
    } else {
        Some((level, title))
    }
}

pub fn markdown_headers_split(
    text: &str,
    chunk_size: usize,
    chunk_overlap: usize,
) -> Vec<(Option<String>, String)> {
    let mut sections: Vec<(Option<String>, String)> = Vec::new();
    let mut stack: [Option<String>; 3] = [None, None, None];
    let mut buf = String::new();
    let mut in_fence = false;

    let current_breadcrumb = |st: &[Option<String>; 3]| -> Option<String> {
        let parts: Vec<&str> = st.iter().filter_map(|x| x.as_deref()).collect();
        if parts.is_empty() {
            None
        } else {
            Some(parts.join(" > "))
        }
    };

    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
        }

        if !in_fence {
            if let Some((level, title)) = parse_markdown_heading(line) {
                if !buf.trim().is_empty() {
                    sections.push((current_breadcrumb(&stack), buf.trim().to_string()));
                    buf.clear();
                }
                let idx = level - 1;
                stack[idx] = Some(title);
                for slot in stack.iter_mut().skip(idx + 1) {
                    *slot = None;
                }
                buf.push_str(line);
                buf.push('\n');
                continue;
            }
        }

        buf.push_str(line);
        buf.push('\n');
    }

    if !buf.trim().is_empty() {
        sections.push((current_breadcrumb(&stack), buf.trim().to_string()));
    }

    let mut out = Vec::new();
    for (heading, body) in sections {
        for piece in recursive_split(&body, chunk_size, chunk_overlap) {
            out.push((heading.clone(), piece));
        }
    }
    out
}

pub fn chunk_files(
    paths: &[String],
    options: &ChunkOptions,
) -> Result<(usize, Vec<DocumentChunk>), String> {
    let files = collect_document_files(paths)?;
    let size = options.chunk_size.clamp(64, 16_000);
    let overlap = options.chunk_overlap.min(size.saturating_sub(1) / 2);

    let mut all_chunks = Vec::new();
    for file_path in &files {
        let raw = fs::read_to_string(file_path)
            .map_err(|e| format!("Failed to read '{}': {}", file_path.display(), e))?;
        let source_file = file_path.to_string_lossy().into_owned();
        let file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("document")
            .to_string();

        let is_md = file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false);

        let pieces: Vec<(Option<String>, String)> =
            if options.strategy == ChunkStrategy::MarkdownHeaders && is_md {
                markdown_headers_split(&raw, size, overlap)
            } else {
                recursive_split(&raw, size, overlap)
                    .into_iter()
                    .map(|t| (None, t))
                    .collect()
            };

        for (idx, (heading, text)) in pieces.into_iter().enumerate() {
            let char_count = text.chars().count();
            all_chunks.push(DocumentChunk {
                source_file: source_file.clone(),
                file_name: file_name.clone(),
                chunk_index: idx,
                heading,
                text,
                char_count,
            });
        }
    }

    Ok((files.len(), all_chunks))
}

pub fn preview_document_chunks_impl(
    paths: &[String],
    options: &ChunkOptions,
) -> Result<DocumentChunkPreview, String> {
    let (total_files, all_chunks) = chunk_files(paths, options)?;
    let total_chunks = all_chunks.len();
    let avg_chunk_length = if total_chunks == 0 {
        0
    } else {
        all_chunks.iter().map(|c| c.char_count).sum::<usize>() / total_chunks
    };
    let chunks = all_chunks.into_iter().take(50).collect();

    Ok(DocumentChunkPreview {
        total_files,
        total_chunks,
        avg_chunk_length,
        chunks,
    })
}

pub async fn ingest_documents_impl(
    db: &Database,
    pm: &ProcessManager,
    sink: Option<&dyn EventSink>,
    target: &ConnectionTarget,
    collection: &str,
    paths: &[String],
    options: &ChunkOptions,
    embedding_profile_id: &str,
) -> Result<IngestResult, String> {
    assert_writable(db, target)?;

    let pid = embedding_profile_id.trim();
    if pid.is_empty() {
        return Err("An embedding profile is required to ingest documents".to_string());
    }
    let profile = db
        .get_embedding_profile(pid)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Embedding profile '{}' not found", pid))?;
    let api_key = match &profile.secret_ref {
        Some(ref_key) => secrets::get_secret(ref_key)?,
        None => None,
    };

    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;

    let (files_processed, chunks) = chunk_files(paths, options)?;
    let total = chunks.len();
    if total == 0 {
        return Ok(IngestResult {
            files_processed,
            chunks_ingested: 0,
            failed: 0,
            errors: Vec::new(),
        });
    }

    let mut chunks_ingested = 0usize;
    let mut failed = 0usize;
    let mut errors = Vec::new();

    for start in (0..total).step_by(32) {
        let end = (start + 32).min(total);
        let batch = &chunks[start..end];
        let texts: Vec<String> = batch.iter().map(|c| c.text.clone()).collect();

        match embeddings::embed_texts(&profile, api_key.as_deref(), &texts).await {
            Ok((vecs, _)) => {
                let mut records = Vec::with_capacity(batch.len());
                for (idx, chunk) in batch.iter().enumerate() {
                    let Some(vec) = vecs.get(idx).filter(|v| !v.is_empty()) else {
                        failed += 1;
                        errors.push(format!(
                            "{} chunk {}: empty embedding returned",
                            chunk.file_name, chunk.chunk_index
                        ));
                        continue;
                    };
                    records.push(VectorRecord {
                        id: Uuid::new_v4().to_string(),
                        payload: json!({
                            "source_file": chunk.source_file,
                            "file_name": chunk.file_name,
                            "chunk_index": chunk.chunk_index,
                            "heading": chunk.heading,
                        }),
                        document: Some(chunk.text.clone()),
                        vector: Some(vec.clone()),
                        score: None,
                    });
                }

                if !records.is_empty() {
                    match adapter.upsert_records(collection, records.clone()).await {
                        Ok(n) => chunks_ingested += n,
                        Err(err) => {
                            failed += records.len();
                            errors.push(err.to_string());
                        }
                    }
                }
            }
            Err(err) => {
                failed += batch.len();
                errors.push(format!("Embedding batch failed: {}", err));
            }
        }

        emit_ingest_progress(
            sink,
            TransferProgressEvent {
                kind: "ingest".to_string(),
                processed: end,
                total,
                message: format!("Ingested {}/{} chunks", end, total),
            },
        );
    }

    Ok(IngestResult {
        files_processed,
        chunks_ingested,
        failed,
        errors,
    })
}

#[tauri::command]
pub fn preview_document_chunks(
    paths: Vec<String>,
    options: ChunkOptions,
) -> Result<DocumentChunkPreview, String> {
    preview_document_chunks_impl(&paths, &options)
}

#[tauri::command]
pub async fn ingest_documents(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    paths: Vec<String>,
    options: ChunkOptions,
    embedding_profile_id: String,
) -> Result<IngestResult, String> {
    ingest_documents_impl(
        &state.db,
        &state.process_manager,
        Some(state.event_sink.as_ref()),
        &target,
        &collection,
        &paths,
        &options,
        &embedding_profile_id,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recursive_split_respects_size_overlap_and_utf8() {
        let para1 = "Rust ownership ensures memory safety without garbage collection. ".repeat(3);
        let para2 = "Vector databases store embeddings for semantic retrieval — café naïve 🚀. ".repeat(3);
        let combined = format!("{}\n\n{}", para1.trim(), para2.trim());

        let chunks = recursive_split(&combined, 140, 30);
        assert!(chunks.len() >= 3);
        for chunk in &chunks {
            assert!(
                chunk.chars().count() <= 170,
                "chunk unexpectedly large: {}",
                chunk.chars().count()
            );
        }
        // Second chunk should contain overlap prefix from first chunk
        let first_tail = take_tail_chars(&chunks[0], 20);
        assert!(chunks[1].contains(first_tail.trim()));
    }

    #[test]
    fn markdown_headers_split_preserves_breadcrumbs_and_ignores_code_fences() {
        let md = "\
# EmbedBay Guide

Intro paragraph.

## Installation
Download the installer.

```bash
# This is a bash comment, not a heading
echo hello
```

### Windows
Run the setup executable.
";

        let chunks = markdown_headers_split(md, 800, 100);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].0.as_deref(), Some("EmbedBay Guide"));
        assert_eq!(
            chunks[1].0.as_deref(),
            Some("EmbedBay Guide > Installation")
        );
        assert!(chunks[1].1.contains("# This is a bash comment"));
        assert_eq!(
            chunks[2].0.as_deref(),
            Some("EmbedBay Guide > Installation > Windows")
        );
    }

    #[test]
    fn collect_document_files_skips_ignored_dirs_and_non_doc_files() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(dir.path().join("readme.md"), "# Root").expect("write md");
        fs::write(dir.path().join("notes.txt"), "Plain notes").expect("write txt");
        fs::write(dir.path().join("image.png"), "binary").expect("write png");

        let sub = dir.path().join("docs");
        fs::create_dir_all(&sub).expect("mkdir docs");
        fs::write(sub.join("guide.md"), "# Guide").expect("write guide");

        let git_dir = dir.path().join(".git");
        fs::create_dir_all(&git_dir).expect("mkdir .git");
        fs::write(git_dir.join("COMMIT.md"), "ignored").expect("write .git md");

        let nm_dir = dir.path().join("node_modules");
        fs::create_dir_all(&nm_dir).expect("mkdir node_modules");
        fs::write(nm_dir.join("pkg.md"), "ignored").expect("write nm md");

        let files =
            collect_document_files(&[dir.path().to_string_lossy().into_owned()]).expect("collect");
        let names: Vec<String> = files
            .iter()
            .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(ToString::to_string))
            .collect();
        assert_eq!(names.len(), 3);
        assert!(names.contains(&"readme.md".to_string()));
        assert!(names.contains(&"notes.txt".to_string()));
        assert!(names.contains(&"guide.md".to_string()));
    }

    #[tokio::test]
    async fn ingest_documents_embeds_and_upserts_and_respects_read_only() {
        use std::sync::Arc;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        use crate::adapters::lancedb::LanceDbAdapter;
        use crate::adapters::{CreateCollectionRequest, VectorDbAdapter};
        use crate::commands::connections::{
            create_embedding_profile_impl, create_remote_connection_impl,
        };
        use crate::db::models::{
            CreateEmbeddingProfilePayload, CreateInstancePayload, CreateRemoteConnectionPayload,
        };
        use crate::supervisor::logs::InstanceLogStore;

        let dir = tempfile::tempdir().expect("temp dir");
        let docs_dir = dir.path().join("docs");
        fs::create_dir_all(&docs_dir).expect("mkdir docs");
        fs::write(
            docs_dir.join("spec.md"),
            "# Architecture\nEmbedBay uses Rust.\n\n## Security\nKeyring stores secrets.",
        )
        .expect("write spec");

        let preview = preview_document_chunks_impl(
            &[docs_dir.to_string_lossy().into_owned()],
            &ChunkOptions {
                strategy: ChunkStrategy::MarkdownHeaders,
                chunk_size: 400,
                chunk_overlap: 50,
            },
        )
        .expect("preview");
        assert_eq!(preview.total_files, 1);
        assert_eq!(preview.total_chunks, 2);
        assert_eq!(
            preview.chunks[1].heading.as_deref(),
            Some("Architecture > Security")
        );

        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = [0u8; 4096];
                let _ = sock.read(&mut buf).await;
                let body = serde_json::to_string(&json!({
                    "embeddings": [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]
                }))
                .expect("json");
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });

        let db = Arc::new(Database::init(dir.path().to_path_buf()).expect("db init"));
        let logs = Arc::new(InstanceLogStore::default());
        let pm = ProcessManager::new(Arc::clone(&db), logs);

        let lance_dir = dir.path().join("lance");
        let inst = db
            .create_instance(CreateInstancePayload {
                name: "Local Lance".to_string(),
                description: None,
                color: None,
                group_id: None,
                engine_type: "lancedb".to_string(),
                engine_version: "embedded-1.0".to_string(),
                host: None,
                port: 0,
                grpc_port: None,
                data_dir: Some(lance_dir.to_string_lossy().into_owned()),
                config_json: None,
                auto_start: None,
                idle_timeout_minutes: None,
                tag_ids: None,
            })
            .expect("create inst");
        let lance = LanceDbAdapter::new(lance_dir).expect("lance");
        lance
            .create_collection(CreateCollectionRequest {
                name: "kb".to_string(),
                dimensions: 3,
                distance_metric: "cosine".to_string(),
                index_type: None,
            })
            .await
            .expect("create kb");

        let profile = create_embedding_profile_impl(
            &db,
            CreateEmbeddingProfilePayload {
                name: "Mock Embed".to_string(),
                provider: "ollama".to_string(),
                model_name: "mock".to_string(),
                base_url: Some(format!("http://127.0.0.1:{}", port)),
                dimensions: Some(3),
                api_key: None,
            },
        )
        .expect("create profile");

        let ingest_res = ingest_documents_impl(
            &db,
            &pm,
            None,
            &ConnectionTarget::LocalInstance {
                instance_id: inst.id,
            },
            "kb",
            &[docs_dir.to_string_lossy().into_owned()],
            &ChunkOptions {
                strategy: ChunkStrategy::MarkdownHeaders,
                chunk_size: 400,
                chunk_overlap: 50,
            },
            &profile.id,
        )
        .await
        .expect("ingest docs");
        server.abort();

        assert_eq!(ingest_res.files_processed, 1);
        assert_eq!(ingest_res.chunks_ingested, 2);
        assert_eq!(ingest_res.failed, 0);

        let info = lance.get_collection_info("kb").await.expect("kb info");
        assert_eq!(info.vector_count, 2);

        // Read-only connection blocks ingest
        let ro_conn = create_remote_connection_impl(
            &db,
            CreateRemoteConnectionPayload {
                name: "RO Cluster".to_string(),
                description: None,
                color: None,
                group_id: None,
                engine_type: "qdrant".to_string(),
                endpoint_url: "http://127.0.0.1:6333".to_string(),
                auth_type: "none".to_string(),
                secret: None,
                extra_json: None,
                read_only: Some(true),
                tag_ids: None,
            },
        )
        .expect("ro conn");
        let ro_err = ingest_documents_impl(
            &db,
            &pm,
            None,
            &ConnectionTarget::RemoteConnection {
                connection_id: ro_conn.id,
            },
            "kb",
            &[docs_dir.to_string_lossy().into_owned()],
            &ChunkOptions {
                strategy: ChunkStrategy::Recursive,
                chunk_size: 400,
                chunk_overlap: 50,
            },
            &profile.id,
        )
        .await
        .expect_err("ro ingest rejected");
        assert!(ro_err.contains("Read-Only"));
    }
}
