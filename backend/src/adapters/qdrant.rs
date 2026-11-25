use std::collections::BTreeMap;
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

pub struct QdrantAdapter {
    base_url: String,
    client: reqwest::Client,
    api_key: Option<String>,
}

impl QdrantAdapter {
    pub fn new(base_url: String, api_key: Option<String>) -> Result<Self, AdapterError> {
        let trimmed = base_url.trim().trim_end_matches('/').to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "Qdrant endpoint URL cannot be empty".to_string(),
            ));
        }
        let client = http_client_for_url(&trimmed, 30)?;
        Ok(Self {
            base_url: trimmed,
            client,
            api_key: api_key.filter(|k| !k.trim().is_empty()),
        })
    }

    fn auth_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        if let Some(key) = &self.api_key {
            if let Ok(val) = HeaderValue::from_str(key) {
                headers.insert("api-key", val);
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
                "Qdrant",
                status,
                &text,
            )));
        }
        serde_json::from_str::<Value>(&text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("Qdrant", &text)))
    }
}

fn map_distance(metric: &str) -> &'static str {
    match metric.to_ascii_lowercase().as_str() {
        "dot" | "ip" | "inner_product" => "Dot",
        "euclidean" | "l2" | "euclid" => "Euclid",
        "manhattan" => "Manhattan",
        _ => "Cosine",
    }
}

fn build_qdrant_filter(spec: &FilterSpec) -> Option<Value> {
    match spec {
        FilterSpec::RawJson { json } => {
            if json.is_null() {
                None
            } else {
                Some(json.clone())
            }
        }
        FilterSpec::Visual { logic, conditions } => {
            if conditions.is_empty() {
                return None;
            }
            let clauses: Vec<Value> = conditions
                .iter()
                .filter_map(condition_to_qdrant_clause)
                .collect();
            if clauses.is_empty() {
                return None;
            }
            match logic {
                FilterLogic::And => Some(json!({ "must": clauses })),
                FilterLogic::Or => Some(json!({ "should": clauses })),
            }
        }
    }
}

fn condition_to_qdrant_clause(cond: &FilterCondition) -> Option<Value> {
    let key = cond.field.trim();
    if key.is_empty() {
        return None;
    }
    match cond.op.as_str() {
        "eq" => Some(json!({ "key": key, "match": { "value": cond.value } })),
        "neq" => Some(json!({ "must_not": [{ "key": key, "match": { "value": cond.value } }] })),
        "in" => {
            let arr = if cond.value.is_array() {
                cond.value.clone()
            } else if let Some(s) = cond.value.as_str() {
                let parts: Vec<&str> = s.split(',').map(str::trim).filter(|p| !p.is_empty()).collect();
                json!(parts)
            } else {
                json!([cond.value])
            };
            Some(json!({ "key": key, "match": { "any": arr } }))
        }
        "gt" => Some(json!({ "key": key, "range": { "gt": cond.value } })),
        "gte" => Some(json!({ "key": key, "range": { "gte": cond.value } })),
        "lt" => Some(json!({ "key": key, "range": { "lt": cond.value } })),
        "lte" => Some(json!({ "key": key, "range": { "lte": cond.value } })),
        "contains" => {
            let txt = cond
                .value
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| cond.value.to_string());
            Some(json!({ "key": key, "match": { "text": txt } }))
        }
        _ => None,
    }
}

fn parse_qdrant_id(raw: &str) -> Value {
    if let Ok(n) = raw.trim().parse::<u64>() {
        json!(n)
    } else {
        json!(raw.trim())
    }
}

