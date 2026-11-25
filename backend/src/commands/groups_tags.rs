use tauri::State;

use crate::db::models::{
    ConnectionGroup, CreateGroupPayload, ReorderItem, Tag, UpdateGroupPayload,
};
use crate::AppState;

#[tauri::command]
pub fn list_groups(state: State<'_, AppState>) -> Result<Vec<ConnectionGroup>, String> {
    state.db.list_groups().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_group(
    state: State<'_, AppState>,
    payload: CreateGroupPayload,
) -> Result<ConnectionGroup, String> {
    state.db.create_group(payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_group(
    state: State<'_, AppState>,
    id: String,
    payload: UpdateGroupPayload,
) -> Result<ConnectionGroup, String> {
    state
        .db
        .update_group(&id, payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_group(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.db.delete_group(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_items(state: State<'_, AppState>, items: Vec<ReorderItem>) -> Result<(), String> {
    state.db.reorder_items(&items).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    state.db.list_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tag(
    state: State<'_, AppState>,
    name: String,
    color: String,
) -> Result<Tag, String> {
    state.db.create_tag(name, color).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_tag(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<Tag, String> {
    state
        .db
        .update_tag(&id, name, color)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    state.db.delete_tag(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_entity_tags(
    state: State<'_, AppState>,
    entity_type: String,
    entity_id: String,
    tag_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    state
        .db
        .set_entity_tags(&entity_type, &entity_id, &tag_ids)
        .map_err(|e| e.to_string())
}
