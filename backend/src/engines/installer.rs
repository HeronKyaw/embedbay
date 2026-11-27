use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use flate2::read::GzDecoder;
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tar::Archive;
use thiserror::Error;
use tokio::sync::Notify;
use zip::ZipArchive;

use crate::db::models::InstalledEngine;
use crate::db::Database;
use crate::engines::manifest::{ArchiveType, EngineTargetArtifact, ManifestService};
use crate::platform;
use crate::supervisor::EventSink;

#[derive(Debug, Error)]
pub enum InstallError {
    #[error("manifest error: {0}")]
    Manifest(String),
    #[error("{0}")]
    Http(String),
    #[error("SHA-256 verification failed: expected {expected}, got {actual}")]
    ChecksumMismatch { expected: String, actual: String },
    #[error("archive extraction failed: {0}")]
    Extract(String),
    #[error("unsafe archive path rejected: {0}")]
    UnsafePath(String),
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("database error: {0}")]
    Db(#[from] crate::db::DbError),
    #[error("cannot uninstall engine in use: {0}")]
    InUse(String),
    #[error("Download cancelled by user")]
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallProgressEvent {
    pub engine_type: String,
    pub version: String,
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: f64,
    pub message: String,
}

/// Per-download cancellation and pause control shared between the download task and Tauri commands.
#[derive(Debug, Default)]
pub struct DownloadControl {
    paused: AtomicBool,
    cancelled: AtomicBool,
    notify: Notify,
}

impl DownloadControl {
    pub fn pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

struct ActiveInstall {
    control: Arc<DownloadControl>,
    progress: InstallProgressEvent,
}

/// Tracks all in-flight engine downloads so UI views can re-hydrate and pause/resume/cancel them.
#[derive(Default)]
pub struct DownloadManager {
    active: Mutex<HashMap<String, ActiveInstall>>,
}

impl DownloadManager {
    pub fn key(engine_type: &str, version: &str) -> String {
        format!("{}-{}", engine_type, version)
    }

    pub fn register(
        &self,
        key: &str,
        initial: InstallProgressEvent,
    ) -> Result<Arc<DownloadControl>, InstallError> {
        let mut guard = self
            .active
            .lock()
            .map_err(|_| InstallError::Http("Download manager lock poisoned".to_string()))?;
        if guard.contains_key(key) {
            return Err(InstallError::Http(
                "Download already in progress for this engine version.".to_string(),
            ));
        }
        let control = Arc::new(DownloadControl::default());
        guard.insert(
            key.to_string(),
            ActiveInstall {
                control: Arc::clone(&control),
                progress: initial,
            },
        );
        Ok(control)
    }

    pub fn update_progress(&self, key: &str, evt: InstallProgressEvent) {
        if let Ok(mut guard) = self.active.lock() {
            if let Some(entry) = guard.get_mut(key) {
                entry.progress = evt;
            }
        }
    }

    pub fn pause(&self, key: &str) -> bool {
        if let Ok(mut guard) = self.active.lock() {
            if let Some(entry) = guard.get_mut(key) {
                entry.control.pause();
                entry.progress.stage = "paused".to_string();
                entry.progress.message = "Download paused".to_string();
                return true;
            }
        }
        false
    }

    pub fn resume(&self, key: &str) -> bool {
        if let Ok(mut guard) = self.active.lock() {
            if let Some(entry) = guard.get_mut(key) {
                entry.control.resume();
                entry.progress.stage = "downloading".to_string();
                entry.progress.message = "Resuming download...".to_string();
                return true;
            }
        }
        false
    }

    pub fn cancel(&self, key: &str) -> bool {
        if let Ok(mut guard) = self.active.lock() {
            if let Some(entry) = guard.get_mut(key) {
                entry.control.cancel();
                entry.progress.stage = "cancelled".to_string();
                entry.progress.message = "Cancelling download...".to_string();
                return true;
            }
        }
        false
    }

    pub fn list_active(&self) -> Vec<InstallProgressEvent> {
        self.active
            .lock()
            .map(|guard| guard.values().map(|v| v.progress.clone()).collect())
            .unwrap_or_default()
    }

    pub fn unregister(&self, key: &str) {
        if let Ok(mut guard) = self.active.lock() {
            guard.remove(key);
        }
    }
}

fn emit_progress(
    sink: Option<&dyn EventSink>,
    manager: Option<&DownloadManager>,
    evt: InstallProgressEvent,
) {
    if let Some(m) = manager {
        let key = DownloadManager::key(&evt.engine_type, &evt.version);
        m.update_progress(&key, evt.clone());
    }
    if let Some(s) = sink {
        if let Ok(val) = serde_json::to_value(evt) {
            s.emit_json("install-progress", val);
        }
    }
}

pub async fn install_engine(
    db: &Database,
    manifest: &ManifestService,
    sink: Option<&dyn EventSink>,
    engine_type: &str,
    version: &str,
) -> Result<InstalledEngine, InstallError> {
    install_engine_managed(db, manifest, sink, None, engine_type, version).await
}

pub async fn install_engine_managed(
    db: &Database,
    manifest: &ManifestService,
    sink: Option<&dyn EventSink>,
    manager: Option<&DownloadManager>,
    engine_type: &str,
    version: &str,
) -> Result<InstalledEngine, InstallError> {
    let target_triple = platform::target_triple();
    let (catalog_entry, artifact) = manifest
        .find_artifact(engine_type, version, target_triple)
        .map_err(InstallError::Manifest)?;

    let engine_id = DownloadManager::key(engine_type, version);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Built-in zero-download embedded engines (such as LanceDB and SQLite-vec) require zero download.
    if artifact.url == "embedded://local" {
        emit_progress(
            sink,
            manager,
            InstallProgressEvent {
                engine_type: engine_type.to_string(),
                version: version.to_string(),
                stage: "complete".to_string(),
                downloaded_bytes: 0,
                total_bytes: 0,
                percent: 100.0,
                message: format!("{} embedded runtime enabled", catalog_entry.display_name),
            },
        );

        let record = InstalledEngine {
            id: engine_id,
            engine_type: engine_type.to_string(),
            version: version.to_string(),
            target_triple: target_triple.to_string(),
            binary_path: "embedded".to_string(),
            sha256: "embedded".to_string(),
            installed_at: now,
            last_used_at: None,
        };
        db.upsert_installed_engine(&record)?;
        return Ok(record);
    }

    let control = match manager {
        Some(m) => Some(m.register(
            &engine_id,
            InstallProgressEvent {
                engine_type: engine_type.to_string(),
                version: version.to_string(),
                stage: "downloading".to_string(),
                downloaded_bytes: 0,
                total_bytes: artifact.size_bytes,
                percent: 0.0,
                message: "Starting download...".to_string(),
            },
        )?),
        None => None,
    };

    let result = install_engine_inner(
        db,
        sink,
        manager,
        control.as_deref(),
        &catalog_entry.display_name,
        &artifact,
        engine_type,
        version,
        &engine_id,
        target_triple,
        now,
    )
    .await;

    if let Some(m) = manager {
        m.unregister(&engine_id);
    }

    result
}

#[allow(clippy::too_many_arguments)]
async fn install_engine_inner(
    db: &Database,
    sink: Option<&dyn EventSink>,
    manager: Option<&DownloadManager>,
    control: Option<&DownloadControl>,
    display_name: &str,
    artifact: &EngineTargetArtifact,
    engine_type: &str,
    version: &str,
    engine_id: &str,
    target_triple: &str,
    now: i64,
) -> Result<InstalledEngine, InstallError> {
    let install_dir = db.bin_dir().join(engine_type).join(version);
    let downloads_dir = db.bin_dir().join(".downloads");
    fs::create_dir_all(&downloads_dir)?;
    if install_dir.exists() {
        fs::remove_dir_all(&install_dir)?;
    }
    fs::create_dir_all(&install_dir)?;

    let primary_archive = downloads_dir.join(format!("{}-{}.part", engine_type, version));
    let is_loopback = artifact.url.starts_with("http://127.0.0.1")
        || artifact.url.starts_with("http://localhost");
    let mut client_builder = reqwest::Client::builder().user_agent("EmbedBay/0.1");
    if is_loopback {
        client_builder = client_builder.no_proxy();
    }
    let client = client_builder
        .build()
        .map_err(|e| InstallError::Http(crate::adapters::format_reqwest_error(&e)))?;

    let computed_sha = match download_and_verify(
        &client,
        &artifact.url,
        &artifact.sha256,
        artifact.size_bytes,
        &primary_archive,
        sink,
        manager,
        control,
        engine_type,
        version,
        "Downloading primary package...",
    )
    .await
    {
        Ok(sha) => sha,
        Err(err) => {
            let _ = fs::remove_file(&primary_archive);
            let _ = fs::remove_dir_all(&install_dir);
            return Err(err);
        }
    };

    emit_progress(
        sink,
        manager,
        InstallProgressEvent {
            engine_type: engine_type.to_string(),
            version: version.to_string(),
            stage: "extracting".to_string(),
            downloaded_bytes: artifact.size_bytes,
            total_bytes: artifact.size_bytes,
            percent: 92.0,
            message: "Extracting runtime binaries...".to_string(),
        },
    );

    let extract_res = extract_artifact(&primary_archive, &install_dir, artifact);
    let _ = fs::remove_file(&primary_archive);
    extract_res?;

    // Download & merge any extra archives (used e.g. for pgvector extension DLL + SQL files)
    for (idx, extra) in artifact.extra_archives.iter().enumerate() {
        let extra_path = downloads_dir.join(format!("{}-{}-extra-{}.part", engine_type, version, idx));
        let extra_dl = download_and_verify(
            &client,
            &extra.url,
            &extra.sha256,
            extra.size_bytes,
            &extra_path,
            sink,
            manager,
            control,
            engine_type,
            version,
            "Downloading extension package...",
        )
        .await;
        if let Err(err) = extra_dl {
            let _ = fs::remove_file(&extra_path);
            let _ = fs::remove_dir_all(&install_dir);
            return Err(err);
        }

        let target_dest = match &extra.dest_subdir {
            Some(sub) => install_dir.join(sub),
            None => install_dir.clone(),
        };
        fs::create_dir_all(&target_dest)?;

        let dummy_art = EngineTargetArtifact {
            url: extra.url.clone(),
            sha256: extra.sha256.clone(),
            size_bytes: extra.size_bytes,
            archive_type: extra.archive_type.clone(),
            binary_rel_path: String::new(),
            extra_archives: Vec::new(),
        };
        let extra_extract = extract_artifact(&extra_path, &target_dest, &dummy_art);
        let _ = fs::remove_file(&extra_path);
        if let Err(err) = extra_extract {
            let _ = fs::remove_dir_all(&install_dir);
            return Err(err);
        }
    }

    let binary_path = resolve_extracted_binary(&install_dir, &artifact.binary_rel_path)?;
    platform::ensure_executable(&binary_path).map_err(InstallError::Extract)?;

    let record = InstalledEngine {
        id: engine_id.to_string(),
        engine_type: engine_type.to_string(),
        version: version.to_string(),
        target_triple: target_triple.to_string(),
        binary_path: binary_path.to_string_lossy().into_owned(),
        sha256: computed_sha,
        installed_at: now,
        last_used_at: None,
    };
    db.upsert_installed_engine(&record)?;

    emit_progress(
        sink,
        manager,
        InstallProgressEvent {
            engine_type: engine_type.to_string(),
            version: version.to_string(),
            stage: "complete".to_string(),
            downloaded_bytes: artifact.size_bytes,
            total_bytes: artifact.size_bytes,
            percent: 100.0,
            message: format!("Installed {} v{}", display_name, version),
        },
    );

    Ok(record)
}

#[allow(clippy::too_many_arguments)]
async fn download_and_verify(
    client: &reqwest::Client,
    url: &str,
    expected_sha256: &str,
    fallback_size: u64,
    dest_file: &Path,
    sink: Option<&dyn EventSink>,
    manager: Option<&DownloadManager>,
    control: Option<&DownloadControl>,
    engine_type: &str,
    version: &str,
    message: &str,
) -> Result<String, InstallError> {
    if control.is_some_and(|c| c.is_cancelled()) {
        emit_progress(
            sink,
            manager,
            InstallProgressEvent {
                engine_type: engine_type.to_string(),
                version: version.to_string(),
                stage: "cancelled".to_string(),
                downloaded_bytes: 0,
                total_bytes: fallback_size.max(1),
                percent: 0.0,
                message: "Download cancelled".to_string(),
            },
        );
        return Err(InstallError::Cancelled);
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| InstallError::Http(crate::adapters::format_reqwest_error(&e)))?;
    if !response.status().is_success() {
        return Err(InstallError::Http(format!(
            "Download failed (HTTP {}).",
            response.status().as_u16()
        )));
    }

    let total_bytes = response.content_length().unwrap_or(fallback_size).max(1);
    let mut file = File::create(dest_file)?;
    let mut hasher = Sha256::new();
    let mut downloaded_bytes: u64 = 0;
    let mut last_emit = Instant::now();
    let mut last_percent: f64 = -1.0;

    emit_progress(
        sink,
        manager,
        InstallProgressEvent {
            engine_type: engine_type.to_string(),
            version: version.to_string(),
            stage: "downloading".to_string(),
            downloaded_bytes: 0,
            total_bytes,
            percent: 0.0,
            message: message.to_string(),
        },
    );

    let mut stream = response.bytes_stream();
    loop {
        if let Some(ctrl) = control {
            if ctrl.is_cancelled() {
                drop(file);
                let _ = fs::remove_file(dest_file);
                let pct = ((downloaded_bytes as f64 / total_bytes as f64) * 90.0).min(90.0);
                emit_progress(
                    sink,
                    manager,
                    InstallProgressEvent {
                        engine_type: engine_type.to_string(),
                        version: version.to_string(),
                        stage: "cancelled".to_string(),
                        downloaded_bytes,
                        total_bytes,
                        percent: pct,
                        message: "Download cancelled".to_string(),
                    },
                );
                return Err(InstallError::Cancelled);
            }

            if ctrl.is_paused() {
                let pct = ((downloaded_bytes as f64 / total_bytes as f64) * 90.0).min(90.0);
                emit_progress(
                    sink,
                    manager,
                    InstallProgressEvent {
                        engine_type: engine_type.to_string(),
                        version: version.to_string(),
                        stage: "paused".to_string(),
                        downloaded_bytes,
                        total_bytes,
                        percent: pct,
                        message: "Download paused".to_string(),
                    },
                );
                while ctrl.is_paused() {
                    if ctrl.is_cancelled() {
                        drop(file);
                        let _ = fs::remove_file(dest_file);
                        emit_progress(
                            sink,
                            manager,
                            InstallProgressEvent {
                                engine_type: engine_type.to_string(),
                                version: version.to_string(),
                                stage: "cancelled".to_string(),
                                downloaded_bytes,
                                total_bytes,
                                percent: pct,
                                message: "Download cancelled".to_string(),
                            },
                        );
                        return Err(InstallError::Cancelled);
                    }
                    tokio::select! {
                        _ = ctrl.notify.notified() => {},
                        _ = tokio::time::sleep(Duration::from_millis(120)) => {},
                    }
                }
                emit_progress(
                    sink,
                    manager,
                    InstallProgressEvent {
                        engine_type: engine_type.to_string(),
                        version: version.to_string(),
                        stage: "downloading".to_string(),
                        downloaded_bytes,
                        total_bytes,
                        percent: pct,
                        message: message.to_string(),
                    },
                );
            }
        }

        let next_chunk = if let Some(ctrl) = control {
            tokio::select! {
                chunk = stream.next() => chunk,
                _ = ctrl.notify.notified() => {
                    continue;
                }
            }
        } else {
            stream.next().await
        };

        let Some(chunk_res) = next_chunk else {
            break;
        };

        let chunk = chunk_res
            .map_err(|e| InstallError::Http(crate::adapters::format_reqwest_error(&e)))?;
        file.write_all(&chunk)?;
        hasher.update(&chunk);
        downloaded_bytes += chunk.len() as u64;

        let pct = ((downloaded_bytes as f64 / total_bytes as f64) * 90.0).min(90.0);
        if last_emit.elapsed().as_millis() >= 100 || (pct - last_percent) >= 1.5 {
            last_emit = Instant::now();
            last_percent = pct;
            emit_progress(
                sink,
                manager,
                InstallProgressEvent {
                    engine_type: engine_type.to_string(),
                    version: version.to_string(),
                    stage: "downloading".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    percent: pct,
                    message: message.to_string(),
                },
            );
        }
    }
    file.flush()?;
    drop(file);

    emit_progress(
        sink,
        manager,
        InstallProgressEvent {
            engine_type: engine_type.to_string(),
            version: version.to_string(),
            stage: "verifying".to_string(),
            downloaded_bytes,
            total_bytes,
            percent: 91.0,
            message: "Verifying SHA-256 checksum...".to_string(),
        },
    );

    let actual_sha = hex::encode(hasher.finalize());
    let expected_norm = expected_sha256.trim().to_ascii_lowercase();
    if !expected_norm.is_empty() && actual_sha != expected_norm {
        let _ = fs::remove_file(dest_file);
        return Err(InstallError::ChecksumMismatch {
            expected: expected_norm,
            actual: actual_sha,
        });
    }

    Ok(actual_sha)
}

fn extract_artifact(
    archive_path: &Path,
    dest_dir: &Path,
    artifact: &EngineTargetArtifact,
) -> Result<(), InstallError> {
    match artifact.archive_type {
        ArchiveType::Zip => extract_zip(archive_path, dest_dir),
        ArchiveType::TarGz => extract_tar_gz(archive_path, dest_dir),
        ArchiveType::Binary => {
            let rel = sanitize_rel_path(Path::new(&artifact.binary_rel_path))?;
            let target = dest_dir.join(rel);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(archive_path, &target)?;
            Ok(())
        }
    }
}

pub fn sanitize_rel_path(path: &Path) -> Result<PathBuf, InstallError> {
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(InstallError::UnsafePath(
                    path.to_string_lossy().into_owned(),
                ));
            }
        }
    }
    if clean.as_os_str().is_empty() {
        return Err(InstallError::UnsafePath("empty archive entry path".to_string()));
    }
    Ok(clean)
}

