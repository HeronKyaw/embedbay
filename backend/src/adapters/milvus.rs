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

pub struct MilvusAdapter {
    base_url: String,
    token: Option<String>,
    db_name: String,
    client: reqwest::Client,
}

impl MilvusAdapter {
    pub fn new(
        base_url: String,
        token: Option<String>,
        extra: HashMap<String, String>,
    ) -> Result<Self, AdapterError> {
        let trimmed = base_url.trim().trim_end_matches('/').to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "Milvus endpoint URL cannot be empty".to_string(),
            ));
        }
        let db_name = extra
            .get("dbName")
            .or_else(|| extra.get("database"))
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "default".to_string());
        let client = http_client_for_url(&trimmed, 30)?;
        Ok(Self {
            base_url: trimmed,
            token: token.filter(|t| !t.trim().is_empty()),
            db_name,
            client,
        })
    }

    fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        if let Some(tok) = &self.token {
            if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", tok)) {
                h.insert(reqwest::header::AUTHORIZATION, v);
            }
        }
        h
    }

    async fn post_v2(&self, path: &str, mut body: Value) -> Result<Value, AdapterError> {
        if let Some(obj) = body.as_object_mut() {
            obj.entry("dbName".to_string())
                .or_insert_with(|| json!(self.db_name));
        }
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&body)
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
                "Milvus",
                status,
                &text,
            )));
        }
        let val: Value = serde_json::from_str(&text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("Milvus", &text)))?;
        if let Some(code) = val.get("code").and_then(|c| c.as_i64()) {
            if code != 0 {
                let msg = val
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Milvus API error");
                return Err(AdapterError::Api(format!("Milvus code {}: {}", code, msg)));
            }
        }
        Ok(val)
    }
}

fn build_milvus_filter(spec: &FilterSpec) -> Option<String> {
    match spec {
        FilterSpec::RawJson { json } => json.as_str().map(ToString::to_string),
        FilterSpec::Visual { logic, conditions } => {
            let parts: Vec<String> = conditions
                .iter()
                .filter_map(condition_to_milvus_expr)
                .collect();
            if parts.is_empty() {
                return None;
            }
            let op = match logic {
                FilterLogic::And => " and ",
                FilterLogic::Or => " or ",
            };
            Some(parts.join(op))
        }
    }
}

fn format_milvus_lit(v: &Value) -> String {
    match v {
        Value::String(s) => format!("\"{}\"", s.replace('"', "\\\"")),
        other => other.to_string(),
    }
}

fn condition_to_milvus_expr(cond: &FilterCondition) -> Option<String> {
    let field = cond.field.trim();
    if field.is_empty() {
        return None;
    }
    match cond.op.as_str() {
        "eq" => Some(format!("{} == {}", field, format_milvus_lit(&cond.value))),
        "neq" => Some(format!("{} != {}", field, format_milvus_lit(&cond.value))),
        "gt" => Some(format!("{} > {}", field, cond.value)),
        "gte" => Some(format!("{} >= {}", field, cond.value)),
        "lt" => Some(format!("{} < {}", field, cond.value)),
        "lte" => Some(format!("{} <= {}", field, cond.value)),
        "in" => {
            let arr = if let Some(a) = cond.value.as_array() {
                a.iter().map(format_milvus_lit).collect::<Vec<_>>().join(", ")
            } else if let Some(s) = cond.value.as_str() {
                s.split(',')
                    .map(str::trim)
                    .filter(|x| !x.is_empty())
                    .map(|x| format!("\"{}\"", x))
                    .collect::<Vec<_>>()
                    .join(", ")
            } else {
                format_milvus_lit(&cond.value)
            };
            Some(format!("{} in [{}]", field, arr))
        }
        "contains" => Some(format!(
            "{} like \"%{}%\"",
            field,
            cond.value.as_str().unwrap_or("")
        )),
        _ => None,
    }
}

