use std::collections::BTreeMap;
use std::time::Instant;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::adapters::{
    format_connection_error, AdapterError, BrowseRecordsRequest, BrowseRecordsResponse,
    CollectionSchema, CollectionSummary, ConnectionTestResult, CreateCollectionRequest,
    FilterCondition, FilterLogic, FilterSpec, PayloadFieldSchema, SearchRequest, SearchResponse,
    VectorDbAdapter, VectorRecord,
};

pub struct RedisStackAdapter {
    connection_url: String,
}

impl RedisStackAdapter {
    pub fn new(endpoint_url: String, secret: Option<String>) -> Result<Self, AdapterError> {
        let mut url = endpoint_url.trim().to_string();
        if url.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "Redis connection URL cannot be empty".to_string(),
            ));
        }
        if !url.contains("://") {
            url = format!("redis://{}", url);
        }
        if let Some(pwd) = secret.filter(|s| !s.trim().is_empty()) {
            if !url.contains('@') {
                if let Some((scheme, rest)) = url.split_once("://") {
                    url = format!("{}://:{}@{}", scheme, pwd, rest);
                }
            }
        }
        Ok(Self {
            connection_url: url,
        })
    }

    async fn get_conn(&self) -> Result<redis::aio::MultiplexedConnection, AdapterError> {
        let client = redis::Client::open(self.connection_url.as_str()).map_err(|e| {
            AdapterError::InvalidRequest(format_connection_error("Redis", &e.to_string()))
        })?;
        tokio::time::timeout(
            std::time::Duration::from_secs(8),
            client.get_multiplexed_async_connection(),
        )
        .await
        .map_err(|_| {
            AdapterError::Http(
                "Connection timed out. Check the host, VPN, or firewall.".to_string(),
            )
        })?
        .map_err(|e| AdapterError::Http(format_connection_error("Redis", &e.to_string())))
    }
}

pub fn f32_slice_to_le_bytes(vec: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vec.len() * 4);
    for &f in vec {
        bytes.extend_from_slice(&f.to_le_bytes());
    }
    bytes
}

pub fn le_bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

pub fn build_redis_filter_expr(spec: Option<&FilterSpec>) -> String {
    let Some(filter) = spec else {
        return "*".to_string();
    };
    match filter {
        FilterSpec::RawJson { json } => json
            .as_str()
            .map(ToString::to_string)
            .unwrap_or_else(|| "*".to_string()),
        FilterSpec::Visual { logic, conditions } => {
            let parts: Vec<String> = conditions
                .iter()
                .filter_map(condition_to_redis_tag_or_num)
                .collect();
            if parts.is_empty() {
                return "*".to_string();
            }
            match logic {
                FilterLogic::And => parts.join(" "),
                FilterLogic::Or => format!("({})", parts.join(" | ")),
            }
        }
    }
}

fn condition_to_redis_tag_or_num(cond: &FilterCondition) -> Option<String> {
    let field = cond.field.trim();
    if field.is_empty() {
        return None;
    }
    match cond.op.as_str() {
        "eq" => {
            if let Some(n) = cond.value.as_f64() {
                Some(format!("@{}:[{} {}]", field, n, n))
            } else {
                let s = cond.value.as_str().unwrap_or("");
                Some(format!("@{}:{{{}}}", field, s))
            }
        }
        "neq" => Some(format!("-@{}:{{{}}}", field, cond.value.as_str().unwrap_or(""))),
        "gt" => Some(format!("@{}:[({} +inf]", field, cond.value)),
        "gte" => Some(format!("@{}:[{} +inf]", field, cond.value)),
        "lt" => Some(format!("@{}:[-inf ({}]", field, cond.value)),
        "lte" => Some(format!("@{}:[-inf {}]", field, cond.value)),
        _ => None,
    }
}

fn redis_value_to_string(v: &redis::Value) -> String {
    match v {
        redis::Value::BulkString(b) => String::from_utf8_lossy(b).into_owned(),
        redis::Value::SimpleString(s) => s.clone(),
        redis::Value::Int(i) => i.to_string(),
        redis::Value::Double(d) => d.to_string(),
        _ => String::new(),
    }
}