pub fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<(), InstallError> {
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file).map_err(|e| InstallError::Extract(e.to_string()))?;

    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| InstallError::Extract(e.to_string()))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| InstallError::UnsafePath(entry.name().to_string()))?;
        let rel = sanitize_rel_path(&enclosed)?;
        let out_path = dest_dir.join(rel);

        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out_file = File::create(&out_path)?;
            io::copy(&mut entry, &mut out_file)?;
        }
    }
    Ok(())
}

pub fn extract_tar_gz(archive_path: &Path, dest_dir: &Path) -> Result<(), InstallError> {
    let file = File::open(archive_path)?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);

    let entries = archive
        .entries()
        .map_err(|e| InstallError::Extract(e.to_string()))?;

    for entry_res in entries {
        let mut entry = entry_res.map_err(|e| InstallError::Extract(e.to_string()))?;
        let entry_type = entry.header().entry_type();
        if entry_type.is_symlink() || entry_type.is_hard_link() {
            let p = entry
                .path()
                .map(|v| v.to_string_lossy().into_owned())
                .unwrap_or_else(|_| "symlink".to_string());
            return Err(InstallError::UnsafePath(format!(
                "link entry rejected in archive: {}",
                p
            )));
        }

        let raw_path = entry
            .path()
            .map_err(|e| InstallError::Extract(e.to_string()))?
            .into_owned();
        let rel = match sanitize_rel_path(&raw_path) {
            Ok(p) => p,
            Err(_) if raw_path == Path::new(".") => continue,
            Err(e) => return Err(e),
        };
        let out_path = dest_dir.join(rel);

        if entry_type.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else if entry_type.is_file() {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out_file = File::create(&out_path)?;
            io::copy(&mut entry, &mut out_file)?;
        }
    }
    Ok(())
}

