pub mod connections;
pub mod engines;
pub mod explorer;
pub mod groups_tags;
pub mod instances;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::platform::{self, PlatformInfo};
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct AppStatus {
    pub platform: PlatformInfo,
    pub data_dir: String,
    pub db_path: String,
    pub schema_version: i64,
    pub autostart_enabled: bool,
}

#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    platform::platform_info()
}

#[tauri::command]
pub fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.disable().map_err(|e| e.to_string())?;
    }
    autolaunch.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_app_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppStatus, String> {
    let schema_version = state.db.schema_version().map_err(|e| e.to_string())?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

    Ok(AppStatus {
        platform: platform::platform_info(),
        data_dir: state.db.data_root().to_string_lossy().into_owned(),
        db_path: state.db.db_path().to_string_lossy().into_owned(),
        schema_version,
        autostart_enabled,
    })
}
