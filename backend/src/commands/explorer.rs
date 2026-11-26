use tauri::State;

use crate::adapters::{
    assert_writable, resolve_adapter, BrowseRecordsRequest, BrowseRecordsResponse,
    CollectionIndexInfo, CollectionSchema, CollectionSummary, ConnectionTarget,
    ConnectionTestResult, CreateCollectionRequest, CreateIndexRequest, SearchRequest,
    SearchResponse, VectorRecord,
};
use crate::db::Database;
use crate::supervisor::process_manager::ProcessManager;
use crate::AppState;

pub async fn list_collections_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
) -> Result<Vec<CollectionSummary>, String> {
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter.list_collections().await.map_err(|e| e.to_string())
}

pub async fn create_collection_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
    request: CreateCollectionRequest,
) -> Result<(), String> {
    assert_writable(db, target)?;
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .create_collection(request)
        .await
        .map_err(|e| e.to_string())
}

pub async fn delete_collection_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
    collection: &str,
) -> Result<(), String> {
    assert_writable(db, target)?;
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .delete_collection(collection)
        .await
        .map_err(|e| e.to_string())
}

pub async fn browse_records_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
    collection: &str,
    request: BrowseRecordsRequest,
) -> Result<BrowseRecordsResponse, String> {
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .browse_records(collection, request)
        .await
        .map_err(|e| e.to_string())
}

pub async fn upsert_records_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
    collection: &str,
    records: Vec<VectorRecord>,
) -> Result<usize, String> {
    assert_writable(db, target)?;
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .upsert_records(collection, records)
        .await
        .map_err(|e| e.to_string())
}

pub async fn delete_records_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
    collection: &str,
    ids: Vec<String>,
) -> Result<usize, String> {
    assert_writable(db, target)?;
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .delete_records(collection, ids)
        .await
        .map_err(|e| e.to_string())
}

pub async fn search_vectors_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
    collection: &str,
    query: SearchRequest,
) -> Result<SearchResponse, String> {
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .search_vectors(collection, query)
        .await
        .map_err(|e| e.to_string())
}

pub async fn list_collection_indexes_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
    collection: &str,
) -> Result<Vec<CollectionIndexInfo>, String> {
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .list_indexes(collection)
        .await
        .map_err(|e| e.to_string())
}

pub async fn create_collection_index_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
    collection: &str,
    request: CreateIndexRequest,
) -> Result<(), String> {
    assert_writable(db, target)?;
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .create_index(collection, request)
        .await
        .map_err(|e| e.to_string())
}

pub async fn delete_collection_index_impl(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
    collection: &str,
    index_name: &str,
) -> Result<(), String> {
    assert_writable(db, target)?;
    let adapter = resolve_adapter(db, pm, target)
        .await
        .map_err(|e| e.to_string())?;
    adapter
        .delete_index(collection, index_name)
        .await
        .map_err(|e| e.to_string())
}

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
    list_collections_impl(&state.db, &state.process_manager, &target).await
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
    create_collection_impl(&state.db, &state.process_manager, &target, request).await
}

#[tauri::command]
pub async fn delete_collection(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
) -> Result<(), String> {
    delete_collection_impl(&state.db, &state.process_manager, &target, &collection).await
}

#[tauri::command]
pub async fn browse_records(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    request: BrowseRecordsRequest,
) -> Result<BrowseRecordsResponse, String> {
    browse_records_impl(
        &state.db,
        &state.process_manager,
        &target,
        &collection,
        request,
    )
    .await
}

#[tauri::command]
pub async fn upsert_records(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    records: Vec<VectorRecord>,
) -> Result<usize, String> {
    upsert_records_impl(
        &state.db,
        &state.process_manager,
        &target,
        &collection,
        records,
    )
    .await
}

#[tauri::command]
pub async fn delete_records(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    ids: Vec<String>,
) -> Result<usize, String> {
    delete_records_impl(&state.db, &state.process_manager, &target, &collection, ids).await
}

#[tauri::command]
pub async fn search_vectors(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    query: SearchRequest,
) -> Result<SearchResponse, String> {
    search_vectors_impl(&state.db, &state.process_manager, &target, &collection, query).await
}

#[tauri::command]
pub async fn list_collection_indexes(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
) -> Result<Vec<CollectionIndexInfo>, String> {
    list_collection_indexes_impl(&state.db, &state.process_manager, &target, &collection).await
}

#[tauri::command]
pub async fn create_collection_index(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    request: CreateIndexRequest,
) -> Result<(), String> {
    create_collection_index_impl(
        &state.db,
        &state.process_manager,
        &target,
        &collection,
        request,
    )
    .await
}

