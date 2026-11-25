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

pub struct WeaviateAdapter {
    base_url: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl WeaviateAdapter {
    pub fn new(base_url: String, api_key: Option<String>) -> Result<Self, AdapterError> {
        let trimmed = base_url.trim().trim_end_matches('/').to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "Weaviate endpoint URL cannot be empty".to_string(),
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
                "Weaviate",
                status,
                &text,
            )));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("Weaviate", &text)))
    }
}

fn format_graphql_where(spec: &FilterSpec) -> Option<String> {
    match spec {
        FilterSpec::RawJson { json } => Some(json.to_string()),
        FilterSpec::Visual { logic, conditions } => {
            let parts: Vec<String> = conditions
                .iter()
                .filter_map(condition_to_graphql)
                .collect();
            if parts.is_empty() {
                return None;
            }
            if parts.len() == 1 {
                return parts.into_iter().next();
            }
            let op = match logic {
                FilterLogic::And => "And",
                FilterLogic::Or => "Or",
            };
            Some(format!("{{operator: {}, operands: [{}]}}", op, parts.join(", ")))
        }
    }
}

fn condition_to_graphql(cond: &FilterCondition) -> Option<String> {
    let field = cond.field.trim();
    if field.is_empty() {
        return None;
    }
    let op = match cond.op.as_str() {
        "eq" => "Equal",
        "neq" => "NotEqual",
        "gt" => "GreaterThan",
        "gte" => "GreaterThanEqual",
        "lt" => "LessThan",
        "lte" => "LessThanEqual",
        "contains" => "Like",
        _ => return None,
    };
    let val_field = if cond.value.is_number() {
        format!("valueNumber: {}", cond.value)
    } else if let Some(b) = cond.value.as_bool() {
        format!("valueBoolean: {}", b)
    } else {
        let s = cond.value.as_str().unwrap_or("");
        format!("valueText: \"{}\"", s.replace('"', "\\\""))
    };
    Some(format!("{{path: [\"{}\"], operator: {}, {}}}", field, op, val_field))
}

