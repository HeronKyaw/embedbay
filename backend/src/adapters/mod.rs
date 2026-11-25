pub mod chroma;
pub mod elasticsearch;
pub mod embeddings;
pub mod lancedb;
pub mod milvus;
pub mod pgvector;
pub mod pinecone;
pub mod qdrant;
pub mod redis_stack;
pub mod weaviate;

use std::collections::HashMap;
use std::error::Error as StdError;
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
    #[error("{0}")]
    Http(String),
    #[error("{0}")]
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
        .connect_timeout(Duration::from_secs(timeout_secs.min(8)))
        .timeout(Duration::from_secs(timeout_secs));
    if is_loopback {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))
}

fn collapse_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut count = 0usize;
    let mut iter = input.chars();
    while let Some(ch) = iter.next() {
        if count + 1 >= max_chars && iter.clone().next().is_some() {
            out.push('…');
            return out;
        }
        out.push(ch);
        count += 1;
    }
    out
}

fn extract_short_api_detail(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() || trimmed.starts_with('<') {
        return None;
    }
    let val: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let obj = val.as_object()?;

    let candidate = obj
        .get("message")
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("detail").and_then(|v| v.as_str()))
        .or_else(|| obj.get("reason").and_then(|v| v.as_str()))
        .or_else(|| {
            obj.get("error")
                .and_then(|e| e.get("message"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| obj.get("error").and_then(|v| v.as_str()))
        .or_else(|| {
            obj.get("status")
                .and_then(|s| s.get("error"))
                .and_then(|v| v.as_str())
        })?;

    let clean = collapse_whitespace(candidate);
    if clean.is_empty() {
        None
    } else {
        Some(truncate_chars(&clean, 90))
    }
}

pub fn format_reqwest_error(err: &reqwest::Error) -> String {
    let mut chain = err.to_string();
    let mut source = err.source();
    let mut depth = 0usize;
    while let Some(src) = source {
        if depth >= 8 {
            break;
        }
        chain.push(' ');
        chain.push_str(&src.to_string());
        source = src.source();
        depth += 1;
    }
    let lower = chain.to_ascii_lowercase();

    if err.is_timeout() || lower.contains("timed out") || lower.contains("os error 10060") {
        return "Connection timed out. Check the endpoint URL, VPN, or network.".to_string();
    }
    if lower.contains("dns error")
        || lower.contains("failed to lookup address")
        || lower.contains("no such host")
        || lower.contains("os error 11001")
        || lower.contains("name or service not known")
    {
        return "Host could not be resolved. Check the URL or VPN connection.".to_string();
    }
    if lower.contains("connection refused")
        || lower.contains("actively refused")
        || lower.contains("os error 10061")
    {
        return "Connection refused. Make sure the service is running and reachable.".to_string();
    }
    if lower.contains("network is unreachable")
        || lower.contains("no route to host")
        || lower.contains("host is unreachable")
        || lower.contains("os error 10051")
        || lower.contains("os error 10065")
    {
        return "Network unreachable. Check your VPN or network connection.".to_string();
    }
    if lower.contains("connection reset")
        || lower.contains("os error 10054")
        || lower.contains("broken pipe")
        || lower.contains("unexpected eof")
    {
        return "Connection closed unexpectedly by the server.".to_string();
    }
    if lower.contains("certificate")
        || lower.contains("tls")
        || lower.contains("ssl")
        || lower.contains("handshake")
        || lower.contains("unknownissuer")
        || lower.contains("invalid peer")
    {
        return "TLS/SSL handshake failed. Check the server certificate or HTTPS URL.".to_string();
    }
    if lower.contains("proxy") {
        return "Proxy connection failed. Check your network or proxy settings.".to_string();
    }
    if err.is_connect() {
        return "Unable to reach endpoint. Check your VPN, firewall, or URL.".to_string();
    }
    if err.is_builder()
        || lower.contains("relative url")
        || lower.contains("invalid url")
        || lower.contains("empty host")
    {
        return "Invalid endpoint URL. Check the address format.".to_string();
    }
    if err.is_redirect() {
        return "Too many redirects. Check the endpoint URL or auth gateway.".to_string();
    }
    if err.is_decode() || err.is_body() {
        return "Failed to read response from the server.".to_string();
    }

    "Unable to reach the endpoint. Check your VPN or network.".to_string()
}

pub fn format_http_status_error(engine: &str, status: reqwest::StatusCode, body: &str) -> String {
    let detail = extract_short_api_detail(body);
    match status.as_u16() {
        401 => "Authentication failed (401). Check your API key or credentials.".to_string(),
        403 => "Access denied (403). Check your credentials, permissions, or VPN auth.".to_string(),
        404 => match detail {
            Some(d) => format!("Not found (404): {}", d),
            None => "Endpoint or resource not found (404). Check the URL and engine type.".to_string(),
        },
        405 => "Unsupported request (405). Check the endpoint URL and engine type.".to_string(),
        407 => "Proxy authentication required (407).".to_string(),
        408 => "Request timed out (408).".to_string(),
        429 => "Rate limit exceeded (429). Try again shortly.".to_string(),
        500 => match detail {
            Some(d) => format!("Server error (500): {}", d),
            None => "Server error (500).".to_string(),
        },
        502 => "Bad gateway (502). The upstream service may be offline.".to_string(),
        503 => "Service unavailable (503). The server is temporarily unreachable.".to_string(),
        504 => "Gateway timeout (504). The server took too long to respond.".to_string(),
        code => match detail {
            Some(d) => format!("{} returned HTTP {}: {}", engine, code, d),
            None => format!("{} returned HTTP {}.", engine, code),
        },
    }
}

pub fn format_invalid_json_error(engine: &str, body: &str) -> String {
    if body.trim_start().starts_with('<') {
        "Received an HTML page instead of API JSON. Check VPN/SSO login or endpoint URL."
            .to_string()
    } else {
        format!(
            "Unexpected response from {}. Check the endpoint URL and engine type.",
            engine
        )
    }
}

pub fn format_connection_error(engine: &str, raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") || lower.contains("os error 10060")
    {
        return "Connection timed out. Check the host, VPN, or firewall.".to_string();
    }
    if lower.contains("password authentication failed")
        || lower.contains("noauth")
        || lower.contains("wrongpass")
        || lower.contains("authentication failed")
        || lower.contains("pg_hba.conf")
        || lower.contains("invalid username-password")
    {
        return "Authentication failed. Check your credentials.".to_string();
    }
    if lower.contains("dns error")
        || lower.contains("failed to lookup address")
        || lower.contains("no such host")
        || lower.contains("os error 11001")
        || lower.contains("name or service not known")
    {
        return "Host could not be resolved. Check the host address or VPN.".to_string();
    }
    if lower.contains("connection refused")
        || lower.contains("actively refused")
        || lower.contains("os error 10061")
    {
        return "Connection refused. Make sure the service is running and reachable.".to_string();
    }
    if lower.contains("certificate")
        || lower.contains("tls")
        || lower.contains("ssl")
        || lower.contains("handshake")
        || lower.contains("unknownissuer")
    {
        return "TLS/SSL connection failed. Check SSL settings or certificates.".to_string();
    }
    if lower.contains("network is unreachable")
        || lower.contains("no route to host")
        || lower.contains("host is unreachable")
        || lower.contains("os error 10051")
        || lower.contains("os error 10065")
    {
        return "Network unreachable. Check your VPN or network connection.".to_string();
    }

    let clean = collapse_whitespace(raw);
    if clean.is_empty() {
        format!("Unable to connect to {}.", engine)
    } else {
        truncate_chars(&clean, 110)
    }
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
                "lancedb" => Ok(Box::new(lancedb::LanceDbAdapter::new(
                    std::path::PathBuf::from(&inst.data_dir),
                )?)),
                "pgvector" => Ok(Box::new(pgvector::PgVectorAdapter::from_local(
                    host, inst.port,
                ))),
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
        "pgvector" => Ok(Box::new(pgvector::PgVectorAdapter::from_remote(
            &endpoint_url,
            secret.as_deref(),
        )?)),
        "pinecone" => Ok(Box::new(pinecone::PineconeAdapter::new(
            endpoint_url,
            secret,
            extra,
        )?)),
        "weaviate" => Ok(Box::new(weaviate::WeaviateAdapter::new(
            endpoint_url,
            secret,
        )?)),
        "milvus" => Ok(Box::new(milvus::MilvusAdapter::new(
            endpoint_url,
            secret,
            extra,
        )?)),
        "elasticsearch" => Ok(Box::new(elasticsearch::ElasticsearchAdapter::new(
            endpoint_url,
            auth_type,
            secret,
        )?)),
        "redis_stack" | "redis" => Ok(Box::new(redis_stack::RedisStackAdapter::new(
            endpoint_url,
            secret,
        )?)),
        other => Err(AdapterError::UnsupportedEngine(other.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn formats_http_status_errors_concisely() {
        assert_eq!(
            format_http_status_error("Qdrant", StatusCode::UNAUTHORIZED, "<html>Unauthorized</html>"),
            "Authentication failed (401). Check your API key or credentials."
        );
        assert_eq!(
            format_http_status_error("Qdrant", StatusCode::FORBIDDEN, "<!DOCTYPE html><html><body>Access Denied</body></html>"),
            "Access denied (403). Check your credentials, permissions, or VPN auth."
        );
        assert_eq!(
            format_http_status_error(
                "Qdrant",
                StatusCode::NOT_FOUND,
                r#"{"status":{"error":"Collection `missing` doesn't exist"}}"#
            ),
            "Not found (404): Collection `missing` doesn't exist"
        );
        assert_eq!(
            format_http_status_error("Chroma", StatusCode::BAD_GATEWAY, "<html>502 Bad Gateway</html>"),
            "Bad gateway (502). The upstream service may be offline."
        );
        assert_eq!(
            format_http_status_error("Pinecone", StatusCode::SERVICE_UNAVAILABLE, ""),
            "Service unavailable (503). The server is temporarily unreachable."
        );
    }

    #[test]
    fn formats_invalid_json_errors_for_html_and_plain_bodies() {
        let html_msg = format_invalid_json_error("Qdrant", "  <!DOCTYPE html><html><title>VPN Login</title></html>");
        assert!(html_msg.contains("HTML page"));
        assert!(!html_msg.contains("<html"));

        let json_msg = format_invalid_json_error("Qdrant", "{not json");
        assert_eq!(
            json_msg,
            "Unexpected response from Qdrant. Check the endpoint URL and engine type."
        );
    }

    #[test]
    fn formats_connection_errors_concisely() {
        assert_eq!(
            format_connection_error("PostgreSQL", "error connecting to server: Connection timed out (os error 10060)"),
            "Connection timed out. Check the host, VPN, or firewall."
        );
        assert_eq!(
            format_connection_error("PostgreSQL", "dns error: failed to lookup address information: No such host is known. (os error 11001)"),
            "Host could not be resolved. Check the host address or VPN."
        );
        assert_eq!(
            format_connection_error("Redis", "Connection refused (os error 10061)"),
            "Connection refused. Make sure the service is running and reachable."
        );
        assert_eq!(
            format_connection_error("PostgreSQL", "db error: FATAL: password authentication failed for user \"postgres\""),
            "Authentication failed. Check your credentials."
        );
        assert_eq!(
            format_connection_error("PostgreSQL", "error performing TLS handshake: invalid peer certificate"),
            "TLS/SSL connection failed. Check SSL settings or certificates."
        );
    }

    async fn spawn_raw_http_response(status_line: &str, content_type: &str, body: &'static str) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let status_line = status_line.to_string();
        let content_type = content_type.to_string();
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = [0u8; 2048];
                let _ = sock.read(&mut buf).await;
                let resp = format!(
                    "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status_line,
                    content_type,
                    body.len(),
                    body
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });
        (format!("http://127.0.0.1:{}", port), handle)
    }

    #[tokio::test]
    async fn qdrant_adapter_formats_auth_html_and_refused_errors_cleanly() {
        // (a) 401 Unauthorized + HTML body
        let (url_401, srv_401) = spawn_raw_http_response(
            "401 Unauthorized",
            "text/html",
            "<!DOCTYPE html><html><body><h1>401 Unauthorized</h1><p>Sign in with SSO</p></body></html>",
        )
        .await;
        let adapter_401 = qdrant::QdrantAdapter::new(url_401, None).expect("adapter");
        let err_401 = adapter_401
            .list_collections()
            .await
            .expect_err("should fail with 401")
            .to_string();
        assert_eq!(
            err_401,
            "Authentication failed (401). Check your API key or credentials."
        );
        assert!(!err_401.contains("<html"));
        srv_401.abort();

        // (b) 200 OK + HTML login page
        let (url_html, srv_html) = spawn_raw_http_response(
            "200 OK",
            "text/html",
            "<!DOCTYPE html><html><body>VPN Login Portal</body></html>",
        )
        .await;
        let adapter_html = qdrant::QdrantAdapter::new(url_html, None).expect("adapter");
        let err_html = adapter_html
            .list_collections()
            .await
            .expect_err("should fail on HTML")
            .to_string();
        assert!(err_html.contains("HTML page"));
        assert!(!err_html.contains("VPN Login Portal"));
        srv_html.abort();

        // (c) Unbound loopback port (connection refused)
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let closed_port = listener.local_addr().expect("addr").port();
        drop(listener);
        let adapter_refused =
            qdrant::QdrantAdapter::new(format!("http://127.0.0.1:{}", closed_port), None)
                .expect("adapter");
        let err_refused = adapter_refused
            .list_collections()
            .await
            .expect_err("should fail with connection refused")
            .to_string();
        assert!(
            err_refused.contains("Connection refused") || err_refused.contains("Unable to reach"),
            "unexpected refused error: {}",
            err_refused
        );
        assert!(!err_refused.contains("error sending request for url"));
    }
}
