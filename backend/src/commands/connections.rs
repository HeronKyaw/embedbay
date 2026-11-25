use tauri::State;
use uuid::Uuid;

use crate::adapters::embeddings::{self, EmbeddingTestResult};
use crate::db::models::{
    CreateEmbeddingProfilePayload, CreateRemoteConnectionPayload, EmbeddingProfile,
    RemoteConnection, UpdateEmbeddingProfilePayload, UpdateRemoteConnectionPayload,
};
use crate::db::Database;
use crate::platform::secrets;
use crate::AppState;

pub fn create_remote_connection_impl(
    db: &Database,
    payload: CreateRemoteConnectionPayload,
) -> Result<RemoteConnection, String> {
    let id = Uuid::new_v4().to_string();
    let secret_ref = match payload
        .secret
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(secret_val) => {
            let ref_key = format!("remote_conn:{}", id);
            secrets::store_secret(&ref_key, secret_val)?;
            Some(ref_key)
        }
        None => None,
    };

    db.insert_remote_connection(id, payload, secret_ref)
        .map_err(|e| e.to_string())
}

pub fn update_remote_connection_impl(
    db: &Database,
    id: &str,
    payload: UpdateRemoteConnectionPayload,
) -> Result<RemoteConnection, String> {
    let existing = db
        .get_remote_connection(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Remote connection '{}' not found", id))?;

    let new_secret_ref = match &payload.secret {
        Some(Some(val)) if !val.trim().is_empty() => {
            let ref_key = existing
                .secret_ref
                .clone()
                .unwrap_or_else(|| format!("remote_conn:{}", id));
            secrets::store_secret(&ref_key, val.trim())?;
            Some(Some(ref_key))
        }
        Some(None) => {
            if let Some(ref_key) = &existing.secret_ref {
                let _ = secrets::delete_secret(ref_key);
            }
            Some(None)
        }
        _ => None,
    };

    db.update_remote_connection_record(id, payload, new_secret_ref)
        .map_err(|e| e.to_string())
}

pub fn delete_remote_connection_impl(db: &Database, id: &str) -> Result<bool, String> {
    if let Ok(Some(existing)) = db.get_remote_connection(id) {
        if let Some(ref_key) = &existing.secret_ref {
            let _ = secrets::delete_secret(ref_key);
        }
    }
    db.delete_remote_connection(id).map_err(|e| e.to_string())
}

pub fn create_embedding_profile_impl(
    db: &Database,
    payload: CreateEmbeddingProfilePayload,
) -> Result<EmbeddingProfile, String> {
    let id = Uuid::new_v4().to_string();
    let secret_ref = match payload
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(key) => {
            let ref_key = format!("embed_profile:{}", id);
            secrets::store_secret(&ref_key, key)?;
            Some(ref_key)
        }
        None => None,
    };
    db.insert_embedding_profile(id, payload, secret_ref)
        .map_err(|e| e.to_string())
}

