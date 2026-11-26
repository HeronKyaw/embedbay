use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

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

pub struct MeilisearchAdapter {
    base_url: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl MeilisearchAdapter {
    pub fn new(base_url: String, api_key: Option<String>) -> Result<Self, AdapterError> {
        let trimmed = base_url.trim().trim_end_matches('/').to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "Meilisearch endpoint URL cannot be empty".to_string(),
            ));
        }
        let client = http_client_for_url(&trimmed, 30)?;
        Ok(Self {
            base_url: trimmed,
            api_key: api_key.filter(|k| !k.trim().is_empty()),
            client,
        })
    }

    fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        if let Some(key) = &self.api_key {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {}", key)) {
                h.insert(reqwest::header::AUTHORIZATION, val);
            }
        }
        h
    }

    async fn send_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AdapterError> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url).headers(self.headers());
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
                "Meilisearch",
                status,
                &text,
            )));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("Meilisearch", &text)))
    }

    async fn wait_for_task(&self, resp: &Value) -> Result<(), AdapterError> {
        let Some(task_uid) = resp.get("taskUid").and_then(|v| v.as_u64()) else {
            return Ok(());
        };
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let task = self
                .send_json(reqwest::Method::GET, &format!("/tasks/{}", task_uid), None)
                .await?;
            match task.get("status").and_then(|v| v.as_str()) {
                Some("succeeded") => return Ok(()),
                Some("failed") | Some("canceled") => {
                    let msg = task
                        .pointer("/error/message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Meilisearch async task failed");
                    return Err(AdapterError::Api(msg.to_string()));
                }
                _ => {
                    if Instant::now() >= deadline {
                        return Err(AdapterError::Api(format!(
                            "Timed out waiting for Meilisearch task {}",
                            task_uid
                        )));
                    }
                    tokio::time::sleep(Duration::from_millis(80)).await;
                }
            }
        }
    }

    async fn detect_embedder(&self, index: &str) -> (String, Option<usize>) {
        let Ok(val) = self
            .send_json(
                reqwest::Method::GET,
                &format!("/indexes/{}/settings/embedders", index),
                None,
            )
            .await
        else {
            return ("default".to_string(), None);
        };
        let Some(obj) = val.as_object() else {
            return ("default".to_string(), None);
        };
        if let Some(def) = obj.get("default") {
            let dims = def
                .get("dimensions")
                .and_then(|v| v.as_u64())
                .map(|d| d as usize);
            return ("default".to_string(), dims);
        }
        if let Some((name, cfg)) = obj.iter().next() {
            let dims = cfg
                .get("dimensions")
                .and_then(|v| v.as_u64())
                .map(|d| d as usize);
            return (name.clone(), dims);
        }
        ("default".to_string(), None)
    }
}

fn format_meili_scalar(val: &Value) -> String {
    match val {
        Value::String(s) => format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => format!("\"{}\"", val.to_string().replace('"', "\\\"")),
    }
}

fn condition_to_meili(cond: &FilterCondition) -> Option<String> {
    let field = cond.field.trim();
    if field.is_empty() {
        return None;
    }
    match cond.op.as_str() {
        "eq" => Some(format!("{} = {}", field, format_meili_scalar(&cond.value))),
        "neq" => Some(format!("{} != {}", field, format_meili_scalar(&cond.value))),
        "gt" => Some(format!("{} > {}", field, format_meili_scalar(&cond.value))),
        "gte" => Some(format!("{} >= {}", field, format_meili_scalar(&cond.value))),
        "lt" => Some(format!("{} < {}", field, format_meili_scalar(&cond.value))),
        "lte" => Some(format!("{} <= {}", field, format_meili_scalar(&cond.value))),
        "contains" => Some(format!(
            "{} CONTAINS {}",
            field,
            format_meili_scalar(&cond.value)
        )),
        "in" => {
            let items: Vec<String> = if let Some(arr) = cond.value.as_array() {
                arr.iter().map(format_meili_scalar).collect()
            } else if let Some(s) = cond.value.as_str() {
                s.split(',')
                    .map(str::trim)
                    .filter(|x| !x.is_empty())
                    .map(|x| format_meili_scalar(&Value::String(x.to_string())))
                    .collect()
            } else {
                vec![format_meili_scalar(&cond.value)]
            };
            if items.is_empty() {
                None
            } else {
                Some(format!("{} IN [{}]", field, items.join(", ")))
            }
        }
        _ => None,
    }
}

