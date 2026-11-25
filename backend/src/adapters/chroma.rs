use std::collections::{BTreeMap, HashMap};
use std::time::Instant;

use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{json, Value};

use crate::adapters::{
    format_http_status_error, format_invalid_json_error, format_reqwest_error,
    http_client_for_url, AdapterError, BrowseRecordsRequest, BrowseRecordsResponse,
    CollectionSchema, CollectionSummary, ConnectionTestResult, CreateCollectionRequest,
    FilterCondition, FilterLogic, FilterSpec, PayloadFieldSchema, SearchRequest, SearchResponse,
    VectorDbAdapter, VectorRecord,
};

pub struct ChromaAdapter {
    base_url: String,
    tenant: String,
    database: String,
    auth_type: String,
    secret: Option<String>,
    client: reqwest::Client,
}

impl ChromaAdapter {
    pub fn new(
        base_url: String,
        auth_type: String,
        secret: Option<String>,
        extra: HashMap<String, String>,
    ) -> Result<Self, AdapterError> {
        let trimmed = base_url.trim().trim_end_matches('/').to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "Chroma endpoint URL cannot be empty".to_string(),
            ));
        }
        let tenant = extra
            .get("tenant")
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "default_tenant".to_string());
        let database = extra
            .get("database")
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "default_database".to_string());

        let client = http_client_for_url(&trimmed, 30)?;
        Ok(Self {
            base_url: trimmed,
            tenant,
            database,
            auth_type,
            secret: secret.filter(|s| !s.trim().is_empty()),
            client,
        })
    }

    fn collections_base(&self) -> String {
        format!(
            "/api/v2/tenants/{}/databases/{}/collections",
            self.tenant, self.database
        )
    }

    fn auth_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(secret) = &self.secret {
            match self.auth_type.as_str() {
                "api_key" => {
                    if let Ok(val) = HeaderValue::from_str(secret) {
                        headers.insert("x-chroma-token", val.clone());
                    }
                    if let Ok(bearer) = HeaderValue::from_str(&format!("Bearer {}", secret)) {
                        headers.insert(reqwest::header::AUTHORIZATION, bearer);
                    }
                }
                "basic" => {
                    if let Ok(val) = HeaderValue::from_str(&format!("Basic {}", secret)) {
                        headers.insert(reqwest::header::AUTHORIZATION, val);
                    }
                }
                _ => {}
            }
        }
        headers
    }

    async fn send_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AdapterError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url).headers(self.auth_headers());
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))?;
        if !status.is_success() {
            return Err(AdapterError::Api(format_http_status_error(
                "Chroma",
                status,
                &text,
            )));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str::<Value>(&text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("Chroma", &text)))
    }

    async fn resolve_collection_obj(&self, collection: &str) -> Result<Value, AdapterError> {
        let direct = format!("{}/{}", self.collections_base(), collection);
        if let Ok(v) = self.send_json(reqwest::Method::GET, &direct, None).await {
            return Ok(v);
        }
        // Fallback: list and match by name or id
        let list = self
            .send_json(reqwest::Method::GET, &self.collections_base(), None)
            .await?;
        let found = list.as_array().and_then(|arr| {
            arr.iter()
                .find(|c| {
                    c.get("name").and_then(|v| v.as_str()) == Some(collection)
                        || c.get("id").and_then(|v| v.as_str()) == Some(collection)
                })
                .cloned()
        });
        found.ok_or_else(|| AdapterError::NotFound(format!("Collection '{}'", collection)))
    }

    async fn resolve_collection_id(&self, collection: &str) -> Result<String, AdapterError> {
        let obj = self.resolve_collection_obj(collection).await?;
        Ok(obj
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or(collection)
            .to_string())
    }
}

fn map_chroma_space(metric: &str) -> &'static str {
    match metric.to_ascii_lowercase().as_str() {
        "dot" | "ip" | "inner_product" => "ip",
        "euclidean" | "l2" => "l2",
        _ => "cosine",
    }
}

fn build_chroma_where(spec: &FilterSpec) -> Option<Value> {
    match spec {
        FilterSpec::RawJson { json } => {
            if json.is_null() {
                None
            } else {
                Some(json.clone())
            }
        }
        FilterSpec::Visual { logic, conditions } => {
            let clauses: Vec<Value> = conditions
                .iter()
                .filter_map(condition_to_chroma_clause)
                .collect();
            if clauses.is_empty() {
                return None;
            }
            if clauses.len() == 1 {
                return clauses.into_iter().next();
            }
            let op = match logic {
                FilterLogic::And => "$and",
                FilterLogic::Or => "$or",
            };
            Some(json!({ op: clauses }))
        }
    }
}

