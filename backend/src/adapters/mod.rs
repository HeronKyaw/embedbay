pub mod chroma;
pub mod embeddings;
pub mod qdrant;

use std::collections::HashMap;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::db::Database;
use crate::engines;
use crate::platform::secrets;
use crate::supervisor::process_manager::ProcessManager;

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("unsupported adapter engine: {0}")]
    UnsupportedEngine(String),
    #[error("connection not found: {0}")]
    NotFound(String),
    #[error("instance is not running: {0}")]
    InstanceNotRunning(String),
    #[error("HTTP request failed: {0}")]
    Http(String),
    #[error("backend API error: {0}")]
    Api(String),
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("secret lookup failed: {0}")]
    Secret(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectionTarget {
    LocalInstance {
        instance_id: String,
    },
    RemoteConnection {
        connection_id: String,
    },
    Direct {
        engine_type: String,
        endpoint_url: String,
        auth_type: String,
        secret: Option<String>,
        extra_json: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub engine_version: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectionSummary {
    pub name: String,
    pub vector_count: Option<u64>,
    pub dimensions: Option<usize>,
    pub distance_metric: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PayloadFieldSchema {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectionSchema {
    pub name: String,
    pub vector_count: u64,
    pub dimensions: Option<usize>,
    pub distance_metric: Option<String>,
    pub index_type: Option<String>,
    pub segment_count: Option<usize>,
    pub disk_bytes: Option<u64>,
    pub vector_field_name: Option<String>,
    pub payload_fields: Vec<PayloadFieldSchema>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCollectionRequest {
    pub name: String,
    pub dimensions: usize,
    pub distance_metric: String, // "cosine" | "dot" | "euclidean"
    #[serde(default)]
    pub index_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorRecord {
    pub id: String,
    pub payload: serde_json::Value,
    #[serde(default)]
    pub document: Option<String>,
    #[serde(default)]
    pub vector: Option<Vec<f32>>,
    #[serde(default)]
    pub score: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterLogic {
    And,
    Or,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCondition {
    pub field: String,
    pub op: String, // "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "contains"
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum FilterSpec {
    Visual {
        logic: FilterLogic,
        conditions: Vec<FilterCondition>,
    },
    RawJson {
        json: serde_json::Value,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct BrowseRecordsRequest {
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub include_vectors: bool,
    #[serde(default)]
    pub filter: Option<FilterSpec>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowseRecordsResponse {
    pub records: Vec<VectorRecord>,
    pub next_cursor: Option<String>,
    pub total_count: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchRequest {
    pub vector: Vec<f32>,
    pub top_k: usize,
    #[serde(default)]
    pub score_threshold: Option<f32>,
    #[serde(default)]
    pub include_vectors: bool,
    #[serde(default)]
    pub filter: Option<FilterSpec>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResponse {
    pub records: Vec<VectorRecord>,
    pub latency_ms: u64,
}

#[async_trait]
pub trait VectorDbAdapter: Send + Sync {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError>;
    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError>;
    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError>;
    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError>;
    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError>;
    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError>;
    async fn upsert_records(
        &self,
        collection: &str,
        records: Vec<VectorRecord>,
    ) -> Result<usize, AdapterError>;
    async fn delete_records(
        &self,
        collection: &str,
        ids: Vec<String>,
    ) -> Result<usize, AdapterError>;
    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError>;
}

pub fn http_client_for_url(url: &str, timeout_secs: u64) -> Result<reqwest::Client, AdapterError> {
    let lower = url.to_ascii_lowercase();
    let is_loopback = lower.contains("://127.0.0.1")
        || lower.contains("://localhost")
        || lower.contains("://[::1]");
    let mut builder = reqwest::Client::builder()
        .user_agent("EmbedBay/0.1")
        .timeout(Duration::from_secs(timeout_secs));
    if is_loopback {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|e| AdapterError::Http(e.to_string()))
}

pub fn parse_extra_json(raw: &str) -> HashMap<String, String> {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .map(|obj| {
            obj.into_iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

pub async fn resolve_adapter(
    db: &Database,
    pm: &ProcessManager,
    target: &ConnectionTarget,
) -> Result<Box<dyn VectorDbAdapter>, AdapterError> {
    match target {
        ConnectionTarget::LocalInstance { instance_id } => {
            let inst = db
                .get_instance(instance_id)
                .map_err(|e| AdapterError::Api(e.to_string()))?
                .ok_or_else(|| AdapterError::NotFound(instance_id.clone()))?;

            let provider = engines::get_provider(&inst.engine_type)
                .map_err(|e| AdapterError::UnsupportedEngine(e.to_string()))?;

            if !provider.is_embedded() && !pm.is_instance_running(&inst.id).await {
                return Err(AdapterError::InstanceNotRunning(format!(
                    "Local instance '{}' is not running. Start it first.",
                    inst.name
                )));
            }
            pm.record_activity(&inst.id).await;

            let host = engines::connect_host(&inst.host);
            let base_url = format!("http://{}:{}", host, inst.port);

            match inst.engine_type.as_str() {
                "qdrant" => Ok(Box::new(qdrant::QdrantAdapter::new(base_url, None)?)),
                "chroma" => Ok(Box::new(chroma::ChromaAdapter::new(
                    base_url,
                    "none".to_string(),
                    None,
                    HashMap::new(),
                )?)),
                other => Err(AdapterError::UnsupportedEngine(other.to_string())),
            }
        }
        ConnectionTarget::RemoteConnection { connection_id } => {
            let conn = db
                .get_remote_connection(connection_id)
                .map_err(|e| AdapterError::Api(e.to_string()))?
                .ok_or_else(|| AdapterError::NotFound(connection_id.clone()))?;

            let secret = match &conn.secret_ref {
                Some(ref_key) => secrets::get_secret(ref_key).map_err(AdapterError::Secret)?,
                None => None,
            };
            let extra = parse_extra_json(&conn.extra_json);
            build_remote_adapter(&conn.engine_type, conn.endpoint_url, conn.auth_type, secret, extra)
        }
        ConnectionTarget::Direct {
            engine_type,
            endpoint_url,
            auth_type,
            secret,
            extra_json,
        } => {
            let extra = extra_json
                .as_deref()
                .map(parse_extra_json)
                .unwrap_or_default();
            build_remote_adapter(
                engine_type,
                endpoint_url.clone(),
                auth_type.clone(),
                secret.clone(),
                extra,
            )
        }
    }
}

fn build_remote_adapter(
    engine_type: &str,
    endpoint_url: String,
    auth_type: String,
    secret: Option<String>,
    extra: HashMap<String, String>,
) -> Result<Box<dyn VectorDbAdapter>, AdapterError> {
    match engine_type {
        "qdrant" => Ok(Box::new(qdrant::QdrantAdapter::new(endpoint_url, secret)?)),
        "chroma" => Ok(Box::new(chroma::ChromaAdapter::new(
            endpoint_url,
            auth_type,
            secret,
            extra,
        )?)),
        other => Err(AdapterError::UnsupportedEngine(other.to_string())),
    }
}