#[async_trait]
impl VectorDbAdapter for WeaviateAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let meta = self.send_json(reqwest::Method::GET, "/v1/meta", None).await?;
        let latency_ms = start.elapsed().as_millis() as u64;
        let version = meta
            .get("version")
            .and_then(|v| v.as_str())
            .map(ToString::to_string);
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms,
            engine_version: version.clone(),
            message: format!(
                "Connected to Weaviate{}",
                version.map(|v| format!(" v{}", v)).unwrap_or_default()
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let schema = self
            .send_json(reqwest::Method::GET, "/v1/schema", None)
            .await?;
        let classes = schema
            .get("classes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut out = Vec::with_capacity(classes.len());
        for cls in classes {
            let name = cls
                .get("class")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let metric = cls
                .pointer("/vectorIndexConfig/distance")
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            out.push(CollectionSummary {
                name,
                vector_count: None,
                dimensions: None,
                distance_metric: metric,
            });
        }
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let path = format!("/v1/schema/{}", collection);
        let cls = self.send_json(reqwest::Method::GET, &path, None).await?;
        let props = cls
            .get("properties")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut fields = BTreeMap::new();
        for p in props {
            if let Some(name) = p.get("name").and_then(|v| v.as_str()) {
                let dt = p
                    .get("dataType")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|s| s.as_str())
                    .unwrap_or("text")
                    .to_string();
                fields.insert(name.to_string(), dt);
            }
        }

        let metric = cls
            .pointer("/vectorIndexConfig/distance")
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
            .or_else(|| Some("cosine".to_string()));

        // Count objects
        let objs = self
            .send_json(
                reqwest::Method::GET,
                &format!("/v1/objects?class={}&limit=1", collection),
                None,
            )
            .await
            .ok();
        let total = objs
            .and_then(|o| o.get("totalResults").and_then(|v| v.as_u64()))
            .unwrap_or(0);

        Ok(CollectionSchema {
            name: collection.to_string(),
            vector_count: total,
            dimensions: None,
            distance_metric: metric,
            index_type: cls
                .get("vectorIndexType")
                .and_then(|v| v.as_str())
                .map(ToString::to_string),
            segment_count: None,
            disk_bytes: None,
            vector_field_name: Some("vector".to_string()),
            payload_fields: fields
                .into_iter()
                .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
                .collect(),
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let body = json!({
            "class": req.name.trim(),
            "vectorizer": "none",
            "vectorIndexConfig": {
                "distance": match req.distance_metric.as_str() {
                    "dot" => "dot",
                    "euclidean" => "l2-squared",
                    _ => "cosine",
                }
            },
            "properties": [
                { "name": "document", "dataType": ["text"] }
            ]
        });
        self.send_json(reqwest::Method::POST, "/v1/schema", Some(body))
            .await?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        self.send_json(
            reqwest::Method::DELETE,
            &format!("/v1/schema/{}", collection),
            None,
        )
        .await?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let include = if req.include_vectors {
            "&include=vector"
        } else {
            ""
        };
        let path = format!(
            "/v1/objects?class={}&limit={}&offset={}{}",
            collection,
            req.limit.clamp(1, 500),
            req.offset,
            include
        );
        let resp = self.send_json(reqwest::Method::GET, &path, None).await?;
        let objs = resp
            .get("objects")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let total = resp.get("totalResults").and_then(|v| v.as_u64());

        let records = objs
            .into_iter()
            .map(|o| {
                let id = o
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let payload = o.get("properties").cloned().unwrap_or_else(|| json!({}));
                let document = payload
                    .get("document")
                    .or_else(|| payload.get("text"))
                    .and_then(|v| v.as_str())
                    .map(ToString::to_string);
                let vector = o.get("vector").and_then(|v| {
                    v.as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_f64().map(|f| f as f32))
                            .collect::<Vec<f32>>()
                    })
                });
                VectorRecord {
                    id,
                    payload,
                    document,
                    vector,
                    score: None,
                }
            })
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
        let mut count = 0usize;
        for rec in &records {
            let mut props = rec.payload.as_object().cloned().unwrap_or_default();
            if let Some(doc) = &rec.document {
                props.entry("document".to_string()).or_insert_with(|| json!(doc));
            }
            let mut body = json!({
                "class": collection,
                "id": rec.id,
                "properties": Value::Object(props),
            });
            if let Some(vec) = &rec.vector {
                body["vector"] = json!(vec);
            }
            self.send_json(reqwest::Method::POST, "/v1/objects", Some(body))
                .await?;
            count += 1;
        }
        Ok(count)
    }

    async fn delete_records(
        &self,
        collection: &str,
        ids: Vec<String>,
    ) -> Result<usize, AdapterError> {
        let mut count = 0usize;
        for id in &ids {
            self.send_json(
                reqwest::Method::DELETE,
                &format!("/v1/objects/{}/{}", collection, id),
                None,
            )
            .await?;
            count += 1;
        }
        Ok(count)
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let info = self.get_collection_info(collection).await.ok();
        let field_list: Vec<String> = info
            .map(|i| i.payload_fields.into_iter().map(|f| f.name).collect())
            .filter(|v: &Vec<String>| !v.is_empty())
            .unwrap_or_else(|| vec!["document".to_string()]);

        let vec_str = serde_json::to_string(&req.vector).unwrap_or_else(|_| "[]".to_string());
        let where_part = req
            .filter
            .as_ref()
            .and_then(format_graphql_where)
            .map(|w| format!(", where: {}", w))
            .unwrap_or_default();
        let vec_select = if req.include_vectors { " vector" } else { "" };

        let gql = format!(
            "{{ Get {{ {}(nearVector: {{vector: {}}}, limit: {}{}) {{ {} _additional {{ id certainty distance{} }} }} }} }}",
            collection,
            vec_str,
            req.top_k.clamp(1, 500),
            where_part,
            field_list.join(" "),
            vec_select
        );

        let resp = self
            .send_json(reqwest::Method::POST, "/v1/graphql", Some(json!({ "query": gql })))
            .await?;
        let latency_ms = start.elapsed().as_millis() as u64;

        let rows = resp
            .pointer(&format!("/data/Get/{}", collection))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut records = Vec::new();
        for mut row in rows {
            let add = row
                .as_object_mut()
                .and_then(|o| o.remove("_additional"))
                .unwrap_or(Value::Null);
            let score = add
                .get("certainty")
                .and_then(|v| v.as_f64())
                .map(|s| s as f32)
                .or_else(|| {
                    add.get("distance")
                        .and_then(|v| v.as_f64())
                        .map(|d| (1.0 / (1.0 + d.max(0.0))) as f32)
                });
            if let (Some(thresh), Some(sc)) = (req.score_threshold, score) {
                if sc < thresh {
                    continue;
                }
            }
            let id = add
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let document = row
                .get("document")
                .or_else(|| row.get("text"))
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            let vector = add.get("vector").and_then(|v| {
                v.as_array().map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_f64().map(|f| f as f32))
                        .collect::<Vec<f32>>()
                })
            });

            records.push(VectorRecord {
                id,
                payload: row,
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

    #[tokio::test]
    async fn weaviate_adapter_roundtrip_mock() {
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
                let body = if first.starts_with("GET /v1/meta") {
                    json!({ "version": "1.28.0" })
                } else if first.starts_with("GET /v1/schema/Article") {
                    json!({ "class": "Article", "vectorIndexType": "hnsw", "properties": [{ "name": "document", "dataType": ["text"] }] })
                } else if first.starts_with("GET /v1/schema") {
                    json!({ "classes": [{ "class": "Article", "vectorIndexConfig": { "distance": "cosine" } }] })
                } else if first.starts_with("GET /v1/objects") {
                    json!({ "totalResults": 1, "objects": [{ "id": "w1", "properties": { "document": "Weaviate doc" }, "vector": [0.1, 0.2] }] })
                } else if first.starts_with("POST /v1/graphql") {
                    json!({ "data": { "Get": { "Article": [{ "document": "Weaviate doc", "_additional": { "id": "w1", "certainty": 0.96 } }] } } })
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

        let adapter =
            WeaviateAdapter::new(format!("http://127.0.0.1:{}", port), None).expect("weaviate");
        assert_eq!(
            adapter.test_connection().await.expect("test").engine_version.as_deref(),
            Some("1.28.0")
        );
        assert_eq!(adapter.list_collections().await.expect("cols")[0].name, "Article");
        assert_eq!(
            adapter
                .search_vectors(
                    "Article",
                    SearchRequest {
                        vector: vec![0.1, 0.2],
                        top_k: 3,
                        score_threshold: None,
                        include_vectors: false,
                        filter: None,
                    },
                )
                .await
                .expect("search")
                .records[0]
                .id,
            "w1"
        );
        server.abort();
    }
}
