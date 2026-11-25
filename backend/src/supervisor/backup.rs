use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::db::Database;
use crate::engines::installer::sanitize_rel_path;
use crate::supervisor::process_manager::ProcessManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub instance_id: String,
    pub instance_name: String,
    pub engine_type: String,
    pub engine_version: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupResult {
    pub zip_path: String,
    pub size_bytes: u64,
    pub restarted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreResult {
    pub instance_id: String,
    pub restarted: bool,
}

pub async fn backup_instance(
    db: &Database,
    pm: &Arc<ProcessManager>,
    instance_id: &str,
    dest_zip: &Path,
) -> Result<BackupResult, String> {
    let instance = db
        .get_instance(instance_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Instance '{}' not found", instance_id))?;

    let was_running = pm.is_instance_running(instance_id).await;
    if was_running {
        pm.log_system(
            instance_id,
            "Pausing instance cleanly before creating backup archive...",
        );
        pm.stop_instance(instance_id).await?;
    }

    let data_dir = PathBuf::from(&instance.data_dir);
    let manifest = BackupManifest {
        instance_id: instance.id.clone(),
        instance_name: instance.name.clone(),
        engine_type: instance.engine_type.clone(),
        engine_version: instance.engine_version.clone(),
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };

    let write_res = create_data_zip(&data_dir, &manifest, dest_zip);

    let mut restarted = false;
    if was_running {
        pm.log_system(instance_id, "Resuming instance after backup...");
        if pm.start_instance(instance_id).await.is_ok() {
            restarted = true;
        }
    }

    write_res?;
    let size_bytes = fs::metadata(dest_zip).map(|m| m.len()).unwrap_or(0);
    Ok(BackupResult {
        zip_path: dest_zip.to_string_lossy().into_owned(),
        size_bytes,
        restarted,
    })
}

pub async fn restore_instance(
    db: &Database,
    pm: &Arc<ProcessManager>,
    instance_id: &str,
    src_zip: &Path,
) -> Result<RestoreResult, String> {
    let instance = db
        .get_instance(instance_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Instance '{}' not found", instance_id))?;

    if !src_zip.is_file() {
        return Err(format!("Backup file not found: {}", src_zip.display()));
    }

    let was_running = pm.is_instance_running(instance_id).await;
    if was_running {
        pm.log_system(
            instance_id,
            "Stopping instance cleanly before restoring backup...",
        );
        pm.stop_instance(instance_id).await?;
    }

    let data_dir = PathBuf::from(&instance.data_dir);
    let restore_res = restore_data_zip(src_zip, &data_dir);

    let mut restarted = false;
    if was_running {
        pm.log_system(instance_id, "Resuming instance after restore...");
        if pm.start_instance(instance_id).await.is_ok() {
            restarted = true;
        }
    }

    restore_res?;
    Ok(RestoreResult {
        instance_id: instance.id,
        restarted,
    })
}

pub fn create_data_zip(
    data_dir: &Path,
    manifest: &BackupManifest,
    dest_zip: &Path,
) -> Result<(), String> {
    if let Some(parent) = dest_zip.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp_zip = dest_zip.with_extension("zip.tmp");
    let file = File::create(&tmp_zip).map_err(|e| e.to_string())?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let manifest_bytes = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
    writer
        .start_file("backup_manifest.json", options)
        .map_err(|e| e.to_string())?;
    writer.write_all(&manifest_bytes).map_err(|e| e.to_string())?;

    if data_dir.is_dir() {
        append_dir_to_zip(&mut writer, data_dir, data_dir, options).map_err(|e| e.to_string())?;
    }

    writer.finish().map_err(|e| e.to_string())?;
    if dest_zip.exists() {
        fs::remove_file(dest_zip).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp_zip, dest_zip).map_err(|e| e.to_string())?;
    Ok(())
}

fn append_dir_to_zip<W: Write + io::Seek>(
    writer: &mut ZipWriter<W>,
    base_dir: &Path,
    cur_dir: &Path,
    options: SimpleFileOptions,
) -> io::Result<()> {
    for entry in fs::read_dir(cur_dir)? {
        let entry = entry?;
        let path = entry.path();
        let rel = path
            .strip_prefix(base_dir)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        let zip_name = format!("data/{}", rel.to_string_lossy().replace('\\', "/"));

        if path.is_dir() {
            append_dir_to_zip(writer, base_dir, &path, options)?;
        } else if path.is_file() {
            writer
                .start_file(zip_name, options)
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
            let mut f = File::open(&path)?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)?;
            writer.write_all(&buf)?;
        }
    }
    Ok(())
}

pub fn restore_data_zip(src_zip: &Path, data_dir: &Path) -> Result<(), String> {
    let file = File::open(src_zip).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    // Validate every entry up front against zip-slip traversal
    for idx in 0..archive.len() {
        let entry = archive.by_index(idx).map_err(|e| e.to_string())?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| format!("Unsafe path in archive: {}", entry.name()))?;
        sanitize_rel_path(&enclosed).map_err(|e| e.to_string())?;
    }

    let parent = data_dir
        .parent()
        .ok_or_else(|| "Invalid instance data directory".to_string())?;
    let stage_dir = parent.join(format!(".restore-stage-{}", uuid::Uuid::new_v4()));
    let rollback_dir = parent.join(format!(".restore-rollback-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&stage_dir).map_err(|e| e.to_string())?;

    let extract_res: Result<(), String> = (|| {
        for idx in 0..archive.len() {
            let mut entry = archive.by_index(idx).map_err(|e| e.to_string())?;
            let enclosed = entry
                .enclosed_name()
                .ok_or_else(|| "Unsafe path".to_string())?;
            let rel = sanitize_rel_path(&enclosed).map_err(|e| e.to_string())?;

            // Strip leading `data/` prefix if present; skip backup_manifest.json
            if rel == Path::new("backup_manifest.json") {
                continue;
            }
            let inner_rel = rel.strip_prefix("data").unwrap_or(&rel);
            if inner_rel.as_os_str().is_empty() {
                continue;
            }
            let dest = stage_dir.join(inner_rel);
            if entry.is_dir() {
                fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = dest.parent() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                let mut out = File::create(&dest).map_err(|e| e.to_string())?;
                io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })();

    if let Err(err) = extract_res {
        let _ = fs::remove_dir_all(&stage_dir);
        return Err(err);
    }

    if data_dir.exists() {
        if let Err(e) = fs::rename(data_dir, &rollback_dir) {
            let _ = fs::remove_dir_all(&stage_dir);
            return Err(format!("Failed preparing existing data_dir rollback: {}", e));
        }
    }

    if let Err(e) = fs::rename(&stage_dir, data_dir) {
        if rollback_dir.exists() {
            let _ = fs::rename(&rollback_dir, data_dir);
        }
        let _ = fs::remove_dir_all(&stage_dir);
        return Err(format!("Failed swapping restored data directory: {}", e));
    }

    if rollback_dir.exists() {
        let _ = fs::remove_dir_all(&rollback_dir);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_and_restore_zip_roundtrip_preserves_data() {
        let dir = tempfile::tempdir().expect("temp dir");
        let data_dir = dir.path().join("instance_data");
        fs::create_dir_all(data_dir.join("nested")).expect("mkdir");
        fs::write(data_dir.join("records.jsonl"), b"{\"id\":\"1\"}\n").expect("write");
        fs::write(data_dir.join("nested").join("meta.txt"), b"hello").expect("write");

        let zip_path = dir.path().join("snap.zip");
        let manifest = BackupManifest {
            instance_id: "i1".to_string(),
            instance_name: "Test".to_string(),
            engine_type: "lancedb".to_string(),
            engine_version: "embedded-1.0".to_string(),
            created_at: 1000,
        };
        create_data_zip(&data_dir, &manifest, &zip_path).expect("create backup zip");
        assert!(zip_path.is_file());

        // Overwrite live folder and restore
        fs::write(data_dir.join("records.jsonl"), b"corrupted").expect("overwrite");
        restore_data_zip(&zip_path, &data_dir).expect("restore");

        assert_eq!(
            fs::read_to_string(data_dir.join("records.jsonl")).expect("read"),
            "{\"id\":\"1\"}\n"
        );
        assert_eq!(
            fs::read_to_string(data_dir.join("nested").join("meta.txt")).expect("read"),
            "hello"
        );
    }
}