fn build_meili_filter(spec: &FilterSpec) -> Option<Value> {
    match spec {
        FilterSpec::RawJson { json } => {
            if json.is_string() || json.is_array() {
                Some(json.clone())
            } else if let Some(obj) = json.as_object() {
                let parts: Vec<String> = obj
                    .iter()
                    .map(|(k, v)| format!("{} = {}", k, format_meili_scalar(v)))
                    .collect();
                if parts.is_empty() {
                    None
                } else {
                    Some(Value::String(parts.join(" AND ")))
                }
            } else {
                None
            }
        }
        FilterSpec::Visual { logic, conditions } => {
            let clauses: Vec<String> = conditions.iter().filter_map(condition_to_meili).collect();
            if clauses.is_empty() {
                return None;
            }
            let sep = match logic {
                FilterLogic::And => " AND ",
                FilterLogic::Or => " OR ",
            };
            Some(Value::String(clauses.join(sep)))
        }
    }
}

fn parse_meili_doc(mut obj: serde_json::Map<String, Value>, include_vectors: bool, embedder: &str) -> VectorRecord {
    let id = obj
        .remove("id")
        .map(|v| v.as_str().map(ToString::to_string).unwrap_or_else(|| v.to_string()))
        .unwrap_or_default();
    let score = obj
        .remove("_rankingScore")
        .and_then(|v| v.as_f64())
        .map(|s| s as f32);
    let document = obj
        .remove("_document")
        .or_else(|| obj.get("document").cloned())
        .and_then(|v| v.as_str().map(ToString::to_string));

    let vector = obj.remove("_vectors").and_then(|vecs| {
        if !include_vectors {
            return None;
        }
        let target = vecs.get(embedder).or_else(|| {
            vecs.as_object().and_then(|m| m.values().next())
        })?;
        let arr = target
            .as_array()
            .or_else(|| target.get("embeddings").and_then(|e| e.as_array()))?;
        Some(
            arr.iter()
                .filter_map(|x| x.as_f64().map(|f| f as f32))
                .collect(),
        )
    });

    VectorRecord {
        id,
        payload: Value::Object(obj),
        document,
        vector: if include_vectors { vector } else { None },
        score,
    }
}