pub fn parse_ft_search_reply(
    val: &redis::Value,
    include_vectors: bool,
    score_field_name: Option<&str>,
) -> (u64, Vec<VectorRecord>) {
    let redis::Value::Array(items) = val else {
        return (0, Vec::new());
    };
    if items.is_empty() {
        return (0, Vec::new());
    }
    let total = match items[0] {
        redis::Value::Int(n) => n.max(0) as u64,
        _ => 0,
    };

    let mut records = Vec::new();
    let mut i = 1usize;
    while i + 1 < items.len() {
        let doc_key = redis_value_to_string(&items[i]);
        let mut payload_map = serde_json::Map::new();
        let mut document: Option<String> = None;
        let mut vector: Option<Vec<f32>> = None;
        let mut score: Option<f32> = None;

        if let redis::Value::Array(kv_pairs) = &items[i + 1] {
            let mut k_idx = 0usize;
            while k_idx + 1 < kv_pairs.len() {
                let k = redis_value_to_string(&kv_pairs[k_idx]);
                let raw_val = &kv_pairs[k_idx + 1];
                if score_field_name == Some(k.as_str()) {
                    if let Ok(dist) = redis_value_to_string(raw_val).parse::<f32>() {
                        score = Some((1.0 - dist).clamp(0.0, 1.0));
                    }
                } else if k == "vector" || k == "embedding" {
                    if let redis::Value::BulkString(b) = raw_val {
                        if include_vectors && b.len() >= 4 && b.len() % 4 == 0 {
                            vector = Some(le_bytes_to_f32_vec(b));
                        }
                    }
                } else {
                    let s = redis_value_to_string(raw_val);
                    if k == "document" || k == "text" {
                        document = Some(s.clone());
                    }
                    payload_map.insert(k, json!(s));
                }
                k_idx += 2;
            }
        }

        records.push(VectorRecord {
            id: doc_key,
            payload: Value::Object(payload_map),
            document,
            vector,
            score,
        });
        i += 2;
    }

    (total, records)
}

