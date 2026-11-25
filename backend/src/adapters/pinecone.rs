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

pub struct PineconeAdapter {
    endpoint_url: String,
    api_key: Option<String>,
    namespace: String,
    control_plane_url: String,
    client: reqwest::Client,
}

impl PineconeAdapter {
    pub fn new(
        endpoint_url: String,
        api_key: Option<String>,
        extra: HashMap<String, String>,
    ) -> Result<Self, AdapterError> {
        let trimmed = endpoint_url.trim().trim_end_matches('/').to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "Pinecone endpoint URL cannot be empty".to_string(),
            ));
        }
        let namespace = extra.get("namespace").cloned().unwrap_or_default();
        let control_plane_url = extra
            .get("control_plane_url")
            .cloned()
            .unwrap_or_else(|| "https://api.pinecone.io".to_string())
            .trim_end_matches('/')
            .to_string();
        let client = http_client_for_url(&trimmed, 30)?;
        Ok(Self {
            endpoint_url: trimmed,
            api_key: api_key.filter(|k| !k.trim().is_empty()),
            namespace,
            control_plane_url,
            client,
        })
    }

    fn is_control_plane(&self) -> bool {
        self.endpoint_url == "https://api.pinecone.io"
            || self.endpoint_url.ends_with("://api.pinecone.io")
    }

    fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        if let Some(key) = &self.api_key {
            if let Ok(v) = HeaderValue::from_str(key) {
                h.insert("Api-Key", v);
            }
        }
        h.insert(
            "X-Pinecone-API-Version",
            HeaderValue::from_static("2024-07"),
        );
        h
    }

    async fn send_json(
        &self,
        method: reqwest::Method,
        full_url: &str,
        body: Option<Value>,
    ) -> Result<Value, AdapterError> {
        let mut req = self.client.request(method, full_url).headers(self.headers());
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
                "Pinecone",
                status,
                &text,
            )));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("Pinecone", &text)))
    }

    fn ns_for(&self, collection: &str) -> String {
        if !self.namespace.is_empty() {
            self.namespace.clone()
        } else if collection == "_default" {
            String::new()
        } else {
            collection.to_string()
        }
    }
}

fn build_pinecone_filter(spec: &FilterSpec) -> Option<Value> {
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
                .filter_map(condition_to_pinecone_clause)
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

fn condition_to_pinecone_clause(cond: &FilterCondition) -> Option<Value> {
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
                let parts: Vec<&str> = s.split(',').map(str::trim).filter(|x| !x.is_empty()).collect();
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
        _ => None,
    }
}

