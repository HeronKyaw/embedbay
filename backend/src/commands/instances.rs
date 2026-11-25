use std::path::Path;

use tauri::State;

use crate::db::models::{CreateInstancePayload, InstanceRecord, UpdateInstancePayload};
use crate::supervisor::logs::LogEntry;
use crate::supervisor::metrics::{InstanceMetrics, SystemMetricsSummary};
use crate::supervisor::process_manager::{
    check_port_available as raw_check_port, suggest_available_port as raw_suggest_port,
    BatchActionResult,
};
use crate::AppState;

#[tauri::command]
pub fn list_instances(state: State<'_, AppState>) -> Result<Vec<InstanceRecord>, String> {
    state.db.list_instances().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_instance(
    state: State<'_, AppState>,
    payload: CreateInstancePayload,
) -> Result<InstanceRecord, String> {
    let instance = state
        .db
        .create_instance(payload)
        .map_err(|e| e.to_string())?;
    let root = state.db.instance_root(&instance.id);
    let _ = std::fs::create_dir_all(root.join("config"));
    let _ = std::fs::create_dir_all(root.join("logs"));
    let _ = std::fs::create_dir_all(Path::new(&instance.data_dir));
    Ok(instance)
}

#[tauri::command]
pub async fn update_instance(
    state: State<'_, AppState>,
    id: String,
    payload: UpdateInstancePayload,
) -> Result<InstanceRecord, String> {
    let needs_stop = payload.port.is_some()
        || payload.grpc_port.is_some()
        || payload.host.is_some()
        || payload.engine_version.is_some()
        || payload.data_dir.is_some()
        || payload.config_json.is_some();

    if needs_stop && state.process_manager.is_instance_running(&id).await {
        return Err("Stop the instance before changing host, port, version, or data directory.".to_string());
    }

    state
        .db
        .update_instance(&id, payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_instance(
    state: State<'_, AppState>,
    id: String,
    delete_data: bool,
) -> Result<(), String> {
    let existing = state
        .db
        .get_instance(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Instance '{}' not found", id))?;

    if state.process_manager.is_instance_running(&id).await {
        state.process_manager.stop_instance(&id).await?;
    }

    state.db.delete_instance(&id).map_err(|e| e.to_string())?;

    if delete_data {
        let root = state.db.instance_root(&id);
        if root.exists() {
            let _ = std::fs::remove_dir_all(&root);
        }
        let data_path = Path::new(&existing.data_dir);
        if data_path.exists() && !data_path.starts_with(&root) {
            let _ = std::fs::remove_dir_all(data_path);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn start_instance(
    state: State<'_, AppState>,
    id: String,
) -> Result<InstanceMetrics, String> {
    state.process_manager.start_instance(&id).await
}

#[tauri::command]
pub async fn stop_instance(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.process_manager.stop_instance(&id).await
}

#[tauri::command]
pub async fn restart_instance(
    state: State<'_, AppState>,
    id: String,
) -> Result<InstanceMetrics, String> {
    state.process_manager.restart_instance(&id).await
}

#[tauri::command]
pub async fn force_kill_instance(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.process_manager.force_kill_instance(&id).await
}

#[tauri::command]
pub async fn start_group_instances(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Vec<BatchActionResult>, String> {
    state.process_manager.start_group_instances(&group_id).await
}

#[tauri::command]
pub async fn stop_group_instances(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Vec<BatchActionResult>, String> {
    state.process_manager.stop_group_instances(&group_id).await
}

#[tauri::command]
pub async fn stop_all_instances(
    state: State<'_, AppState>,
) -> Result<Vec<BatchActionResult>, String> {
    Ok(state.process_manager.stop_all_instances().await)
}

#[tauri::command]
pub async fn stop_idle_instances(
    state: State<'_, AppState>,
    idle_minutes: Option<i64>,
) -> Result<Vec<BatchActionResult>, String> {
    Ok(state
        .process_manager
        .stop_idle_instances(idle_minutes.unwrap_or(5))
        .await)
}

#[tauri::command]
pub async fn get_all_instance_metrics(
    state: State<'_, AppState>,
) -> Result<SystemMetricsSummary, String> {
    state.process_manager.get_all_instance_metrics().await
}

#[tauri::command]
pub fn get_instance_logs(
    state: State<'_, AppState>,
    id: String,
    limit: Option<usize>,
) -> Result<Vec<LogEntry>, String> {
    let log_dir = state.process_manager.log_dir_for(&id);
    Ok(state.logs.get_logs(&id, &log_dir, limit.unwrap_or(500)))
}

#[tauri::command]
pub fn subscribe_instance_logs(
    state: State<'_, AppState>,
    id: String,
    limit: Option<usize>,
) -> Result<Vec<LogEntry>, String> {
    let log_dir = state.process_manager.log_dir_for(&id);
    Ok(state.logs.get_logs(&id, &log_dir, limit.unwrap_or(500)))
}

#[tauri::command]
pub fn clear_instance_logs(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let log_dir = state.process_manager.log_dir_for(&id);
    state.logs.clear_logs(&id, &log_dir)
}

#[tauri::command]
pub fn check_port_available(host: Option<String>, port: u16) -> bool {
    raw_check_port(host.as_deref().unwrap_or("127.0.0.1"), port)
}

#[tauri::command]
pub fn suggest_available_port(
    state: State<'_, AppState>,
    host: Option<String>,
    start_port: u16,
) -> Result<u16, String> {
    raw_suggest_port(&state.db, host.as_deref().unwrap_or("127.0.0.1"), start_port)
}