#[async_trait]
impl VectorDbAdapter for RedisStackAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let mut conn = self.get_conn().await?;
        let pong: String = redis::cmd("PING")
            .query_async(&mut conn)
            .await
            .map_err(|e| AdapterError::Http(format_connection_error("Redis", &e.to_string())))?;
        Ok(ConnectionTestResult {
            ok: pong.eq_ignore_ascii_case("PONG"),
            latency_ms: start.elapsed().as_millis() as u64,
            engine_version: Some("Redis Stack".to_string()),
            message: format!("Redis Stack responded {}", pong),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let mut conn = self.get_conn().await?;
        let indexes: Vec<String> = redis::cmd("FT._LIST")
            .query_async(&mut conn)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        Ok(indexes
            .into_iter()
            .map(|name| CollectionSummary {
                name,
                vector_count: None,
                dimensions: None,
                distance_metric: None,
            })
            .collect())
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let mut conn = self.get_conn().await?;
        let info: redis::Value = redis::cmd("FT.INFO")
            .arg(collection)
            .query_async(&mut conn)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let mut num_docs = 0u64;
        if let redis::Value::Array(arr) = info {
            for pair in arr.chunks(2) {
                if pair.len() == 2 && redis_value_to_string(&pair[0]) == "num_docs" {
                    num_docs = redis_value_to_string(&pair[1]).parse::<u64>().unwrap_or(0);
                }
            }
        }

        let mut fields = BTreeMap::new();
        fields.insert("document".to_string(), "TEXT".to_string());

        Ok(CollectionSchema {
            name: collection.to_string(),
            vector_count: num_docs,
            dimensions: None,
            distance_metric: Some("cosine".to_string()),
            index_type: Some("RediSearch HNSW".to_string()),
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
        let mut conn = self.get_conn().await?;
        let metric = match req.distance_metric.as_str() {
            "dot" => "IP",
            "euclidean" => "L2",
            _ => "COSINE",
        };
        let prefix = format!("{}:", req.name.trim());
        let dim_str = req.dimensions.max(1).to_string();
        let _: () = redis::cmd("FT.CREATE")
            .arg(req.name.trim())
            .arg(&["ON", "HASH", "PREFIX", "1", &prefix, "SCHEMA"])
            .arg(&["document", "TEXT"])
            .arg(&[
                "vector",
                "VECTOR",
                "HNSW",
                "6",
                "TYPE",
                "FLOAT32",
                "DIM",
                dim_str.as_str(),
                "DISTANCE_METRIC",
                metric,
            ])
            .query_async(&mut conn)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let mut conn = self.get_conn().await?;
        let _: () = redis::cmd("FT.DROPINDEX")
            .arg(collection)
            .query_async(&mut conn)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let mut conn = self.get_conn().await?;
        let query = build_redis_filter_expr(req.filter.as_ref());
        let val: redis::Value = redis::cmd("FT.SEARCH")
            .arg(collection)
            .arg(query)
            .arg("LIMIT")
            .arg(req.offset)
            .arg(req.limit.clamp(1, 500))
            .arg("DIALECT")
            .arg(2)
            .query_async(&mut conn)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let (total, records) = parse_ft_search_reply(&val, req.include_vectors, None);
        Ok(BrowseRecordsResponse {
            records,
            next_cursor: None,
            total_count: Some(total),
        })
    }

    async fn upsert_records(
        &self,
        collection: &str,
        records: Vec<VectorRecord>,
    ) -> Result<usize, AdapterError> {
        let mut conn = self.get_conn().await?;
        for rec in &records {
            let key = if rec.id.contains(':') {
                rec.id.clone()
            } else {
                format!("{}:{}", collection, rec.id)
            };
            let mut cmd = redis::cmd("HSET");
            cmd.arg(&key);
            if let Some(doc) = &rec.document {
                cmd.arg("document").arg(doc);
            }
            if let Some(obj) = rec.payload.as_object() {
                for (k, v) in obj {
                    if k != "document" {
                        let v_str = v.as_str().map(ToString::to_string).unwrap_or_else(|| v.to_string());
                        cmd.arg(k).arg(v_str);
                    }
                }
            }
            if let Some(vec) = &rec.vector {
                cmd.arg("vector").arg(f32_slice_to_le_bytes(vec));
            }
            let _: () = cmd
                .query_async(&mut conn)
                .await
                .map_err(|e| AdapterError::Api(e.to_string()))?;
        }
        Ok(records.len())
    }

    async fn delete_records(
        &self,
        _collection: &str,
        ids: Vec<String>,
    ) -> Result<usize, AdapterError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut conn = self.get_conn().await?;
        let deleted: usize = redis::cmd("DEL")
            .arg(&ids)
            .query_async(&mut conn)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        Ok(deleted)
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let mut conn = self.get_conn().await?;
        let prefilter = build_redis_filter_expr(req.filter.as_ref());
        let query_str = format!(
            "({})=>[KNN {} @vector $vec AS __score]",
            prefilter,
            req.top_k.clamp(1, 500)
        );
        let blob = f32_slice_to_le_bytes(&req.vector);

        let val: redis::Value = redis::cmd("FT.SEARCH")
            .arg(collection)
            .arg(query_str)
            .arg("PARAMS")
            .arg(2)
            .arg("vec")
            .arg(blob)
            .arg("SORTBY")
            .arg("__score")
            .arg("DIALECT")
            .arg(2)
            .query_async(&mut conn)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let latency_ms = start.elapsed().as_millis() as u64;
        let (_, mut records) = parse_ft_search_reply(&val, req.include_vectors, Some("__score"));
        if let Some(thresh) = req.score_threshold {
            records.retain(|r| r.score.unwrap_or(0.0) >= thresh);
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

    #[test]
    fn serializes_vectors_and_parses_ft_search_resp_replies() {
        let orig = vec![0.25f32, -0.5f32, 1.0f32];
        let bytes = f32_slice_to_le_bytes(&orig);
        assert_eq!(bytes.len(), 12);
        assert_eq!(le_bytes_to_f32_vec(&bytes), orig);

        let filter_expr = build_redis_filter_expr(Some(&FilterSpec::Visual {
            logic: FilterLogic::And,
            conditions: vec![FilterCondition {
                field: "category".to_string(),
                op: "eq".to_string(),
                value: json!("rag"),
            }],
        }));
        assert_eq!(filter_expr, "@category:{rag}");

        let mock_resp = redis::Value::Array(vec![
            redis::Value::Int(1),
            redis::Value::BulkString(b"idx:1".to_vec()),
            redis::Value::Array(vec![
                redis::Value::BulkString(b"__score".to_vec()),
                redis::Value::BulkString(b"0.1".to_vec()),
                redis::Value::BulkString(b"document".to_vec()),
                redis::Value::BulkString(b"Redis Stack vector".to_vec()),
                redis::Value::BulkString(b"vector".to_vec()),
                redis::Value::BulkString(bytes),
            ]),
        ]);

        let (total, records) = parse_ft_search_reply(&mock_resp, true, Some("__score"));
        assert_eq!(total, 1);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, "idx:1");
        assert_eq!(records[0].document.as_deref(), Some("Redis Stack vector"));
        assert!((records[0].score.unwrap_or(0.0) - 0.9).abs() < 1e-4);
        assert_eq!(records[0].vector.as_ref(), Some(&orig));
    }
}
