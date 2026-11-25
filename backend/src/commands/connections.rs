use tauri::State;
use uuid::Uuid;

use crate::adapters::embeddings::{self, EmbeddingTestResult};
use crate::db::models::{
    CreateEmbeddingProfilePayload, CreateRemoteConnectionPayload, EmbeddingProfile,
    RemoteConnection, TestEmbeddingProfileDraftPayload, UpdateEmbeddingProfilePayload,
    UpdateRemoteConnectionPayload,
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
pub async fn test_embedding_profile_draft(
    state: State<'_, AppState>,
    payload: TestEmbeddingProfileDraftPayload,
) -> Result<EmbeddingTestResult, String> {
    let model_name = payload.model_name.trim().to_string();
    if model_name.is_empty() {
        return Err("Model name is required".to_string());
    }

    let api_key = if payload.provider == "openai_compatible" {
        if let Some(key) = payload
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(key.to_string())
        } else if let Some(ref pid) = payload.profile_id {
            let existing = state
                .db
                .get_embedding_profile(pid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Embedding profile '{}' not found", pid))?;
            match &existing.secret_ref {
                Some(ref_key) => secrets::get_secret(ref_key)?,
                None => None,
            }
        } else {
            None
        }
    } else {
        None
    };

    let temp_profile = EmbeddingProfile {
        id: "draft".to_string(),
        name: "Draft".to_string(),
        provider: payload.provider,
        model_name,
        base_url: payload
            .base_url
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        dimensions: None,
        secret_ref: None,
    };

    embeddings::test_embedding_profile(&temp_profile, api_key.as_deref())
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

    #[test]
    fn embedding_profile_crud_and_secret_clearing() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = Database::init(dir.path().to_path_buf()).expect("db init");

        let profile = create_embedding_profile_impl(
            &db,
            CreateEmbeddingProfilePayload {
                name: "OpenAI Small".to_string(),
                provider: "openai_compatible".to_string(),
                model_name: "text-embedding-3-small".to_string(),
                base_url: Some("https://api.openai.com/v1".to_string()),
                dimensions: Some(1536),
                api_key: Some("sk-embed-secret-xyz".to_string()),
            },
        )
        .expect("create embedding profile");

        let ref_key = profile.secret_ref.clone().expect("secret_ref present");
        assert!(ref_key.starts_with("embed_profile:"));
        assert_eq!(
            secrets::get_secret(&ref_key).expect("read keyring"),
            Some("sk-embed-secret-xyz".to_string())
        );

        let raw_db_bytes = std::fs::read(db.db_path()).expect("read sqlite file");
        let raw_str = String::from_utf8_lossy(&raw_db_bytes);
        assert!(
            !raw_str.contains("sk-embed-secret-xyz"),
            "Embedding API key leaked into SQLite database!"
        );

        // Omitting api_key in JSON must deserialize to None and keep existing keyring secret intact.
        let keep_key_payload: UpdateEmbeddingProfilePayload =
            serde_json::from_str(r#"{"name": "OpenAI Renamed"}"#).expect("deserialize omit");
        assert!(keep_key_payload.api_key.is_none());
        let updated_keep = update_embedding_profile_impl(&db, &profile.id, keep_key_payload)
            .expect("update keeping secret");
        assert_eq!(updated_keep.name, "OpenAI Renamed");
        assert_eq!(updated_keep.dimensions, Some(1536));
        assert_eq!(updated_keep.secret_ref.as_deref(), Some(ref_key.as_str()));
        assert_eq!(
            secrets::get_secret(&ref_key).expect("read kept keyring"),
            Some("sk-embed-secret-xyz".to_string())
        );

        // Explicit JSON null must deserialize to Some(None) and clear dimensions & keyring secret.
        let clear_payload: UpdateEmbeddingProfilePayload =
            serde_json::from_str(r#"{"dimensions": null, "api_key": null}"#)
                .expect("deserialize nulls");
        assert_eq!(clear_payload.dimensions, Some(None));
        assert_eq!(clear_payload.api_key, Some(None));
        let updated_clear = update_embedding_profile_impl(&db, &profile.id, clear_payload)
            .expect("update clearing secret");
        assert_eq!(updated_clear.dimensions, None);
        assert_eq!(updated_clear.secret_ref, None);
        assert_eq!(secrets::get_secret(&ref_key).expect("cleared keyring"), None);

        // Re-save a secret and ensure delete removes both profile and keyring secret.
        let rekey_payload: UpdateEmbeddingProfilePayload =
            serde_json::from_str(r#"{"api_key": "sk-new-key"}"#).expect("deserialize new key");
        let updated_rekey = update_embedding_profile_impl(&db, &profile.id, rekey_payload)
            .expect("update with new key");
        let new_ref = updated_rekey.secret_ref.expect("new secret_ref");
        assert_eq!(
            secrets::get_secret(&new_ref).expect("read new keyring"),
            Some("sk-new-key".to_string())
        );

        delete_embedding_profile_impl(&db, &profile.id).expect("delete embedding profile");
        assert_eq!(secrets::get_secret(&new_ref).expect("after delete"), None);
    }
}