#[tauri::command]
pub async fn delete_collection_index(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    index_name: String,
) -> Result<(), String> {
    delete_collection_index_impl(
        &state.db,
        &state.process_manager,
        &target,
        &collection,
        &index_name,
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;
    use crate::commands::connections::create_remote_connection_impl;
    use crate::db::models::CreateRemoteConnectionPayload;
    use crate::supervisor::logs::InstanceLogStore;

    async fn spawn_mock_qdrant() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock qdrant");
        let port = listener.local_addr().expect("addr").port();

        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = [0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let first_line = req.lines().next().unwrap_or("");

                let body = if first_line.starts_with("GET /collections ") {
                    json!({ "result": { "collections": [{ "name": "docs" }] } })
                } else if first_line.starts_with("GET /collections/docs ") {
                    json!({
                        "result": {
                            "points_count": 1,
                            "segments_count": 1,
                            "config": { "params": { "vectors": { "size": 3, "distance": "Cosine" } } },
                            "payload_schema": {}
                        }
                    })
                } else if first_line.starts_with("POST /collections/docs/points/scroll ") {
                    json!({
                        "result": {
                            "points": [
                                { "id": 1, "payload": { "topic": "rust" }, "vector": [0.1, 0.2, 0.3] }
                            ],
                            "next_page_offset": null
                        }
                    })
                } else if first_line.starts_with("POST /collections/docs/points/query ") {
                    json!({
                        "result": {
                            "points": [
                                { "id": 1, "score": 0.99, "payload": { "topic": "rust" } }
                            ]
                        }
                    })
                } else {
                    json!({ "result": true, "status": "ok" })
                };

                let text = serde_json::to_string(&body).expect("json");
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    text.len(),
                    text
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });

        (format!("http://127.0.0.1:{}", port), handle)
    }

    #[tokio::test]
    async fn read_only_remote_connection_blocks_writes_and_allows_reads() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Arc::new(Database::init(dir.path().to_path_buf()).expect("db init"));
        let logs = Arc::new(InstanceLogStore::default());
        let pm = ProcessManager::new(Arc::clone(&db), logs);

        let (url, server) = spawn_mock_qdrant().await;
        let conn = create_remote_connection_impl(
            &db,
            CreateRemoteConnectionPayload {
                name: "Prod ReadOnly".to_string(),
                description: None,
                color: Some("#F43F5E".to_string()),
                group_id: None,
                engine_type: "qdrant".to_string(),
                endpoint_url: url,
                auth_type: "none".to_string(),
                secret: None,
                extra_json: None,
                read_only: Some(true),
                tag_ids: None,
            },
        )
        .expect("create remote connection");
        assert!(conn.read_only);

        let target = ConnectionTarget::RemoteConnection {
            connection_id: conn.id.clone(),
        };

        // Mutating operations must be blocked
        let create_err = create_collection_impl(
            &db,
            &pm,
            &target,
            CreateCollectionRequest {
                name: "new_col".to_string(),
                dimensions: 3,
                distance_metric: "cosine".to_string(),
                index_type: None,
            },
        )
        .await
        .expect_err("create_collection should be blocked");
        assert!(create_err.contains("Read-Only"));

        let delete_col_err = delete_collection_impl(&db, &pm, &target, "docs")
            .await
            .expect_err("delete_collection should be blocked");
        assert!(delete_col_err.contains("Read-Only"));

        let upsert_err = upsert_records_impl(
            &db,
            &pm,
            &target,
            "docs",
            vec![VectorRecord {
                id: "1".to_string(),
                payload: json!({}),
                document: None,
                vector: Some(vec![0.1, 0.2, 0.3]),
                score: None,
            }],
        )
        .await
        .expect_err("upsert_records should be blocked");
        assert!(upsert_err.contains("Read-Only"));

        let delete_rec_err = delete_records_impl(&db, &pm, &target, "docs", vec!["1".to_string()])
            .await
            .expect_err("delete_records should be blocked");
        assert!(delete_rec_err.contains("Read-Only"));

        let create_idx_err = create_collection_index_impl(
            &db,
            &pm,
            &target,
            "docs",
            CreateIndexRequest {
                field_name: "topic".to_string(),
                index_type: "keyword".to_string(),
                params: json!({}),
            },
        )
        .await
        .expect_err("create_collection_index should be blocked");
        assert!(create_idx_err.contains("Read-Only"));

        let delete_idx_err = delete_collection_index_impl(&db, &pm, &target, "docs", "topic")
            .await
            .expect_err("delete_collection_index should be blocked");
        assert!(delete_idx_err.contains("Read-Only"));

        list_collection_indexes_impl(&db, &pm, &target, "docs")
            .await
            .expect("list_collection_indexes allowed");

        // Read and search operations must remain allowed
        let cols = list_collections_impl(&db, &pm, &target)
            .await
            .expect("list_collections allowed");
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "docs");

        let browsed = browse_records_impl(
            &db,
            &pm,
            &target,
            "docs",
            BrowseRecordsRequest {
                limit: 10,
                offset: 0,
                cursor: None,
                include_vectors: true,
                filter: None,
            },
        )
        .await
        .expect("browse_records allowed");
        assert_eq!(browsed.records.len(), 1);

        let searched = search_vectors_impl(
            &db,
            &pm,
            &target,
            "docs",
            SearchRequest {
                vector: vec![0.1, 0.2, 0.3],
                top_k: 5,
                score_threshold: None,
                include_vectors: false,
                filter: None,
            },
        )
        .await
        .expect("search_vectors allowed");
        assert_eq!(searched.records.len(), 1);

        server.abort();
    }
}
