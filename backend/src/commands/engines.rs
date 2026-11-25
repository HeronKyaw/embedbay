use tauri::State;

use crate::db::models::InstalledEngine;
use crate::engines::installer;
use crate::engines::manifest::CatalogEngineView;
use crate::platform;
use crate::AppState;

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