#[async_trait]
impl VectorDbAdapter for PineconeAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        if self.is_control_plane() {
            let url = format!("{}/indexes", self.control_plane_url);
            let resp = self.send_json(reqwest::Method::GET, &url, None).await?;
            let count = resp
                .get("indexes")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            return Ok(ConnectionTestResult {
                ok: true,
                latency_ms: start.elapsed().as_millis() as u64,
                engine_version: Some("Pinecone Control Plane".to_string()),
                message: format!("Connected to Pinecone ({} index(es))", count),
            });
        }

        let url = format!("{}/describe_index_stats", self.endpoint_url);
        let stats = self
            .send_json(reqwest::Method::POST, &url, Some(json!({})))
            .await?;
        let dims = stats.get("dimension").and_then(|v| v.as_u64()).unwrap_or(0);
        let total = stats
            .get("totalVectorCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms: start.elapsed().as_millis() as u64,
            engine_version: Some(format!("{}d index", dims)),
            message: format!("Connected to Pinecone index ({} vectors, {}d)", total, dims),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        if self.is_control_plane() {
            let url = format!("{}/indexes", self.control_plane_url);
            let resp = self.send_json(reqwest::Method::GET, &url, None).await?;
            let indexes = resp
                .get("indexes")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            return Ok(indexes
                .into_iter()
                .map(|idx| CollectionSummary {
                    name: idx
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    vector_count: None,
                    dimensions: idx
                        .get("dimension")
                        .and_then(|v| v.as_u64())
                        .map(|d| d as usize),
                    distance_metric: idx
                        .get("metric")
                        .and_then(|v| v.as_str())
                        .map(ToString::to_string),
                })
                .collect());
        }

        // Index data plane: expose namespaces as collections (or `_default`)
        let url = format!("{}/describe_index_stats", self.endpoint_url);
        let stats = self
            .send_json(reqwest::Method::POST, &url, Some(json!({})))
            .await?;
        let dims = stats
            .get("dimension")
            .and_then(|v| v.as_u64())
            .map(|d| d as usize);
        let mut out = Vec::new();
        if let Some(ns_map) = stats.get("namespaces").and_then(|v| v.as_object()) {
            for (ns, info) in ns_map {
                let name = if ns.is_empty() {
                    "_default".to_string()
                } else {
                    ns.clone()
                };
                let count = info.get("vectorCount").and_then(|v| v.as_u64());
                out.push(CollectionSummary {
                    name,
                    vector_count: count,
                    dimensions: dims,
                    distance_metric: None,
                });
            }
        }
        if out.is_empty() {
            out.push(CollectionSummary {
                name: "_default".to_string(),
                vector_count: stats.get("totalVectorCount").and_then(|v| v.as_u64()),
                dimensions: dims,
                distance_metric: None,
            });
        }
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let url = format!("{}/describe_index_stats", self.endpoint_url);
        let stats = self
            .send_json(reqwest::Method::POST, &url, Some(json!({})))
            .await?;
        let dims = stats
            .get("dimension")
            .and_then(|v| v.as_u64())
            .map(|d| d as usize);
        let ns = self.ns_for(collection);
        let count = stats
            .get("namespaces")
            .and_then(|v| v.get(&ns))
            .and_then(|n| n.get("vectorCount"))
            .and_then(|c| c.as_u64())
            .or_else(|| stats.get("totalVectorCount").and_then(|c| c.as_u64()))
            .unwrap_or(0);

        Ok(CollectionSchema {
            name: collection.to_string(),
            vector_count: count,
            dimensions: dims,
            distance_metric: Some("cosine".to_string()),
            index_type: Some("Pinecone Serverless / Pod".to_string()),
            segment_count: None,
            disk_bytes: None,
            vector_field_name: Some("values".to_string()),
            payload_fields: Vec::<PayloadFieldSchema>::new(),
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let url = format!("{}/indexes", self.control_plane_url);
        let body = json!({
            "name": req.name.trim(),
            "dimension": req.dimensions.max(1),
            "metric": match req.distance_metric.as_str() {
                "dot" => "dotproduct",
                "euclidean" => "euclidean",
                _ => "cosine",
            },
            "spec": {
                "serverless": {
                    "cloud": "aws",
                    "region": "us-east-1"
                }
            }
        });
        self.send_json(reqwest::Method::POST, &url, Some(body))
            .await?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        if self.is_control_plane() {
            let url = format!("{}/indexes/{}", self.control_plane_url, collection);
            self.send_json(reqwest::Method::DELETE, &url, None).await?;
            return Ok(());
        }
        let url = format!("{}/vectors/delete", self.endpoint_url);
        self.send_json(
            reqwest::Method::POST,
            &url,
            Some(json!({ "deleteAll": true, "namespace": self.ns_for(collection) })),
        )
        .await?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let ns = self.ns_for(collection);
        let limit = req.limit.clamp(1, 100);
        let mut list_url = format!("{}/vectors/list?limit={}", self.endpoint_url, limit);
        if !ns.is_empty() {
            list_url.push_str(&format!("&namespace={}", ns));
        }
        if let Some(c) = &req.cursor {
            if !c.is_empty() {
                list_url.push_str(&format!("&paginationToken={}", c));
            }
        }

        let listed = self
            .send_json(reqwest::Method::GET, &list_url, None)
            .await?;
        let ids: Vec<String> = listed
            .get("vectors")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("id").and_then(|s| s.as_str()).map(ToString::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let next_cursor = listed
            .pointer("/pagination/next")
            .and_then(|v| v.as_str())
            .map(ToString::to_string);

        if ids.is_empty() {
            return Ok(BrowseRecordsResponse {
                records: Vec::new(),
                next_cursor,
                total_count: None,
            });
        }

        let mut fetch_url = format!("{}/vectors/fetch?", self.endpoint_url);
        for (idx, id) in ids.iter().enumerate() {
            if idx > 0 {
                fetch_url.push('&');
            }
            fetch_url.push_str(&format!("ids={}", id));
        }
        if !ns.is_empty() {
            fetch_url.push_str(&format!("&namespace={}", ns));
        }

        let fetched = self
            .send_json(reqwest::Method::GET, &fetch_url, None)
            .await?;
        let vectors_obj = fetched
            .get("vectors")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();

        let mut records = Vec::new();
        for id in ids {
            if let Some(entry) = vectors_obj.get(&id) {
                let payload = entry
                    .get("metadata")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let document = payload
                    .get("document")
                    .or_else(|| payload.get("text"))
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string);
                let vector = if req.include_vectors {
                    entry.get("values").and_then(|v| {
                        v.as_array().map(|arr| {
                            arr.iter()
                                .filter_map(|x| x.as_f64().map(|f| f as f32))
                                .collect::<Vec<f32>>()
                        })
                    })
                } else {
                    None
                };
                records.push(VectorRecord {
                    id,
                    payload,
                    document,
                    vector,
                    score: None,
                });
            }
        }

        Ok(BrowseRecordsResponse {
            records,
            next_cursor,
            total_count: None,
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
        let ns = self.ns_for(collection);
        let vectors: Vec<Value> = records
            .iter()
            .map(|r| {
                let mut meta = r.payload.as_object().cloned().unwrap_or_default();
                if let Some(doc) = &r.document {
                    meta.entry("document".to_string()).or_insert_with(|| json!(doc));
                }
                json!({
                    "id": r.id,
                    "values": r.vector.clone().unwrap_or_default(),
                    "metadata": Value::Object(meta),
                })
            })
            .collect();

        let url = format!("{}/vectors/upsert", self.endpoint_url);
        let resp = self
            .send_json(
                reqwest::Method::POST,
                &url,
                Some(json!({ "vectors": vectors, "namespace": ns })),
            )
            .await?;
        let count = resp
            .get("upsertedCount")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize)
            .unwrap_or(records.len());
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
        let ns = self.ns_for(collection);
        let count = ids.len();
        let url = format!("{}/vectors/delete", self.endpoint_url);
        self.send_json(
            reqwest::Method::POST,
            &url,
            Some(json!({ "ids": ids, "namespace": ns })),
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
        let ns = self.ns_for(collection);
        let mut body = json!({
            "vector": req.vector,
            "topK": req.top_k.clamp(1, 500),
            "includeMetadata": true,
            "includeValues": req.include_vectors,
            "namespace": ns,
        });
        if let Some(filter) = req.filter.as_ref().and_then(build_pinecone_filter) {
            body["filter"] = filter;
        }

        let url = format!("{}/query", self.endpoint_url);
        let resp = self
            .send_json(reqwest::Method::POST, &url, Some(body))
            .await?;
        let latency_ms = start.elapsed().as_millis() as u64;

        let matches = resp
            .get("matches")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut records = Vec::new();
        for m in matches {
            let score = m.get("score").and_then(|v| v.as_f64()).map(|s| s as f32);
            if let (Some(thresh), Some(sc)) = (req.score_threshold, score) {
                if sc < thresh {
                    continue;
                }
            }
            let payload = m.get("metadata").cloned().unwrap_or_else(|| json!({}));
            let document = payload
                .get("document")
                .or_else(|| payload.get("text"))
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            let vector = m.get("values").and_then(|v| {
                v.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_f64().map(|f| f as f32))
                        .collect::<Vec<f32>>()
                })
            });
            records.push(VectorRecord {
                id: m
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                payload,
                document,
                vector,
                score,
            });
        }

        let _ = BTreeMap::<String, String>::new();
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
    async fn pinecone_adapter_roundtrip_mock() {
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
                let body = if first.starts_with("POST /describe_index_stats") {
                    json!({ "dimension": 3, "totalVectorCount": 1, "namespaces": { "docs": { "vectorCount": 1 } } })
                } else if first.starts_with("GET /vectors/list") {
                    json!({ "vectors": [{ "id": "p1" }], "pagination": {} })
                } else if first.starts_with("GET /vectors/fetch") {
                    json!({ "vectors": { "p1": { "id": "p1", "values": [0.1, 0.2, 0.3], "metadata": { "document": "pinecone doc" } } } })
                } else if first.starts_with("POST /query") {
                    json!({ "matches": [{ "id": "p1", "score": 0.94, "metadata": { "document": "pinecone doc" } }] })
                } else {
                    json!({ "upsertedCount": 1 })
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

        let adapter = PineconeAdapter::new(
            format!("http://127.0.0.1:{}", port),
            Some("pcsk_test".to_string()),
            HashMap::new(),
        )
        .expect("pinecone");
        assert!(adapter.test_connection().await.expect("test").ok);
        let cols = adapter.list_collections().await.expect("cols");
        assert_eq!(cols[0].name, "docs");
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
        assert_eq!(browsed.records[0].id, "p1");
        let searched = adapter
            .search_vectors(
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
            .expect("search");
        assert_eq!(searched.records.len(), 1);
        server.abort();
    }
}
