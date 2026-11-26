use tauri::State;

use crate::db::models::{
    SaveSearchHistoryPayload, SaveSearchPresetPayload, SearchHistoryItem, SearchPreset,
};
use crate::AppState;

#[tauri::command]
pub fn list_search_history(
    state: State<'_, AppState>,
    connection_key: String,
    collection: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHistoryItem>, String> {
    state
        .db
        .list_search_history(&connection_key, &collection, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_search_history(
    state: State<'_, AppState>,
    payload: SaveSearchHistoryPayload,
) -> Result<SearchHistoryItem, String> {
    state
        .db
        .record_search_history(payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_search_history(
    state: State<'_, AppState>,
    connection_key: String,
    collection: String,
) -> Result<usize, String> {
    state
        .db
        .clear_search_history(&connection_key, &collection)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_search_presets(
    state: State<'_, AppState>,
    connection_key: String,
    collection: String,
) -> Result<Vec<SearchPreset>, String> {
    state
        .db
        .list_search_presets(&connection_key, &collection)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_search_preset(
    state: State<'_, AppState>,
    payload: SaveSearchPresetPayload,
) -> Result<SearchPreset, String> {
    state
        .db
        .save_search_preset(payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_search_preset(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state
        .db
        .delete_search_preset(&id)
        .map_err(|e| e.to_string())
}
