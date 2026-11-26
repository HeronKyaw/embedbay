use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledEngine {
    pub id: String,
    pub engine_type: String,
    pub version: String,
    pub target_triple: String,
    pub binary_path: String,
    pub sha256: String,
    pub installed_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionGroup {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i64,
    pub is_collapsed: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateGroupPayload {
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateGroupPayload {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
    pub icon: Option<Option<String>>,
    pub sort_order: Option<i64>,
    pub is_collapsed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceRecord {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub engine_type: String,
    pub engine_version: String,
    pub host: String,
    pub port: u16,
    pub grpc_port: Option<u16>,
    pub data_dir: String,
    pub config_json: String,
    pub auto_start: bool,
    pub idle_timeout_minutes: i64,
    pub sort_order: i64,
    pub created_at: i64,
    pub tag_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateInstancePayload {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub engine_type: String,
    pub engine_version: String,
    pub host: Option<String>,
    pub port: u16,
    pub grpc_port: Option<u16>,
    pub data_dir: Option<String>,
    pub config_json: Option<String>,
    pub auto_start: Option<bool>,
    pub idle_timeout_minutes: Option<i64>,
    pub tag_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateInstancePayload {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub group_id: Option<Option<String>>,
    pub engine_version: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub grpc_port: Option<Option<u16>>,
    pub data_dir: Option<String>,
    pub config_json: Option<String>,
    pub auto_start: Option<bool>,
    pub idle_timeout_minutes: Option<i64>,
    pub sort_order: Option<i64>,
    pub tag_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReorderItem {
    pub entity_type: String,
    pub id: String,
    pub sort_order: i64,
    pub group_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteConnection {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub engine_type: String,
    pub endpoint_url: String,
    pub auth_type: String,
    pub secret_ref: Option<String>,
    pub extra_json: String,
    pub read_only: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub tag_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRemoteConnectionPayload {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub group_id: Option<String>,
    pub engine_type: String,
    pub endpoint_url: String,
    pub auth_type: String,
    pub secret: Option<String>,
    pub extra_json: Option<String>,
    #[serde(default)]
    pub read_only: Option<bool>,
    pub tag_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateRemoteConnectionPayload {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub group_id: Option<Option<String>>,
    pub engine_type: Option<String>,
    pub endpoint_url: Option<String>,
    pub auth_type: Option<String>,
    pub secret: Option<Option<String>>,
    pub extra_json: Option<String>,
    pub read_only: Option<bool>,
    pub sort_order: Option<i64>,
    pub tag_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingProfile {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub model_name: String,
    pub base_url: Option<String>,
    pub dimensions: Option<i64>,
    pub secret_ref: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateEmbeddingProfilePayload {
    pub name: String,
    pub provider: String,
    pub model_name: String,
    pub base_url: Option<String>,
    pub dimensions: Option<i64>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateEmbeddingProfilePayload {
    pub name: Option<String>,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub base_url: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub dimensions: Option<Option<i64>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub api_key: Option<Option<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TestEmbeddingProfileDraftPayload {
    pub profile_id: Option<String>,
    pub provider: String,
    pub model_name: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHistoryItem {
    pub id: String,
    pub connection_key: String,
    pub collection: String,
    pub search_mode: String,
    pub query_text: Option<String>,
    pub vector_json: Option<String>,
    pub embedding_profile_id: Option<String>,
    pub top_k: i64,
    pub score_threshold: Option<f64>,
    pub filter_json: Option<String>,
    pub result_count: i64,
    pub latency_ms: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveSearchHistoryPayload {
    pub connection_key: String,
    pub collection: String,
    pub search_mode: String,
    pub query_text: Option<String>,
    pub vector_json: Option<String>,
    pub embedding_profile_id: Option<String>,
    pub top_k: i64,
    pub score_threshold: Option<f64>,
    pub filter_json: Option<String>,
    pub result_count: i64,
    pub latency_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPreset {
    pub id: String,
    pub name: String,
    pub connection_key: String,
    pub collection: String,
    pub search_mode: String,
    pub query_text: Option<String>,
    pub vector_json: Option<String>,
    pub embedding_profile_id: Option<String>,
    pub top_k: i64,
    pub score_threshold: Option<f64>,
    pub filter_json: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveSearchPresetPayload {
    pub name: String,
    pub connection_key: String,
    pub collection: String,
    pub search_mode: String,
    pub query_text: Option<String>,
    pub vector_json: Option<String>,
    pub embedding_profile_id: Option<String>,
    pub top_k: i64,
    pub score_threshold: Option<f64>,
    pub filter_json: Option<String>,
}

fn deserialize_double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}