#[async_trait]
impl VectorDbAdapter for MilvusAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let resp = self
            .post_v2("/v2/vectordb/collections/list", json!({}))
            .await?;
        let count = resp
            .get("data")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms: start.elapsed().as_millis() as u64,
            engine_version: Some("Milvus v2 REST".to_string()),
            message: format!("Connected to Milvus ({} collection(s))", count),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let resp = self
            .post_v2("/v2/vectordb/collections/list", json!({}))
            .await?;
        let names = resp
            .get("data")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut out = Vec::with_capacity(names.len());
        for item in names {
            let Some(name) = item.as_str() else {
                continue;
            };
            let stats = self
                .post_v2(
                    "/v2/vectordb/collections/get_stats",
                    json!({ "collectionName": name }),
                )
                .await
                .ok();
            let count = stats
                .and_then(|s| s.pointer("/data/rowCount").and_then(|v| v.as_u64()));
            out.push(CollectionSummary {
                name: name.to_string(),
                vector_count: count,
                dimensions: None,
                distance_metric: None,
            });
        }
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let desc = self
            .post_v2(
                "/v2/vectordb/collections/describe",
                json!({ "collectionName": collection }),
            )
            .await?;
        let stats = self
            .post_v2(
                "/v2/vectordb/collections/get_stats",
                json!({ "collectionName": collection }),
            )
            .await
            .ok();

        let count = stats
            .and_then(|s| s.pointer("/data/rowCount").and_then(|v| v.as_u64()))
            .unwrap_or(0);

        let mut fields = BTreeMap::new();
        let mut dims = None;
        let mut vec_field = None;

        if let Some(arr) = desc.pointer("/data/fields").and_then(|v| v.as_array()) {
            for f in arr {
                let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let ty = f.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if ty.contains("Vector") || ty == "FloatVector" {
                    vec_field = Some(name.to_string());
                    dims = f
                        .pointer("/params/dim")
                        .or_else(|| f.get("dim"))
                        .and_then(|v| {
                            v.as_u64()
                                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                        })
                        .map(|d| d as usize);
                } else if !name.is_empty() {
                    fields.insert(name.to_string(), ty.to_string());
                }
            }
        }

        let metric = desc
            .pointer("/data/indexes/0/metricType")
            .and_then(|v| v.as_str())
            .map(ToString::to_string);

        Ok(CollectionSchema {
            name: collection.to_string(),
            vector_count: count,
            dimensions: dims,
            distance_metric: metric,
            index_type: desc
                .pointer("/data/indexes/0/indexType")
                .and_then(|v| v.as_str())
                .map(ToString::to_string),
            segment_count: None,
            disk_bytes: None,
            vector_field_name: vec_field,
            payload_fields: fields
                .into_iter()
                .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
                .collect(),
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let metric = match req.distance_metric.as_str() {
            "dot" => "IP",
            "euclidean" => "L2",
            _ => "COSINE",
        };
        self.post_v2(
            "/v2/vectordb/collections/create",
            json!({
                "collectionName": req.name.trim(),
                "dimension": req.dimensions.max(1),
                "metricType": metric,
                "idType": "VarChar",
                "params": { "max_length": 128 }
            }),
        )
        .await?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        self.post_v2(
            "/v2/vectordb/collections/drop",
            json!({ "collectionName": collection }),
        )
        .await?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let filter = req
            .filter
            .as_ref()
            .and_then(build_milvus_filter)
            .unwrap_or_else(|| "id != \"\"".to_string());

        let resp = self
            .post_v2(
                "/v2/vectordb/entities/query",
                json!({
                    "collectionName": collection,
                    "filter": filter,
                    "limit": req.limit.clamp(1, 500),
                    "offset": req.offset,
                    "outputFields": ["*"]
                }),
            )
            .await?;

        let rows = resp
            .get("data")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let records = rows
            .into_iter()
            .map(|mut row| {
                let id = row
                    .get("id")
                    .or_else(|| row.get("pk"))
                    .map(|v| v.as_str().map(ToString::to_string).unwrap_or_else(|| v.to_string()))
                    .unwrap_or_default();
                let vector = row
                    .as_object_mut()
                    .and_then(|o| o.remove("vector"))
                    .and_then(|v| {
                        v.as_array().map(|arr| {
                            arr.iter()
                                .filter_map(|x| x.as_f64().map(|f| f as f32))
                                .collect::<Vec<f32>>()
                        })
                    });
                let document = row
                    .get("document")
                    .or_else(|| row.get("text"))
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string);
                VectorRecord {
                    id,
                    payload: row,
                    document,
                    vector: if req.include_vectors { vector } else { None },
                    score: None,
                }
            })
            .collect();

        Ok(BrowseRecordsResponse {
            records,
            next_cursor: None,
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
        let data: Vec<Value> = records
            .iter()
            .map(|r| {
                let mut obj = r.payload.as_object().cloned().unwrap_or_default();
                obj.insert("id".to_string(), json!(r.id));
                if let Some(doc) = &r.document {
                    obj.entry("document".to_string()).or_insert_with(|| json!(doc));
                }
                if let Some(vec) = &r.vector {
                    obj.insert("vector".to_string(), json!(vec));
                }
                Value::Object(obj)
            })
            .collect();
        let count = data.len();
        self.post_v2(
            "/v2/vectordb/entities/upsert",
            json!({ "collectionName": collection, "data": data }),
        )
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
        let formatted = ids
            .iter()
            .map(|id| format!("\"{}\"", id.replace('"', "\\\"")))
            .collect::<Vec<_>>()
            .join(", ");
        let filter = format!("id in [{}]", formatted);
        let count = ids.len();
        self.post_v2(
            "/v2/vectordb/entities/delete",
            json!({ "collectionName": collection, "filter": filter }),
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
            "collectionName": collection,
            "data": [req.vector],
            "limit": req.top_k.clamp(1, 500),
            "outputFields": ["*"],
        });
        if let Some(filter) = req.filter.as_ref().and_then(build_milvus_filter) {
            body["filter"] = json!(filter);
        }

        let resp = self
            .post_v2("/v2/vectordb/entities/search", body)
            .await?;
        let latency_ms = start.elapsed().as_millis() as u64;

        let rows = resp
            .get("data")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut records = Vec::new();
        for row in rows {
            let dist = row
                .get("distance")
                .and_then(|v| v.as_f64())
                .map(|d| d as f32);
            if let (Some(thresh), Some(sc)) = (req.score_threshold, dist) {
                if sc < thresh {
                    continue;
                }
            }
            let id = row
                .get("id")
                .map(|v| v.as_str().map(ToString::to_string).unwrap_or_else(|| v.to_string()))
                .unwrap_or_default();
            let document = row
                .get("document")
                .or_else(|| row.get("text"))
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            records.push(VectorRecord {
                id,
                payload: row,
                document,
                vector: None,
                score: dist,
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

    #[tokio::test]
    async fn milvus_adapter_roundtrip_mock() {
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
                let body = if first.contains("/collections/list") {
                    json!({ "code": 0, "data": ["chunks"] })
                } else if first.contains("/collections/get_stats") {
                    json!({ "code": 0, "data": { "rowCount": 1 } })
                } else if first.contains("/entities/query") {
                    json!({ "code": 0, "data": [{ "id": "m1", "document": "Milvus doc", "vector": [0.2, 0.3] }] })
                } else if first.contains("/entities/search") {
                    json!({ "code": 0, "data": [{ "id": "m1", "distance": 0.91, "document": "Milvus doc" }] })
                } else {
                    json!({ "code": 0, "data": {} })
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
            MilvusAdapter::new(format!("http://127.0.0.1:{}", port), None, HashMap::new())
                .expect("milvus");
        assert!(adapter.test_connection().await.expect("test").ok);
        let cols = adapter.list_collections().await.expect("cols");
        assert_eq!(cols[0].name, "chunks");
        let browsed = adapter
            .browse_records(
                "chunks",
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
        let searched = adapter
            .search_vectors(
                "chunks",
                SearchRequest {
                    vector: vec![0.2, 0.3],
                    top_k: 5,
                    score_threshold: None,
                    include_vectors: false,
                    filter: None,
                },
            )
            .await
            .expect("search");
        assert_eq!(searched.records[0].id, "m1");
        server.abort();
    }
}