pub fn update_embedding_profile_impl(
    db: &Database,
    id: &str,
    payload: UpdateEmbeddingProfilePayload,
) -> Result<EmbeddingProfile, String> {
    let existing = db
        .get_embedding_profile(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Embedding profile '{}' not found", id))?;

    let new_secret_ref = match &payload.api_key {
        Some(Some(val)) if !val.trim().is_empty() => {
            let ref_key = existing
                .secret_ref
                .clone()
                .unwrap_or_else(|| format!("embed_profile:{}", id));
            secrets::store_secret(&ref_key, val.trim())?;
            Some(Some(ref_key))
        }
        Some(None) => {
            if let Some(ref_key) = &existing.secret_ref {
                let _ = secrets::delete_secret(ref_key);
            }
            Some(None)
        }
        _ => None,
    };

    db.update_embedding_profile_record(id, payload, new_secret_ref)
        .map_err(|e| e.to_string())
}

pub fn delete_embedding_profile_impl(db: &Database, id: &str) -> Result<bool, String> {
    if let Ok(Some(existing)) = db.get_embedding_profile(id) {
        if let Some(ref_key) = &existing.secret_ref {
            let _ = secrets::delete_secret(ref_key);
        }
    }
    db.delete_embedding_profile(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_remote_connections(state: State<'_, AppState>) -> Result<Vec<RemoteConnection>, String> {
    state.db.list_remote_connections().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_remote_connection(
    state: State<'_, AppState>,
    payload: CreateRemoteConnectionPayload,
) -> Result<RemoteConnection, String> {
    create_remote_connection_impl(&state.db, payload)
}

#[tauri::command]
pub fn update_remote_connection(
    state: State<'_, AppState>,
    id: String,
    payload: UpdateRemoteConnectionPayload,
) -> Result<RemoteConnection, String> {
    update_remote_connection_impl(&state.db, &id, payload)
}

#[tauri::command]
pub fn delete_remote_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    delete_remote_connection_impl(&state.db, &id)
}

#[tauri::command]
pub fn list_embedding_profiles(state: State<'_, AppState>) -> Result<Vec<EmbeddingProfile>, String> {
    state.db.list_embedding_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_embedding_profile(
    state: State<'_, AppState>,
    payload: CreateEmbeddingProfilePayload,
) -> Result<EmbeddingProfile, String> {
    create_embedding_profile_impl(&state.db, payload)
}

#[tauri::command]
pub fn update_embedding_profile(
    state: State<'_, AppState>,
    id: String,
    payload: UpdateEmbeddingProfilePayload,
) -> Result<EmbeddingProfile, String> {
    update_embedding_profile_impl(&state.db, &id, payload)
}

#[tauri::command]
pub fn delete_embedding_profile(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    delete_embedding_profile_impl(&state.db, &id)
}

#[tauri::command]
pub async fn test_embedding_profile(
    state: State<'_, AppState>,
    id: String,
) -> Result<EmbeddingTestResult, String> {
    let profile = state
        .db
        .get_embedding_profile(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Embedding profile '{}' not found", id))?;

    let api_key = match &profile.secret_ref {
        Some(ref_key) => secrets::get_secret(ref_key)?,
        None => None,
    };
    embeddings::test_embedding_profile(&profile, api_key.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn embed_texts(
    state: State<'_, AppState>,
    profile_id: String,
    texts: Vec<String>,
) -> Result<(Vec<Vec<f32>>, u64), String> {
    let profile = state
        .db
        .get_embedding_profile(&profile_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Embedding profile '{}' not found", profile_id))?;

    let api_key = match &profile.secret_ref {
        Some(ref_key) => secrets::get_secret(ref_key)?,
        None => None,
    };
    embeddings::embed_texts(&profile, api_key.as_deref(), &texts)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_secrets_never_stored_in_sqlite_plaintext() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        let conn = create_remote_connection_impl(
            &db,
            CreateRemoteConnectionPayload {
                name: "Prod Pinecone".to_string(),
                description: None,
                color: Some("#F43F5E".to_string()),
                group_id: None,
                engine_type: "pinecone".to_string(),
                endpoint_url: "https://example.svc.pinecone.io".to_string(),
                auth_type: "api_key".to_string(),
                secret: Some("super-secret-token-123".to_string()),
                extra_json: None,
                tag_ids: None,
            },
        )
        .expect("create remote connection");

        let ref_key = conn.secret_ref.clone().expect("secret_ref present");
        assert!(ref_key.starts_with("remote_conn:"));
        assert_eq!(
            secrets::get_secret(&ref_key).expect("read keyring"),
            Some("super-secret-token-123".to_string())
        );

        let raw_db_bytes = std::fs::read(db.db_path()).expect("read sqlite file");
        let raw_str = String::from_utf8_lossy(&raw_db_bytes);
        assert!(
            !raw_str.contains("super-secret-token-123"),
            "Secret leaked into SQLite database!"
        );

        delete_remote_connection_impl(&db, &conn.id).expect("delete remote conn");
        assert_eq!(secrets::get_secret(&ref_key).expect("after delete"), None);
    }
}
