use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::db::models::InstalledEngine;
use crate::db::Database;
use crate::engines::installer;
use crate::engines::manifest::CatalogEngineView;
use crate::platform;
use crate::supervisor::metrics::dir_size_bytes;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct InstalledEngineStorage {
    pub id: String,
    pub engine_type: String,
    pub version: String,
    pub binary_path: String,
    pub size_bytes: u64,
    pub in_use_by: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceStorage {
    pub instance_id: String,
    pub name: String,
    pub engine_type: String,
    pub data_dir: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageUsageSummary {
    pub data_root: String,
    pub total_engine_bytes: u64,
    pub unused_engine_bytes: u64,
    pub unused_engine_count: usize,
    pub total_instance_bytes: u64,
    pub db_bytes: u64,
    pub logs_bytes: u64,
    pub engines: Vec<InstalledEngineStorage>,
    pub instances: Vec<InstanceStorage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CleanupResult {
    pub removed_count: usize,
    pub freed_bytes: u64,
    pub removed_ids: Vec<String>,
    pub skipped: Vec<String>,
}

pub fn compute_storage_usage(db: &Database) -> Result<StorageUsageSummary, String> {
    let installed = db.list_installed_engines().map_err(|e| e.to_string())?;
    let all_instances = db.list_instances().map_err(|e| e.to_string())?;

    let mut total_engine_bytes = 0u64;
    let mut unused_engine_bytes = 0u64;
    let mut unused_engine_count = 0usize;
    let mut engines = Vec::with_capacity(installed.len());

    for eng in installed {
        let engine_dir = db.bin_dir().join(&eng.engine_type).join(&eng.version);
        let size_bytes = if engine_dir.exists() {
            dir_size_bytes(&engine_dir)
        } else if !eng.binary_path.is_empty() && Path::new(&eng.binary_path).is_file() {
            std::fs::metadata(&eng.binary_path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        let in_use_by: Vec<String> = db
            .list_instances_using_engine(&eng.engine_type, &eng.version)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|inst| inst.name)
            .collect();

        total_engine_bytes = total_engine_bytes.saturating_add(size_bytes);
        if in_use_by.is_empty() {
            unused_engine_count += 1;
            unused_engine_bytes = unused_engine_bytes.saturating_add(size_bytes);
        }

        engines.push(InstalledEngineStorage {
            id: eng.id,
            engine_type: eng.engine_type,
            version: eng.version,
            binary_path: eng.binary_path,
            size_bytes,
            in_use_by,
        });
    }

    let mut total_instance_bytes = 0u64;
    let mut logs_bytes = 0u64;
    let mut instances = Vec::with_capacity(all_instances.len());
    for inst in all_instances {
        let size_bytes = dir_size_bytes(Path::new(&inst.data_dir));
        let inst_logs_dir = db.instance_root(&inst.id).join("logs");
        logs_bytes = logs_bytes.saturating_add(dir_size_bytes(&inst_logs_dir));
        total_instance_bytes = total_instance_bytes.saturating_add(size_bytes);
        instances.push(InstanceStorage {
            instance_id: inst.id,
            name: inst.name,
            engine_type: inst.engine_type,
            data_dir: inst.data_dir,
            size_bytes,
        });
    }

    instances.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.name.cmp(&b.name))
    });

    let (db_main, db_wal, db_shm) = db.db_storage_bytes();
    let db_bytes = db_main.saturating_add(db_wal).saturating_add(db_shm);

    Ok(StorageUsageSummary {
        data_root: db.data_root().to_string_lossy().into_owned(),
        total_engine_bytes,
        unused_engine_bytes,
        unused_engine_count,
        total_instance_bytes,
        db_bytes,
        logs_bytes,
        engines,
        instances,
    })
}

pub fn cleanup_unused_engines_inner(db: &Database) -> Result<CleanupResult, String> {
    let installed = db.list_installed_engines().map_err(|e| e.to_string())?;
    let mut removed_count = 0usize;
    let mut freed_bytes = 0u64;
    let mut removed_ids = Vec::new();
    let mut skipped = Vec::new();

    for eng in installed {
        let refs = db
            .list_instances_using_engine(&eng.engine_type, &eng.version)
            .map_err(|e| e.to_string())?;
        if !refs.is_empty() {
            continue;
        }

        let engine_dir = db.bin_dir().join(&eng.engine_type).join(&eng.version);
        let size_bytes = if engine_dir.exists() {
            dir_size_bytes(&engine_dir)
        } else {
            0
        };

        match installer::uninstall_engine(db, &eng.id) {
            Ok(()) => {
                removed_count += 1;
                freed_bytes = freed_bytes.saturating_add(size_bytes);
                removed_ids.push(eng.id);
            }
            Err(e) => {
                skipped.push(format!("{} v{}: {}", eng.engine_type, eng.version, e));
            }
        }
    }

    Ok(CleanupResult {
        removed_count,
        freed_bytes,
        removed_ids,
        skipped,
    })
}

#[tauri::command]
pub fn list_engine_catalog(state: State<'_, AppState>) -> Result<Vec<CatalogEngineView>, String> {
    state
        .manifest
        .catalog_for_target(platform::target_triple(), &state.db)
}

#[tauri::command]
pub fn list_installed_engines(state: State<'_, AppState>) -> Result<Vec<InstalledEngine>, String> {
    state.db.list_installed_engines().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_storage_usage(state: State<'_, AppState>) -> Result<StorageUsageSummary, String> {
    compute_storage_usage(&state.db)
}

#[tauri::command]
pub async fn cleanup_unused_engines(state: State<'_, AppState>) -> Result<CleanupResult, String> {
    cleanup_unused_engines_inner(&state.db)
}

#[tauri::command]
pub fn compact_database(state: State<'_, AppState>) -> Result<crate::db::VacuumResult, String> {
    state.db.vacuum_database().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_engine(
    state: State<'_, AppState>,
    engine_type: String,
    version: String,
) -> Result<InstalledEngine, String> {
    installer::install_engine(
        &state.db,
        &state.manifest,
        Some(state.event_sink.as_ref()),
        &engine_type,
        &version,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn uninstall_engine(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Ok(Some(engine)) = state.db.get_installed_engine(&id) {
        if let Ok(refs) = state
            .db
            .list_instances_using_engine(&engine.engine_type, &engine.version)
        {
            for inst in refs {
                if state.process_manager.is_instance_running(&inst.id).await {
                    return Err(format!(
                        "Stop running instance '{}' before uninstalling {} v{}",
                        inst.name, engine.engine_type, engine.version
                    ));
                }
            }
        }
    }
    installer::uninstall_engine(&state.db, &id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::CreateInstancePayload;

    #[test]
    fn cleanup_removes_only_unreferenced_engine_versions() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        let unused_dir = db.bin_dir().join("qdrant").join("1.19.0");
        let active_dir = db.bin_dir().join("qdrant").join("1.20.2");
        std::fs::create_dir_all(&unused_dir).expect("mkdir unused");
        std::fs::create_dir_all(&active_dir).expect("mkdir active");

        let unused_bin = unused_dir.join("qdrant.exe");
        let active_bin = active_dir.join("qdrant.exe");
        std::fs::write(&unused_bin, vec![0xABu8; 4096]).expect("write unused binary");
        std::fs::write(&active_bin, vec![0xCDu8; 8192]).expect("write active binary");

        db.upsert_installed_engine(&InstalledEngine {
            id: "qdrant-1.19.0".to_string(),
            engine_type: "qdrant".to_string(),
            version: "1.19.0".to_string(),
            target_triple: "x86_64-pc-windows-msvc".to_string(),
            binary_path: unused_bin.to_string_lossy().into_owned(),
            sha256: "0000".to_string(),
            installed_at: 1000,
        })
        .expect("insert unused engine");

        db.upsert_installed_engine(&InstalledEngine {
            id: "qdrant-1.20.2".to_string(),
            engine_type: "qdrant".to_string(),
            version: "1.20.2".to_string(),
            target_triple: "x86_64-pc-windows-msvc".to_string(),
            binary_path: active_bin.to_string_lossy().into_owned(),
            sha256: "1111".to_string(),
            installed_at: 2000,
        })
        .expect("insert active engine");

        let active_inst = db
            .create_instance(CreateInstancePayload {
                name: "Active Prod Qdrant".to_string(),
                description: None,
                color: None,
                group_id: None,
                engine_type: "qdrant".to_string(),
                engine_version: "1.20.2".to_string(),
                host: Some("127.0.0.1".to_string()),
                port: 16433,
                grpc_port: Some(16434),
                data_dir: None,
                config_json: None,
                auto_start: Some(false),
                idle_timeout_minutes: Some(0),
                tag_ids: None,
            })
            .expect("create active instance");

        let logs_dir = db.instance_root(&active_inst.id).join("logs");
        std::fs::create_dir_all(&logs_dir).expect("mkdir logs");
        std::fs::write(logs_dir.join("instance.log"), vec![b'x'; 512]).expect("write log");

        let summary_before = compute_storage_usage(&db).expect("summary before");
        assert_eq!(summary_before.unused_engine_count, 1);
        assert_eq!(summary_before.unused_engine_bytes, 4096);
        assert_eq!(summary_before.total_engine_bytes, 4096 + 8192);
        assert!(summary_before.db_bytes > 0);
        assert_eq!(summary_before.logs_bytes, 512);

        let cleanup = cleanup_unused_engines_inner(&db).expect("cleanup");
        assert_eq!(cleanup.removed_count, 1);
        assert_eq!(cleanup.freed_bytes, 4096);
        assert_eq!(cleanup.removed_ids, vec!["qdrant-1.19.0".to_string()]);
        assert!(cleanup.skipped.is_empty());

        assert!(!unused_dir.exists());
        assert!(active_bin.exists());

        let summary_after = compute_storage_usage(&db).expect("summary after");
        assert_eq!(summary_after.unused_engine_count, 0);
        assert_eq!(summary_after.engines.len(), 1);
        assert_eq!(summary_after.engines[0].id, "qdrant-1.20.2");
    }
}