fn resolve_extracted_binary(install_dir: &Path, rel_path: &str) -> Result<PathBuf, InstallError> {
    let direct = install_dir.join(rel_path);
    if direct.is_file() {
        return Ok(direct);
    }

    // Some archives wrap contents in a single top-level directory (e.g. qdrant-v1.20.2/).
    if let Ok(read_dir) = fs::read_dir(install_dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let candidate = path.join(rel_path);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    Err(InstallError::Extract(format!(
        "Expected executable '{}' not found under '{}'",
        rel_path,
        install_dir.display()
    )))
}

pub fn uninstall_engine(db: &Database, id: &str) -> Result<(), InstallError> {
    let engine = db
        .get_installed_engine(id)?
        .ok_or_else(|| InstallError::Manifest(format!("Installed engine '{}' not found", id)))?;

    let refs = db.list_instances_using_engine(&engine.engine_type, &engine.version)?;
    if !refs.is_empty() {
        let names: Vec<String> = refs.into_iter().map(|i| i.name).collect();
        return Err(InstallError::InUse(format!(
            "Referenced by instance(s): {}",
            names.join(", ")
        )));
    }

    let install_dir = db.bin_dir().join(&engine.engine_type).join(&engine.version);
    if install_dir.exists() {
        fs::remove_dir_all(&install_dir)?;
    }
    db.delete_installed_engine(id)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::manifest::{
        EngineCatalogEntry, EngineManifest, EngineTargetArtifact, EngineVersionEntry,
    };
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::collections::HashMap;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use zip::write::SimpleFileOptions;

    fn build_test_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let buf = Vec::new();
        let cursor = std::io::Cursor::new(buf);
        let mut writer = zip::ZipWriter::new(cursor);
        let options = SimpleFileOptions::default();
        for (name, bytes) in entries {
            writer.start_file(*name, options).expect("start zip entry");
            writer.write_all(bytes).expect("write zip entry");
        }
        writer.finish().expect("finish zip").into_inner()
    }

    async fn spawn_byte_server(payload: Vec<u8>) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test server");
        let addr = listener.local_addr().expect("local addr");
        let handle = tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                let mut req_buf = [0u8; 1024];
                let _ = stream.read(&mut req_buf).await;
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    payload.len()
                );
                let _ = stream.write_all(header.as_bytes()).await;
                let _ = stream.write_all(&payload).await;
                let _ = stream.shutdown().await;
            }
        });
        (format!("http://127.0.0.1:{}/pkg.zip", addr.port()), handle)
    }

    #[tokio::test]
    async fn download_verify_extract_and_uninstall_zip_succeeds() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        let zip_bytes = build_test_zip(&[("qdrant.exe", b"mock-qdrant-binary")]);
        let sha = hex::encode(Sha256::digest(&zip_bytes));
        let (url, server) = spawn_byte_server(zip_bytes).await;

        let mut targets = HashMap::new();
        targets.insert(
            platform::target_triple().to_string(),
            EngineTargetArtifact {
                url,
                sha256: sha.clone(),
                size_bytes: 32,
                archive_type: ArchiveType::Zip,
                binary_rel_path: "qdrant.exe".to_string(),
                extra_archives: Vec::new(),
            },
        );
        let manifest = ManifestService::from_manifest_for_test(
            dir.path().join("manifest.json"),
            EngineManifest {
                schema_version: 1,
                updated_at: "2026-11-25T00:00:00Z".to_string(),
                engines: vec![EngineCatalogEntry {
                    engine_type: "qdrant".to_string(),
                    display_name: "Qdrant".to_string(),
                    description: "Test".to_string(),
                    tier: 1,
                    embedded: false,
                    runtime_kind: "native".to_string(),
                    ram_hint: None,
                    category: None,
                    install_notice: None,
                    default_port: 6333,
                    default_grpc_port: Some(6334),
                    versions: vec![EngineVersionEntry {
                        version: "1.20.2".to_string(),
                        recommended: true,
                        targets,
                    }],
                }],
            },
        );

        let installed = install_engine(&db, &manifest, None, "qdrant", "1.20.2")
            .await
            .expect("install should succeed");
        server.await.expect("server join");

        assert_eq!(installed.id, "qdrant-1.20.2");
        assert_eq!(installed.sha256, sha);
        assert!(Path::new(&installed.binary_path).is_file());

        uninstall_engine(&db, "qdrant-1.20.2").expect("uninstall succeeds");
        assert!(db
            .get_installed_engine("qdrant-1.20.2")
            .expect("query")
            .is_none());
    }

    #[tokio::test]
    async fn download_rejects_checksum_mismatch() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        let zip_bytes = build_test_zip(&[("qdrant.exe", b"corrupt")]);
        let (url, server) = spawn_byte_server(zip_bytes).await;

        let mut targets = HashMap::new();
        targets.insert(
            platform::target_triple().to_string(),
            EngineTargetArtifact {
                url,
                sha256: "0000000000000000000000000000000000000000000000000000000000000000"
                    .to_string(),
                size_bytes: 32,
                archive_type: ArchiveType::Zip,
                binary_rel_path: "qdrant.exe".to_string(),
                extra_archives: Vec::new(),
            },
        );
        let manifest = ManifestService::from_manifest_for_test(
            dir.path().join("manifest.json"),
            EngineManifest {
                schema_version: 1,
                updated_at: "2026-11-25T00:00:00Z".to_string(),
                engines: vec![EngineCatalogEntry {
                    engine_type: "qdrant".to_string(),
                    display_name: "Qdrant".to_string(),
                    description: "Test".to_string(),
                    tier: 1,
                    embedded: false,
                    runtime_kind: "native".to_string(),
                    ram_hint: None,
                    category: None,
                    install_notice: None,
                    default_port: 6333,
                    default_grpc_port: Some(6334),
                    versions: vec![EngineVersionEntry {
                        version: "1.20.2".to_string(),
                        recommended: true,
                        targets,
                    }],
                }],
            },
        );

        let err = install_engine(&db, &manifest, None, "qdrant", "1.20.2")
            .await
            .expect_err("checksum mismatch expected");
        server.await.expect("server join");
        assert!(matches!(err, InstallError::ChecksumMismatch { .. }));
    }

    #[test]
    fn extract_zip_rejects_zip_slip_traversal() {
        let dir = tempfile::tempdir().expect("temp dir");
        let zip_path = dir.path().join("evil.zip");
        let bytes = build_test_zip(&[("../../evil.txt", b"bad")]);
        fs::write(&zip_path, bytes).expect("write evil zip");

        let dest = dir.path().join("out");
        fs::create_dir_all(&dest).expect("create out dir");
        let err = extract_zip(&zip_path, &dest).expect_err("zip slip must fail");
        assert!(matches!(err, InstallError::UnsafePath(_)));
    }

    #[test]
    fn extract_tar_gz_unpacks_safely() {
        let dir = tempfile::tempdir().expect("temp dir");
        let tgz_path = dir.path().join("pkg.tar.gz");
        {
            let file = File::create(&tgz_path).expect("create tgz");
            let enc = GzEncoder::new(file, Compression::default());
            let mut builder = tar::Builder::new(enc);
            let data = b"hello chroma";
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder
                .append_data(&mut header, "bin/chroma", &data[..])
                .expect("append tar entry");
            builder.finish().expect("finish tar");
        }

        let dest = dir.path().join("out");
        fs::create_dir_all(&dest).expect("create out");
        extract_tar_gz(&tgz_path, &dest).expect("extract tar.gz");
        assert_eq!(
            fs::read(dest.join("bin").join("chroma")).expect("read extracted"),
            b"hello chroma"
        );
    }

    #[test]
    fn resolve_extracted_binary_finds_nested_archive_root() {
        let dir = tempfile::tempdir().expect("temp dir");
        let nested_bin = dir
            .path()
            .join("elasticsearch-9.5.6")
            .join("bin")
            .join("elasticsearch.bat");
        fs::create_dir_all(nested_bin.parent().expect("parent")).expect("mkdir");
        fs::write(&nested_bin, b"@echo off\n").expect("write bat");

        let resolved =
            resolve_extracted_binary(dir.path(), "bin/elasticsearch.bat").expect("resolve");
        assert_eq!(resolved, nested_bin);
    }

    #[test]
    fn download_manager_pause_resume_and_list_active() {
        let manager = DownloadManager::default();
        let key = DownloadManager::key("chroma", "1.4.4");
        let ctrl = manager
            .register(
                &key,
                InstallProgressEvent {
                    engine_type: "chroma".to_string(),
                    version: "1.4.4".to_string(),
                    stage: "downloading".to_string(),
                    downloaded_bytes: 100,
                    total_bytes: 1000,
                    percent: 9.0,
                    message: "Downloading...".to_string(),
                },
            )
            .expect("register");

        assert_eq!(manager.list_active().len(), 1);
        assert!(manager.pause(&key));
        assert!(ctrl.is_paused());
        assert_eq!(manager.list_active()[0].stage, "paused");

        assert!(manager.resume(&key));
        assert!(!ctrl.is_paused());
        assert_eq!(manager.list_active()[0].stage, "downloading");

        assert!(manager.cancel(&key));
        assert!(ctrl.is_cancelled());

        manager.unregister(&key);
        assert!(manager.list_active().is_empty());
    }

    #[tokio::test]
    async fn download_cancel_aborts_and_cleans_up_partial_files() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        let zip_bytes = build_test_zip(&[("qdrant.exe", b"hello")]);
        let (url, server) = spawn_byte_server(zip_bytes).await;

        let mut targets = HashMap::new();
        targets.insert(
            platform::target_triple().to_string(),
            EngineTargetArtifact {
                url,
                sha256: String::new(),
                size_bytes: 32,
                archive_type: ArchiveType::Zip,
                binary_rel_path: "qdrant.exe".to_string(),
                extra_archives: Vec::new(),
            },
        );
        let manifest = ManifestService::from_manifest_for_test(
            dir.path().join("manifest.json"),
            EngineManifest {
                schema_version: 1,
                updated_at: "2026-11-25T00:00:00Z".to_string(),
                engines: vec![EngineCatalogEntry {
                    engine_type: "qdrant".to_string(),
                    display_name: "Qdrant".to_string(),
                    description: "Test".to_string(),
                    tier: 1,
                    embedded: false,
                    runtime_kind: "native".to_string(),
                    ram_hint: None,
                    category: None,
                    install_notice: None,
                    default_port: 6333,
                    default_grpc_port: Some(6334),
                    versions: vec![EngineVersionEntry {
                        version: "1.20.2".to_string(),
                        recommended: true,
                        targets,
                    }],
                }],
            },
        );

        let manager = Arc::new(DownloadManager::default());
        let key = DownloadManager::key("qdrant", "1.20.2");
        let m_cancel = Arc::clone(&manager);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            m_cancel.cancel(&key);
        });

        // Pre-register? No, install_engine_managed registers itself; instead test pre-cancelled control via manager:
        // Wait until registered, or test download_and_verify directly with pre-cancelled control.
        let ctrl = DownloadControl::default();
        ctrl.cancel();
        let client = reqwest::Client::new();
        let part_file = db.bin_dir().join("cancel-test.part");
        let err = download_and_verify(
            &client,
            &manifest
                .find_artifact("qdrant", "1.20.2", platform::target_triple())
                .unwrap()
                .1
                .url,
            "",
            32,
            &part_file,
            None,
            Some(&manager),
            Some(&ctrl),
            "qdrant",
            "1.20.2",
            "Downloading...",
        )
        .await
        .expect_err("cancelled download must fail");

        assert!(matches!(err, InstallError::Cancelled));
        assert!(!part_file.exists());
        server.abort();
    }
}
