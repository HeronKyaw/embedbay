use tauri::State;

use crate::adapters::{
    resolve_adapter, BrowseRecordsRequest, BrowseRecordsResponse, CollectionSchema,
    CollectionSummary, ConnectionTarget, ConnectionTestResult, CreateCollectionRequest,
    SearchRequest, SearchResponse, VectorRecord,
};
use crate::AppState;

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    target: ConnectionTarget,
) -> Result<ConnectionTestResult, String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;
    adapter.test_connection().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_collections(
    state: State<'_, AppState>,
    target: ConnectionTarget,
) -> Result<Vec<CollectionSummary>, String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;
    adapter.list_collections().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_collection_info(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
) -> Result<CollectionSchema, String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .get_collection_info(&collection)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_collection(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    request: CreateCollectionRequest,
) -> Result<(), String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .create_collection(request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_collection(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
) -> Result<(), String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .delete_collection(&collection)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browse_records(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    request: BrowseRecordsRequest,
) -> Result<BrowseRecordsResponse, String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .browse_records(&collection, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_records(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    records: Vec<VectorRecord>,
) -> Result<usize, String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .upsert_records(&collection, records)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_records(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    ids: Vec<String>,
) -> Result<usize, String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .delete_records(&collection, ids)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_vectors(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    query: SearchRequest,
) -> Result<SearchResponse, String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .search_vectors(&collection, query)
        .await
        .map_err(|e| e.to_string())
}
