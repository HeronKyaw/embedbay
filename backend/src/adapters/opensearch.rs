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

pub struct OpenSearchAdapter {
    base_url: String,
    auth_type: String,
    secret: Option<String>,
    client: reqwest::Client,
}

impl OpenSearchAdapter {
    pub fn new(
        base_url: String,
        auth_type: String,
        secret: Option<String>,
    ) -> Result<Self, AdapterError> {
        let trimmed = base_url.trim().trim_end_matches('/').to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "OpenSearch endpoint URL cannot be empty".to_string(),
            ));
        }
        let client = http_client_for_url(&trimmed, 30)?;
        Ok(Self {
            base_url: trimmed,
            auth_type,
            secret: secret.filter(|k| !k.trim().is_empty()),
            client,
        })
    }

    fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        if let Some(sec) = &self.secret {
            let hdr = match self.auth_type.as_str() {
                "basic" => format!("Basic {}", sec),
                _ => format!("Bearer {}", sec),
            };
            if let Ok(v) = HeaderValue::from_str(&hdr) {
                h.insert(reqwest::header::AUTHORIZATION, v);
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
                "OpenSearch",
                status,
                &text,
            )));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("OpenSearch", &text)))
    }

    async fn send_ndjson(&self, path: &str, ndjson: String) -> Result<Value, AdapterError> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .header(reqwest::header::CONTENT_TYPE, "application/x-ndjson")
            .body(ndjson)
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
                "OpenSearch",
                status,
                &text,
            )));
        }
        serde_json::from_str(&text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("OpenSearch", &text)))
    }

    async fn detect_vector_field(
        &self,
        index: &str,
    ) -> (String, Option<usize>, Option<String>, BTreeMap<String, String>) {
        let mut vec_field = "embedding".to_string();
        let mut dims = None;
        let mut metric = None;
        let mut fields = BTreeMap::new();

        if let Ok(mapping) = self
            .send_json(reqwest::Method::GET, &format!("/{}/_mapping", index), None)
            .await
        {
            let props = mapping
                .pointer(&format!("/{}/mappings/properties", index))
                .and_then(|v| v.as_object());
            if let Some(obj) = props {
                for (name, def) in obj {
                    let ty = def.get("type").and_then(|v| v.as_str()).unwrap_or("object");
                    if ty == "knn_vector" || ty == "dense_vector" {
                        vec_field = name.clone();
                        dims = def
                            .get("dimension")
                            .or_else(|| def.get("dims"))
                            .and_then(|v| v.as_u64())
                            .map(|d| d as usize);
                        metric = def
                            .pointer("/method/space_type")
                            .or_else(|| def.get("similarity"))
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                    } else {
                        fields.insert(name.clone(), ty.to_string());
                    }
                }
            }
        }
        (vec_field, dims, metric, fields)
    }
}

fn build_os_filter(spec: &FilterSpec) -> Option<Value> {
    match spec {
        FilterSpec::RawJson { json } => Some(json.clone()),
        FilterSpec::Visual { logic, conditions } => {
            let clauses: Vec<Value> = conditions
                .iter()
                .filter_map(condition_to_os_clause)
                .collect();
            if clauses.is_empty() {
                return None;
            }
            match logic {
                FilterLogic::And => Some(json!({ "bool": { "filter": clauses } })),
                FilterLogic::Or => {
                    Some(json!({ "bool": { "should": clauses, "minimum_should_match": 1 } }))
                }
            }
        }
    }
}

fn condition_to_os_clause(cond: &FilterCondition) -> Option<Value> {
    let field = cond.field.trim();
    if field.is_empty() {
        return None;
    }
    match cond.op.as_str() {
        "eq" => Some(json!({ "term": { field: cond.value } })),
        "neq" => Some(json!({ "bool": { "must_not": [{ "term": { field: cond.value } }] } })),
        "in" => {
            let arr = if cond.value.is_array() {
                cond.value.clone()
            } else if let Some(s) = cond.value.as_str() {
                let parts: Vec<&str> = s
                    .split(',')
                    .map(str::trim)
                    .filter(|x| !x.is_empty())
                    .collect();
                json!(parts)
            } else {
                json!([cond.value])
            };
            Some(json!({ "terms": { field: arr } }))
        }
        "gt" => Some(json!({ "range": { field: { "gt": cond.value } } })),
        "gte" => Some(json!({ "range": { field: { "gte": cond.value } } })),
        "lt" => Some(json!({ "range": { field: { "lt": cond.value } } })),
        "lte" => Some(json!({ "range": { field: { "lte": cond.value } } })),
        "contains" => Some(json!({ "match": { field: cond.value } })),
        _ => None,
    }
}