fn condition_to_chroma_clause(cond: &FilterCondition) -> Option<Value> {
    let field = cond.field.trim();
    if field.is_empty() {
        return None;
    }
    match cond.op.as_str() {
        "eq" => Some(json!({ field: { "$eq": cond.value } })),
        "neq" => Some(json!({ field: { "$ne": cond.value } })),
        "in" => {
            let arr = if cond.value.is_array() {
                cond.value.clone()
            } else if let Some(s) = cond.value.as_str() {
                let parts: Vec<&str> = s.split(',').map(str::trim).filter(|p| !p.is_empty()).collect();
                json!(parts)
            } else {
                json!([cond.value])
            };
            Some(json!({ field: { "$in": arr } }))
        }
        "gt" => Some(json!({ field: { "$gt": cond.value } })),
        "gte" => Some(json!({ field: { "$gte": cond.value } })),
        "lt" => Some(json!({ field: { "$lt": cond.value } })),
        "lte" => Some(json!({ field: { "$lte": cond.value } })),
        "contains" => Some(json!({ field: { "$eq": cond.value } })),
        _ => None,
    }
}

fn distance_to_score(distance: f32) -> f32 {
    if distance < 0.0 {
        -distance
    } else {
        1.0 / (1.0 + distance)
    }
}

#[async_trait]
impl VectorDbAdapter for ChromaAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let heartbeat = match self
            .send_json(reqwest::Method::GET, "/api/v2/heartbeat", None)
            .await
        {
            Ok(v) => v,
            Err(_) => {
                self.send_json(reqwest::Method::GET, "/api/v1/heartbeat", None)
                    .await?
            }
        };
        let latency_ms = start.elapsed().as_millis() as u64;
        let version = self
            .send_json(reqwest::Method::GET, "/api/v2/version", None)
            .await
            .ok()
            .and_then(|v| v.as_str().map(ToString::to_string));

        if self.auth_type != "none" {
            self.send_json(reqwest::Method::GET, &self.collections_base(), None)
                .await?;
        }

        let hb_ok = !heartbeat.is_null();
        Ok(ConnectionTestResult {
            ok: hb_ok,
            latency_ms,
            engine_version: version.clone(),
            message: format!(
                "Connected to Chroma{}",
                version.map(|v| format!(" v{}", v)).unwrap_or_default()
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let resp = self
            .send_json(reqwest::Method::GET, &self.collections_base(), None)
            .await?;
        let arr = resp.as_array().cloned().ok_or_else(|| {
            AdapterError::Api(
                "Unexpected response from Chroma. Check endpoint URL or credentials.".to_string(),
            )
        })?;
        let mut out = Vec::with_capacity(arr.len());

        for col in arr {
            let name = col
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let id = col
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or(&name)
                .to_string();
            let count_path = format!("{}/{}/count", self.collections_base(), id);
            let count = self
                .send_json(reqwest::Method::GET, &count_path, None)
                .await
                .ok()
                .and_then(|v| v.as_u64());
            let metric = col
                .pointer("/metadata/hnsw:space")
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            let dims = col
                .get("dimension")
                .and_then(|v| v.as_u64())
                .map(|d| d as usize);

            out.push(CollectionSummary {
                name,
                vector_count: count,
                dimensions: dims,
                distance_metric: metric,
            });
        }
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let obj = self.resolve_collection_obj(collection).await?;
        let id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or(collection);
        let name = obj
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(collection)
            .to_string();

        let count_path = format!("{}/{}/count", self.collections_base(), id);
        let vector_count = self
            .send_json(reqwest::Method::GET, &count_path, None)
            .await
            .ok()
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let mut dimensions = obj
            .get("dimension")
            .and_then(|v| v.as_u64())
            .map(|d| d as usize);
        let distance_metric = obj
            .pointer("/metadata/hnsw:space")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .or_else(|| Some("cosine".to_string()));

        // Sample first record to infer dimensions and metadata schema if omitted
        let sample = self
            .browse_records(
                collection,
                BrowseRecordsRequest {
                    limit: 5,
                    offset: 0,
                    cursor: None,
                    include_vectors: dimensions.is_none(),
                    filter: None,
                },
            )
            .await
            .ok();

        let mut field_types = BTreeMap::new();
        if let Some(s) = sample {
            for rec in s.records {
                if dimensions.is_none() {
                    if let Some(v) = &rec.vector {
                        dimensions = Some(v.len());
                    }
                }
                if let Some(obj) = rec.payload.as_object() {
                    for (k, val) in obj {
                        let ty = if val.is_number() {
                            "number"
                        } else if val.is_boolean() {
                            "boolean"
                        } else if val.is_string() {
                            "string"
                        } else {
                            "json"
                        };
                        field_types.entry(k.clone()).or_insert_with(|| ty.to_string());
                    }
                }
            }
        }

        let payload_fields = field_types
            .into_iter()
            .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
            .collect();

        Ok(CollectionSchema {
            name,
            vector_count,
            dimensions,
            distance_metric,
            index_type: Some("HNSW".to_string()),
            segment_count: None,
            disk_bytes: None,
            vector_field_name: Some("embedding".to_string()),
            payload_fields,
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "Collection name cannot be empty".to_string(),
            ));
        }
        let body = json!({
            "name": name,
            "metadata": {
                "hnsw:space": map_chroma_space(&req.distance_metric),
            },
            "get_or_create": false
        });
        self.send_json(reqwest::Method::POST, &self.collections_base(), Some(body))
            .await?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let path = format!("{}/{}", self.collections_base(), collection);
        self.send_json(reqwest::Method::DELETE, &path, None).await?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let id = self.resolve_collection_id(collection).await?;
        let mut include = vec!["metadatas", "documents"];
        if req.include_vectors {
            include.push("embeddings");
        }
        let mut body = json!({
            "limit": req.limit.clamp(1, 1000),
            "offset": req.offset,
            "include": include,
        });
        if let Some(where_clause) = req.filter.as_ref().and_then(build_chroma_where) {
            body["where"] = where_clause;
        }

        let path = format!("{}/{}/get", self.collections_base(), id);
        let resp = self
            .send_json(reqwest::Method::POST, &path, Some(body))
            .await?;

        let ids = resp
            .get("ids")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let metadatas = resp
            .get("metadatas")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let documents = resp
            .get("documents")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let embeddings = resp
            .get("embeddings")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut records = Vec::with_capacity(ids.len());
        for i in 0..ids.len() {
            let rec_id = ids[i].as_str().unwrap_or("").to_string();
            let payload = metadatas
                .get(i)
                .filter(|v| !v.is_null())
                .cloned()
                .unwrap_or_else(|| json!({}));
            let document = documents
                .get(i)
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            let vector = embeddings.get(i).and_then(|v| {
                v.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_f64().map(|f| f as f32))
                        .collect::<Vec<f32>>()
                })
            });

            records.push(VectorRecord {
                id: rec_id,
                payload,
                document,
                vector,
                score: None,
            });
        }

        let count_path = format!("{}/{}/count", self.collections_base(), id);
        let total_count = self
            .send_json(reqwest::Method::GET, &count_path, None)
            .await
            .ok()
            .and_then(|v| v.as_u64());

        Ok(BrowseRecordsResponse {
            records,
            next_cursor: None,
            total_count,
        })
    }

    async fn upsert_records(
        &self,
        collection: &str,
        records: Vec<VectorRecord>,
    ) -> Result<usize, AdapterError> {
        if records.is_empty() {
            return Ok(0);
        }
        let id = self.resolve_collection_id(collection).await?;
        let mut ids = Vec::with_capacity(records.len());
        let mut metadatas = Vec::with_capacity(records.len());
        let mut documents = Vec::with_capacity(records.len());
        let mut embeddings = Vec::with_capacity(records.len());
        let mut has_vectors = true;

        for rec in &records {
            ids.push(json!(rec.id));
            let meta = if rec.payload.as_object().map(|o| o.is_empty()).unwrap_or(true) {
                Value::Null
            } else {
                rec.payload.clone()
            };
            metadatas.push(meta);
            documents.push(
                rec.document
                    .as_ref()
                    .map(|d| json!(d))
                    .unwrap_or(Value::Null),
            );
            if let Some(vec) = &rec.vector {
                embeddings.push(json!(vec));
            } else {
                has_vectors = false;
            }
        }

        let mut body = json!({
            "ids": ids,
            "metadatas": metadatas,
            "documents": documents,
        });
        if has_vectors {
            body["embeddings"] = json!(embeddings);
        }

        let path = format!("{}/{}/upsert", self.collections_base(), id);
        self.send_json(reqwest::Method::POST, &path, Some(body))
            .await?;
        Ok(records.len())
    }

    async fn delete_records(
        &self,
        collection: &str,
        ids: Vec<String>,
    ) -> Result<usize, AdapterError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let id = self.resolve_collection_id(collection).await?;
        let count = ids.len();
        let path = format!("{}/{}/delete", self.collections_base(), id);
        self.send_json(reqwest::Method::POST, &path, Some(json!({ "ids": ids })))
            .await?;
        Ok(count)
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let id = self.resolve_collection_id(collection).await?;

        let mut include = vec!["metadatas", "documents", "distances"];
        if req.include_vectors {
            include.push("embeddings");
        }
        let mut body = json!({
            "query_embeddings": [req.vector],
            "n_results": req.top_k.clamp(1, 500),
            "include": include,
        });
        if let Some(where_clause) = req.filter.as_ref().and_then(build_chroma_where) {
            body["where"] = where_clause;
        }

        let path = format!("{}/{}/query", self.collections_base(), id);
        let resp = self
            .send_json(reqwest::Method::POST, &path, Some(body))
            .await?;
        let latency_ms = start.elapsed().as_millis() as u64;

        let ids = resp
            .pointer("/ids/0")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let metadatas = resp
            .pointer("/metadatas/0")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let documents = resp
            .pointer("/documents/0")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let distances = resp
            .pointer("/distances/0")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let embeddings = resp
            .pointer("/embeddings/0")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut records = Vec::with_capacity(ids.len());
        for i in 0..ids.len() {
            let dist = distances
                .get(i)
                .and_then(|v| v.as_f64())
                .map(|d| d as f32);
            let score = dist.map(distance_to_score);
            if let (Some(thresh), Some(sc)) = (req.score_threshold, score) {
                if sc < thresh {
                    continue;
                }
            }

            let rec_id = ids[i].as_str().unwrap_or("").to_string();
            let payload = metadatas
                .get(i)
                .filter(|v| !v.is_null())
                .cloned()
                .unwrap_or_else(|| json!({}));
            let document = documents
                .get(i)
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            let vector = embeddings.get(i).and_then(|v| {
                v.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_f64().map(|f| f as f32))
                        .collect::<Vec<f32>>()
                })
            });

            records.push(VectorRecord {
                id: rec_id,
                payload,
                document,
                vector,
                score,
            });
        }

        Ok(SearchResponse {
            records,
            latency_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn spawn_mock_chroma() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mock chroma");
        let port = listener.local_addr().expect("addr").port();

        let handle = tokio::spawn(async move {
            for _ in 0..10 {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = [0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let first_line = req.lines().next().unwrap_or("");
                let base = "/api/v2/tenants/default_tenant/databases/default_database/collections";

                let body = if first_line.starts_with("GET /api/v2/heartbeat ") {
                    json!({ "nanosecond heartbeat": 12345 })
                } else if first_line.starts_with("GET /api/v2/version ") {
                    json!("1.4.4")
                } else if first_line.starts_with(&format!("GET {} ", base)) {
                    json!([{ "id": "col-uuid-1", "name": "notes", "dimension": 3, "metadata": { "hnsw:space": "cosine" } }])
                } else if first_line.starts_with(&format!("GET {}/notes ", base)) {
                    json!({ "id": "col-uuid-1", "name": "notes", "dimension": 3, "metadata": { "hnsw:space": "cosine" } })
                } else if first_line.starts_with(&format!("GET {}/col-uuid-1/count ", base)) {
                    json!(2)
                } else if first_line.starts_with(&format!("POST {}/col-uuid-1/get ", base)) {
                    json!({
                        "ids": ["doc-1"],
                        "metadatas": [{ "env": "dev" }],
                        "documents": ["Hello Chroma"],
                        "embeddings": [[0.2, 0.3, 0.4]]
                    })
                } else if first_line.starts_with(&format!("POST {}/col-uuid-1/query ", base)) {
                    json!({
                        "ids": [["doc-1"]],
                        "metadatas": [[{ "env": "dev" }]],
                        "documents": [["Hello Chroma"]],
                        "distances": [[0.05]]
                    })
                } else {
                    json!({})
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
    async fn chroma_v2_adapter_roundtrip_against_mock_server() {
        let (url, server) = spawn_mock_chroma().await;
        let adapter =
            ChromaAdapter::new(url, "none".to_string(), None, HashMap::new()).expect("adapter");

        let conn = adapter.test_connection().await.expect("heartbeat");
        assert!(conn.ok);
        assert_eq!(conn.engine_version.as_deref(), Some("1.4.4"));

        let cols = adapter.list_collections().await.expect("list collections");
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "notes");
        assert_eq!(cols[0].vector_count, Some(2));

        let browsed = adapter
            .browse_records(
                "notes",
                BrowseRecordsRequest {
                    limit: 10,
                    offset: 0,
                    cursor: None,
                    include_vectors: true,
                    filter: Some(FilterSpec::Visual {
                        logic: FilterLogic::And,
                        conditions: vec![FilterCondition {
                            field: "env".to_string(),
                            op: "eq".to_string(),
                            value: json!("dev"),
                        }],
                    }),
                },
            )
            .await
            .expect("browse");
        assert_eq!(browsed.records.len(), 1);
        assert_eq!(browsed.records[0].document.as_deref(), Some("Hello Chroma"));

        let searched = adapter
            .search_vectors(
                "notes",
                SearchRequest {
                    vector: vec![0.2, 0.3, 0.4],
                    top_k: 3,
                    score_threshold: Some(0.5),
                    include_vectors: false,
                    filter: None,
                },
            )
            .await
            .expect("search");
        assert_eq!(searched.records.len(), 1);
        assert!(searched.records[0].score.unwrap_or(0.0) > 0.9);

        server.abort();
    }
}