#[async_trait]
impl VectorDbAdapter for MeilisearchAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let health = self.send_json(reqwest::Method::GET, "/health", None).await?;
        let latency_ms = start.elapsed().as_millis() as u64;
        let ver = self
            .send_json(reqwest::Method::GET, "/version", None)
            .await
            .ok()
            .and_then(|v| v.get("pkgVersion").and_then(|s| s.as_str()).map(ToString::to_string));
        let status = health
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("available");
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms,
            engine_version: ver.clone(),
            message: format!(
                "Connected to Meilisearch{} ({})",
                ver.map(|v| format!(" v{}", v)).unwrap_or_default(),
                status
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let resp = self
            .send_json(reqwest::Method::GET, "/indexes?limit=100", None)
            .await?;
        let results = resp
            .get("results")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut out = Vec::with_capacity(results.len());
        for idx in results {
            let Some(uid) = idx.get("uid").and_then(|v| v.as_str()).map(ToString::to_string) else {
                continue;
            };
            let stats = self
                .send_json(reqwest::Method::GET, &format!("/indexes/{}/stats", uid), None)
                .await
                .ok();
            let count = stats
                .as_ref()
                .and_then(|s| s.get("numberOfDocuments").and_then(|v| v.as_u64()));
            let (_, dims) = self.detect_embedder(&uid).await;
            out.push(CollectionSummary {
                name: uid,
                vector_count: count,
                dimensions: dims,
                distance_metric: Some("cosine".to_string()),
            });
        }
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let stats = self
            .send_json(
                reqwest::Method::GET,
                &format!("/indexes/{}/stats", collection),
                None,
            )
            .await?;
        let count = stats
            .get("numberOfDocuments")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let (embedder, dims) = self.detect_embedder(collection).await;

        let mut fields = BTreeMap::new();
        if let Some(dist) = stats.get("fieldDistribution").and_then(|v| v.as_object()) {
            for k in dist.keys() {
                if k != "id" && k != "_vectors" && k != "_document" {
                    fields.insert(k.clone(), "json".to_string());
                }
            }
        }

        Ok(CollectionSchema {
            name: collection.to_string(),
            vector_count: count,
            dimensions: dims,
            distance_metric: Some("cosine".to_string()),
            index_type: Some("HNSW (userProvided)".to_string()),
            segment_count: None,
            disk_bytes: None,
            vector_field_name: Some(format!("_vectors.{}", embedder)),
            payload_fields: fields
                .into_iter()
                .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
                .collect(),
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let uid = req.name.trim();
        let create_resp = self
            .send_json(
                reqwest::Method::POST,
                "/indexes",
                Some(json!({ "uid": uid, "primaryKey": "id" })),
            )
            .await?;
        self.wait_for_task(&create_resp).await?;

        let settings_resp = self
            .send_json(
                reqwest::Method::PATCH,
                &format!("/indexes/{}/settings", uid),
                Some(json!({
                    "embedders": {
                        "default": {
                            "source": "userProvided",
                            "dimensions": req.dimensions.max(1)
                        }
                    },
                    "filterableAttributes": ["*"]
                })),
            )
            .await?;
        self.wait_for_task(&settings_resp).await?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let resp = self
            .send_json(
                reqwest::Method::DELETE,
                &format!("/indexes/{}", collection),
                None,
            )
            .await?;
        self.wait_for_task(&resp).await
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let (embedder, _) = self.detect_embedder(collection).await;
        let mut body = json!({
            "limit": req.limit.clamp(1, 1000),
            "offset": req.offset,
            "retrieveVectors": req.include_vectors,
        });
        if let Some(filter) = req.filter.as_ref().and_then(build_meili_filter) {
            body["filter"] = filter;
        }

        let resp = self
            .send_json(
                reqwest::Method::POST,
                &format!("/indexes/{}/documents/fetch", collection),
                Some(body),
            )
            .await?;
        let total = resp.get("total").and_then(|v| v.as_u64());
        let results = resp
            .get("results")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let records = results
            .into_iter()
            .filter_map(|v| v.as_object().cloned())
            .map(|obj| parse_meili_doc(obj, req.include_vectors, &embedder))
            .collect();

        Ok(BrowseRecordsResponse {
            records,
            next_cursor: None,
            total_count: total,
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
        let (embedder, _) = self.detect_embedder(collection).await;
        let mut docs = Vec::with_capacity(records.len());
        let mut payload_keys = BTreeSet::new();

        for rec in &records {
            let mut obj = rec.payload.as_object().cloned().unwrap_or_default();
            for k in obj.keys() {
                payload_keys.insert(k.clone());
            }
            obj.insert("id".to_string(), json!(rec.id));
            if let Some(doc) = &rec.document {
                obj.insert("_document".to_string(), json!(doc));
            }
            if let Some(vec) = &rec.vector {
                obj.insert("_vectors".to_string(), json!({ &embedder: vec }));
            }
            docs.push(Value::Object(obj));
        }

        let count = docs.len();
        let resp = self
            .send_json(
                reqwest::Method::POST,
                &format!("/indexes/{}/documents?primaryKey=id", collection),
                Some(Value::Array(docs)),
            )
            .await?;
        self.wait_for_task(&resp).await?;

        // Best-effort filterable attribute registration if wildcard wasn't supported
        if !payload_keys.is_empty() {
            let existing_attrs = self
                .send_json(
                    reqwest::Method::GET,
                    &format!("/indexes/{}/settings/filterable-attributes", collection),
                    None,
                )
                .await
                .ok()
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default();
            let has_wildcard = existing_attrs.iter().any(|v| v.as_str() == Some("*"));
            if !has_wildcard {
                for v in existing_attrs {
                    if let Some(s) = v.as_str() {
                        payload_keys.insert(s.to_string());
                    }
                }
                let attrs: Vec<String> = payload_keys.into_iter().collect();
                if let Ok(upd) = self
                    .send_json(
                        reqwest::Method::PUT,
                        &format!("/indexes/{}/settings/filterable-attributes", collection),
                        Some(json!(attrs)),
                    )
                    .await
                {
                    let _ = self.wait_for_task(&upd).await;
                }
            }
        }

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
        let resp = self
            .send_json(
                reqwest::Method::POST,
                &format!("/indexes/{}/documents/delete-batch", collection),
                Some(json!(ids)),
            )
            .await?;
        self.wait_for_task(&resp).await?;
        Ok(count)
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let (embedder, _) = self.detect_embedder(collection).await;

        let mut body = json!({
            "vector": req.vector,
            "hybrid": {
                "embedder": embedder,
                "semanticRatio": 1.0
            },
            "limit": req.top_k.clamp(1, 500),
            "showRankingScore": true,
            "retrieveVectors": req.include_vectors,
        });
        if let Some(filter) = req.filter.as_ref().and_then(build_meili_filter) {
            body["filter"] = filter;
        }

        let resp = self
            .send_json(
                reqwest::Method::POST,
                &format!("/indexes/{}/search", collection),
                Some(body),
            )
            .await?;
        let latency_ms = start.elapsed().as_millis() as u64;

        let hits = resp
            .get("hits")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut records = Vec::new();
        for hit in hits {
            let Some(obj) = hit.as_object().cloned() else {
                continue;
            };
            let parsed = parse_meili_doc(obj, req.include_vectors, &embedder);
            if let (Some(thresh), Some(sc)) = (req.score_threshold, parsed.score) {
                if sc < thresh {
                    continue;
                }
            }
            records.push(parsed);
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

    #[tokio::test]
    async fn meilisearch_adapter_roundtrip_mock() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();

        let server = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = [0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let first = req.lines().next().unwrap_or("");

                let body = if first.starts_with("GET /health ") {
                    json!({ "status": "available" })
                } else if first.starts_with("GET /version ") {
                    json!({ "pkgVersion": "1.35.0" })
                } else if first.starts_with("GET /indexes?limit=100 ") {
                    json!({ "results": [{ "uid": "docs", "primaryKey": "id" }] })
                } else if first.starts_with("GET /indexes/docs/stats ") {
                    json!({ "numberOfDocuments": 1, "fieldDistribution": { "topic": 1 } })
                } else if first.starts_with("GET /indexes/docs/settings/embedders ") {
                    json!({ "default": { "source": "userProvided", "dimensions": 3 } })
                } else if first.starts_with("GET /indexes/docs/settings/filterable-attributes ") {
                    json!(["*"])
                } else if first.starts_with("GET /tasks/1 ") {
                    json!({ "uid": 1, "status": "succeeded" })
                } else if first.starts_with("POST /indexes/docs/documents/fetch ") {
                    json!({ "results": [{ "id": "m1", "_document": "Meili doc", "topic": "rust", "_vectors": { "default": [1.0, 0.0, 0.0] } }], "total": 1 })
                } else if first.starts_with("POST /indexes/docs/search ") {
                    json!({ "hits": [{ "id": "m1", "_document": "Meili doc", "topic": "rust", "_rankingScore": 0.94 }] })
                } else {
                    json!({ "taskUid": 1 })
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

        let adapter =
            MeilisearchAdapter::new(format!("http://127.0.0.1:{}", port), None).expect("meili");
        let conn = adapter.test_connection().await.expect("test");
        assert!(conn.ok);
        assert_eq!(conn.engine_version.as_deref(), Some("1.35.0"));

        adapter
            .create_collection(CreateCollectionRequest {
                name: "docs".to_string(),
                dimensions: 3,
                distance_metric: "cosine".to_string(),
                index_type: None,
            })
            .await
            .expect("create");

        let cols = adapter.list_collections().await.expect("list");
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
                    filter: None,
                },
            )
            .await
            .expect("browse");
        assert_eq!(browsed.records[0].id, "m1");
        assert_eq!(browsed.records[0].vector, Some(vec![1.0, 0.0, 0.0]));

        let searched = adapter
            .search_vectors(
                "docs",
                SearchRequest {
                    vector: vec![1.0, 0.0, 0.0],
                    top_k: 5,
                    score_threshold: Some(0.5),
                    include_vectors: false,
                    filter: None,
                },
            )
            .await
            .expect("search");
        assert_eq!(searched.records.len(), 1);
        assert_eq!(searched.records[0].score, Some(0.94));
        server.abort();
    }
}