#[async_trait]
impl VectorDbAdapter for OpenSearchAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let root = self.send_json(reqwest::Method::GET, "/", None).await?;
        let latency_ms = start.elapsed().as_millis() as u64;
        let ver = root
            .pointer("/version/number")
            .and_then(|v| v.as_str())
            .map(ToString::to_string);
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms,
            engine_version: ver.clone(),
            message: format!(
                "Connected to OpenSearch{}",
                ver.map(|v| format!(" v{}", v)).unwrap_or_default()
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let resp = self
            .send_json(reqwest::Method::GET, "/_cat/indices?format=json", None)
            .await?;
        let arr = resp.as_array().cloned().ok_or_else(|| {
            AdapterError::Api(
                "Unexpected response from OpenSearch. Check endpoint URL or credentials."
                    .to_string(),
            )
        })?;
        let mut out = Vec::new();
        for item in arr {
            let name = item
                .get("index")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if name.starts_with('.') {
                continue;
            }
            let count = item
                .get("docs.count")
                .and_then(|v| v.as_str().and_then(|s| s.parse::<u64>().ok()));
            out.push(CollectionSummary {
                name,
                vector_count: count,
                dimensions: None,
                distance_metric: None,
            });
        }
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let (vec_field, dims, metric, fields) = self.detect_vector_field(collection).await;
        let cnt = self
            .send_json(
                reqwest::Method::GET,
                &format!("/{}/_count", collection),
                None,
            )
            .await
            .ok()
            .and_then(|v| v.get("count").and_then(|c| c.as_u64()))
            .unwrap_or(0);

        Ok(CollectionSchema {
            name: collection.to_string(),
            vector_count: cnt,
            dimensions: dims,
            distance_metric: metric,
            index_type: Some("HNSW (knn_vector / Lucene)".to_string()),
            segment_count: None,
            disk_bytes: None,
            vector_field_name: Some(vec_field),
            payload_fields: fields
                .into_iter()
                .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
                .collect(),
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let space_type = match req.distance_metric.as_str() {
            "dot" => "innerproduct",
            "euclidean" => "l2",
            _ => "cosinesimil",
        };
        let body = json!({
            "settings": {
                "index": {
                    "knn": true
                }
            },
            "mappings": {
                "properties": {
                    "embedding": {
                        "type": "knn_vector",
                        "dimension": req.dimensions.max(1),
                        "method": {
                            "name": "hnsw",
                            "space_type": space_type,
                            "engine": "lucene"
                        }
                    },
                    "document": { "type": "text" }
                }
            }
        });
        self.send_json(
            reqwest::Method::PUT,
            &format!("/{}", req.name.trim()),
            Some(body),
        )
        .await?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        self.send_json(reqwest::Method::DELETE, &format!("/{}", collection), None)
            .await?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let (vec_field, _, _, _) = self.detect_vector_field(collection).await;
        let query = req
            .filter
            .as_ref()
            .and_then(build_os_filter)
            .unwrap_or_else(|| json!({ "match_all": {} }));

        let mut body = json!({
            "from": req.offset,
            "size": req.limit.clamp(1, 500),
            "query": query,
        });
        if !req.include_vectors {
            body["_source"] = json!({ "excludes": [vec_field] });
        }

        let resp = self
            .send_json(
                reqwest::Method::POST,
                &format!("/{}/_search", collection),
                Some(body),
            )
            .await?;

        let total = resp.pointer("/hits/total/value").and_then(|v| v.as_u64());
        let hits = resp
            .pointer("/hits/hits")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let records = hits
            .into_iter()
            .map(|h| parse_os_hit(h, &vec_field, req.include_vectors, None))
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
        let (vec_field, _, _, _) = self.detect_vector_field(collection).await;
        let mut ndjson = String::new();
        for rec in &records {
            let meta = json!({ "index": { "_index": collection, "_id": rec.id } });
            let mut obj = rec.payload.as_object().cloned().unwrap_or_default();
            if let Some(doc) = &rec.document {
                obj.entry("document".to_string()).or_insert_with(|| json!(doc));
            }
            if let Some(vec) = &rec.vector {
                obj.insert(vec_field.clone(), json!(vec));
            }
            ndjson.push_str(&meta.to_string());
            ndjson.push('\n');
            ndjson.push_str(&Value::Object(obj).to_string());
            ndjson.push('\n');
        }
        self.send_ndjson("/_bulk?refresh=true", ndjson).await?;
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
        let mut ndjson = String::new();
        for id in &ids {
            let meta = json!({ "delete": { "_index": collection, "_id": id } });
            ndjson.push_str(&meta.to_string());
            ndjson.push('\n');
        }
        self.send_ndjson("/_bulk?refresh=true", ndjson).await?;
        Ok(ids.len())
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let (vec_field, _, _, _) = self.detect_vector_field(collection).await;
        let k = req.top_k.clamp(1, 500);

        let mut knn_inner = json!({
            "vector": req.vector,
            "k": k,
        });
        if let Some(filter) = req.filter.as_ref().and_then(build_os_filter) {
            knn_inner["filter"] = filter;
        }

        let mut body = json!({
            "size": k,
            "query": {
                "knn": {
                    vec_field.clone(): knn_inner
                }
            }
        });
        if !req.include_vectors {
            body["_source"] = json!({ "excludes": [vec_field] });
        }

        let resp = self
            .send_json(
                reqwest::Method::POST,
                &format!("/{}/_search", collection),
                Some(body),
            )
            .await?;
        let latency_ms = start.elapsed().as_millis() as u64;

        let hits = resp
            .pointer("/hits/hits")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut records = Vec::new();
        for h in hits {
            let score = h.get("_score").and_then(|v| v.as_f64()).map(|s| s as f32);
            if let (Some(thresh), Some(sc)) = (req.score_threshold, score) {
                if sc < thresh {
                    continue;
                }
            }
            records.push(parse_os_hit(h, &vec_field, req.include_vectors, score));
        }

        Ok(SearchResponse {
            records,
            latency_ms,
        })
    }
}

fn parse_os_hit(
    h: Value,
    vec_field: &str,
    include_vectors: bool,
    score: Option<f32>,
) -> VectorRecord {
    let id = h
        .get("_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut src = h.get("_source").cloned().unwrap_or_else(|| json!({}));
    let vector = src
        .as_object_mut()
        .and_then(|o| o.remove(vec_field))
        .and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_f64().map(|f| f as f32))
                    .collect::<Vec<f32>>()
            })
        });
    let document = src
        .get("document")
        .or_else(|| src.get("text"))
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    VectorRecord {
        id,
        payload: src,
        document,
        vector: if include_vectors { vector } else { None },
        score,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn opensearch_adapter_roundtrip_mock() {
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
                let body = if first.starts_with("GET / ") {
                    json!({ "version": { "number": "3.10.0", "distribution": "opensearch" } })
                } else if first.starts_with("GET /_cat/indices") {
                    json!([{ "index": "os_vectors", "docs.count": "1" }])
                } else if first.starts_with("GET /os_vectors/_mapping") {
                    json!({ "os_vectors": { "mappings": { "properties": { "embedding": { "type": "knn_vector", "dimension": 3, "method": { "space_type": "cosinesimil" } }, "document": { "type": "text" } } } } })
                } else if first.starts_with("POST /os_vectors/_search") {
                    json!({ "hits": { "total": { "value": 1 }, "hits": [{ "_id": "o1", "_score": 0.92, "_source": { "document": "OpenSearch vector" } }] } })
                } else {
                    json!({ "count": 1, "errors": false })
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

        let adapter = OpenSearchAdapter::new(
            format!("http://127.0.0.1:{}", port),
            "none".to_string(),
            None,
        )
        .expect("os");
        assert_eq!(
            adapter.test_connection().await.expect("test").engine_version.as_deref(),
            Some("3.10.0")
        );
        assert_eq!(
            adapter.list_collections().await.expect("list")[0].name,
            "os_vectors"
        );
        let searched = adapter
            .search_vectors(
                "os_vectors",
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
        assert_eq!(searched.records[0].id, "o1");
        server.abort();
    }
}