fn extract_id_string(val: Option<&Value>) -> String {
    match val {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn extract_vector(val: Option<&Value>) -> Option<Vec<f32>> {
    let v = val?;
    if let Some(arr) = v.as_array() {
        let floats: Vec<f32> = arr
            .iter()
            .filter_map(|x| x.as_f64().map(|f| f as f32))
            .collect();
        return Some(floats);
    }
    if let Some(obj) = v.as_object() {
        for (_, inner) in obj {
            if let Some(arr) = inner.as_array() {
                let floats: Vec<f32> = arr
                    .iter()
                    .filter_map(|x| x.as_f64().map(|f| f as f32))
                    .collect();
                return Some(floats);
            }
        }
    }
    None
}

fn extract_vector_params(vectors_cfg: &Value) -> (Option<usize>, Option<String>, Option<String>) {
    if let Some(size) = vectors_cfg.get("size").and_then(|v| v.as_u64()) {
        let dist = vectors_cfg
            .get("distance")
            .and_then(|v| v.as_str())
            .map(ToString::to_string);
        return (Some(size as usize), dist, None);
    }
    if let Some(obj) = vectors_cfg.as_object() {
        if let Some((name, first)) = obj.iter().next() {
            let size = first.get("size").and_then(|v| v.as_u64()).map(|n| n as usize);
            let dist = first
                .get("distance")
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            return (size, dist, Some(name.clone()));
        }
    }
    (None, None, None)
}

#[async_trait]
impl VectorDbAdapter for QdrantAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let body = self.send_json(reqwest::Method::GET, "/", None).await?;
        self.send_json(reqwest::Method::GET, "/collections", None)
            .await?;
        let latency_ms = start.elapsed().as_millis() as u64;
        let version = body
            .get("version")
            .and_then(|v| v.as_str())
            .map(ToString::to_string);
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms,
            engine_version: version.clone(),
            message: format!(
                "Connected to Qdrant{}",
                version.map(|v| format!(" v{}", v)).unwrap_or_default()
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let resp = self
            .send_json(reqwest::Method::GET, "/collections", None)
            .await?;
        let arr = resp
            .pointer("/result/collections")
            .and_then(|v| v.as_array())
            .ok_or_else(|| {
                AdapterError::Api(
                    "Unexpected response from Qdrant. Check endpoint URL or credentials."
                        .to_string(),
                )
            })?;
        let names: Vec<String> = arr
            .iter()
            .filter_map(|c| c.get("name").and_then(|n| n.as_str()).map(ToString::to_string))
            .collect();

        let mut summaries = Vec::with_capacity(names.len());
        for name in names {
            if let Ok(info) = self.get_collection_info(&name).await {
                summaries.push(CollectionSummary {
                    name,
                    vector_count: Some(info.vector_count),
                    dimensions: info.dimensions,
                    distance_metric: info.distance_metric,
                });
            } else {
                summaries.push(CollectionSummary {
                    name,
                    vector_count: None,
                    dimensions: None,
                    distance_metric: None,
                });
            }
        }
        Ok(summaries)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let path = format!("/collections/{}", collection);
        let resp = self.send_json(reqwest::Method::GET, &path, None).await?;
        let res = resp.get("result").unwrap_or(&Value::Null);

        let vector_count = res
            .get("points_count")
            .and_then(|v| v.as_u64())
            .or_else(|| res.get("vectors_count").and_then(|v| v.as_u64()))
            .unwrap_or(0);

        let vectors_cfg = res
            .pointer("/config/params/vectors")
            .unwrap_or(&Value::Null);
        let (dimensions, distance_metric, vector_field_name) = extract_vector_params(vectors_cfg);

        let segment_count = res.get("segments_count").and_then(|v| v.as_u64()).map(|n| n as usize);

        let mut fields = BTreeMap::new();
        if let Some(obj) = res.get("payload_schema").and_then(|v| v.as_object()) {
            for (k, v) in obj {
                let dt = v
                    .get("data_type")
                    .and_then(|d| d.as_str())
                    .unwrap_or("json")
                    .to_string();
                fields.insert(k.clone(), dt);
            }
        }

        let payload_fields = fields
            .into_iter()
            .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
            .collect();

        Ok(CollectionSchema {
            name: collection.to_string(),
            vector_count,
            dimensions,
            distance_metric,
            index_type: Some("HNSW".to_string()),
            segment_count,
            disk_bytes: None,
            vector_field_name,
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
            "vectors": {
                "size": req.dimensions.max(1),
                "distance": map_distance(&req.distance_metric),
            }
        });
        let path = format!("/collections/{}", name);
        self.send_json(reqwest::Method::PUT, &path, Some(body))
            .await?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let path = format!("/collections/{}", collection);
        self.send_json(reqwest::Method::DELETE, &path, None).await?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let mut body = json!({
            "limit": req.limit.clamp(1, 1000),
            "with_payload": true,
            "with_vector": req.include_vectors,
        });

        if let Some(cursor) = &req.cursor {
            if !cursor.trim().is_empty() {
                body["offset"] = parse_qdrant_id(cursor);
            }
        }
        if let Some(filter) = req.filter.as_ref().and_then(build_qdrant_filter) {
            body["filter"] = filter;
        }

        let path = format!("/collections/{}/points/scroll", collection);
        let resp = self
            .send_json(reqwest::Method::POST, &path, Some(body))
            .await?;

        let points = resp
            .pointer("/result/points")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let next_cursor = resp
            .pointer("/result/next_page_offset")
            .filter(|v| !v.is_null())
            .map(|v| extract_id_string(Some(v)));

        let records = points
            .into_iter()
            .map(|pt| {
                let payload = pt.get("payload").cloned().unwrap_or_else(|| json!({}));
                let document = payload
                    .get("document")
                    .or_else(|| payload.get("text"))
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string);
                VectorRecord {
                    id: extract_id_string(pt.get("id")),
                    payload,
                    document,
                    vector: extract_vector(pt.get("vector")),
                    score: None,
                }
            })
            .collect();

        let total_count = self
            .get_collection_info(collection)
            .await
            .ok()
            .map(|c| c.vector_count);

        Ok(BrowseRecordsResponse {
            records,
            next_cursor,
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

        let info = self.get_collection_info(collection).await.ok();
        let named_vector = info.and_then(|i| i.vector_field_name);

        let points: Vec<Value> = records
            .iter()
            .map(|rec| {
                let mut payload = if rec.payload.is_object() {
                    rec.payload.clone()
                } else {
                    json!({})
                };
                if let Some(doc) = &rec.document {
                    if let Some(obj) = payload.as_object_mut() {
                        obj.entry("document".to_string())
                            .or_insert_with(|| json!(doc));
                    }
                }
                let vec_val = match (&rec.vector, &named_vector) {
                    (Some(v), Some(name)) => json!({ name: v }),
                    (Some(v), None) => json!(v),
                    (None, _) => json!([]),
                };
                json!({
                    "id": parse_qdrant_id(&rec.id),
                    "vector": vec_val,
                    "payload": payload,
                })
            })
            .collect();

        let count = points.len();
        let path = format!("/collections/{}/points?wait=true", collection);
        self.send_json(reqwest::Method::PUT, &path, Some(json!({ "points": points })))
            .await?;
        Ok(count)
    }

    async fn delete_records(
        &self,
        collection: &str,
        ids: Vec<String>,
    ) -> Result<usize, AdapterError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let count = ids.len();
        let parsed: Vec<Value> = ids.iter().map(|id| parse_qdrant_id(id)).collect();
        let path = format!("/collections/{}/points/delete?wait=true", collection);
        self.send_json(
            reqwest::Method::POST,
            &path,
            Some(json!({ "points": parsed })),
        )
        .await?;
        Ok(count)
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let mut body = json!({
            "query": req.vector,
            "limit": req.top_k.clamp(1, 500),
            "with_payload": true,
            "with_vector": req.include_vectors,
        });
        if let Some(thresh) = req.score_threshold {
            body["score_threshold"] = json!(thresh);
        }
        if let Some(filter) = req.filter.as_ref().and_then(build_qdrant_filter) {
            body["filter"] = filter;
        }

        let query_path = format!("/collections/{}/points/query", collection);
        let resp = match self
            .send_json(reqwest::Method::POST, &query_path, Some(body.clone()))
            .await
        {
            Ok(v) => v,
            Err(_) => {
                // Fallback for older Qdrant servers using /points/search
                let mut legacy_body = json!({
                    "vector": body["query"],
                    "limit": body["limit"],
                    "with_payload": true,
                    "with_vector": req.include_vectors,
                });
                if let Some(thresh) = req.score_threshold {
                    legacy_body["score_threshold"] = json!(thresh);
                }
                if let Some(f) = body.get("filter") {
                    legacy_body["filter"] = f.clone();
                }
                let legacy_path = format!("/collections/{}/points/search", collection);
                self.send_json(reqwest::Method::POST, &legacy_path, Some(legacy_body))
                    .await?
            }
        };

        let latency_ms = start.elapsed().as_millis() as u64;
        let items = resp
            .pointer("/result/points")
            .and_then(|v| v.as_array())
            .or_else(|| resp.get("result").and_then(|v| v.as_array()))
            .cloned()
            .unwrap_or_default();

        let records = items
            .into_iter()
            .map(|pt| {
                let payload = pt.get("payload").cloned().unwrap_or_else(|| json!({}));
                let document = payload
                    .get("document")
                    .or_else(|| payload.get("text"))
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string);
                VectorRecord {
                    id: extract_id_string(pt.get("id")),
                    payload,
                    document,
                    vector: extract_vector(pt.get("vector")),
                    score: pt.get("score").and_then(|s| s.as_f64()).map(|s| s as f32),
                }
            })
            .collect();

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

                let body = if first_line.starts_with("GET / ") {
                    json!({ "title": "qdrant - vector search engine", "version": "1.20.2" })
                } else if first_line.starts_with("GET /collections ") {
                    json!({ "result": { "collections": [{ "name": "docs" }] } })
                } else if first_line.starts_with("GET /collections/docs ") {
                    json!({
                        "result": {
                            "points_count": 2,
                            "segments_count": 1,
                            "config": { "params": { "vectors": { "size": 3, "distance": "Cosine" } } },
                            "payload_schema": { "topic": { "data_type": "keyword" } }
                        }
                    })
                } else if first_line.starts_with("POST /collections/docs/points/scroll ") {
                    json!({
                        "result": {
                            "points": [
                                { "id": 1, "payload": { "topic": "rust", "document": "EmbedBay" }, "vector": [0.1, 0.2, 0.3] }
                            ],
                            "next_page_offset": 2
                        }
                    })
                } else if first_line.starts_with("POST /collections/docs/points/query ") {
                    json!({
                        "result": {
                            "points": [
                                { "id": 1, "score": 0.98, "payload": { "topic": "rust" } }
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
    async fn qdrant_adapter_roundtrip_against_mock_server() {
        let (url, server) = spawn_mock_qdrant().await;
        let adapter = QdrantAdapter::new(url, None).expect("create qdrant adapter");

        let test_res = adapter.test_connection().await.expect("test conn");
        assert!(test_res.ok);
        assert_eq!(test_res.engine_version.as_deref(), Some("1.20.2"));

        let cols = adapter.list_collections().await.expect("list collections");
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "docs");
        assert_eq!(cols[0].dimensions, Some(3));

        let browsed = adapter
            .browse_records(
                "docs",
                BrowseRecordsRequest {
                    limit: 10,
                    offset: 0,
                    cursor: None,
                    include_vectors: true,
                    filter: Some(FilterSpec::Visual {
                        logic: FilterLogic::And,
                        conditions: vec![FilterCondition {
                            field: "topic".to_string(),
                            op: "eq".to_string(),
                            value: json!("rust"),
                        }],
                    }),
                },
            )
            .await
            .expect("browse");
        assert_eq!(browsed.records.len(), 1);
        assert_eq!(browsed.records[0].id, "1");
        assert_eq!(browsed.next_cursor.as_deref(), Some("2"));

        let searched = adapter
            .search_vectors(
                "docs",
                SearchRequest {
                    vector: vec![0.1, 0.2, 0.3],
                    top_k: 5,
                    score_threshold: Some(0.5),
                    include_vectors: false,
                    filter: None,
                },
            )
            .await
            .expect("search");
        assert_eq!(searched.records.len(), 1);
        assert!(searched.records[0].score.unwrap_or(0.0) > 0.9);

        let upserted = adapter
            .upsert_records(
                "docs",
                vec![VectorRecord {
                    id: "42".to_string(),
                    payload: json!({"topic": "vector"}),
                    document: Some("hello".to_string()),
                    vector: Some(vec![0.4, 0.5, 0.6]),
                    score: None,
                }],
            )
            .await
            .expect("upsert");
        assert_eq!(upserted, 1);

        let deleted = adapter
            .delete_records("docs", vec!["42".to_string()])
            .await
            .expect("delete");
        assert_eq!(deleted, 1);

        server.abort();
    }
}
