use std::collections::{BTreeMap, HashMap};
use std::time::Instant;

use async_trait::async_trait;
use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{json, Value};

use crate::adapters::{
    format_http_status_error, format_invalid_json_error, format_reqwest_error,
    http_client_for_url, AdapterError, BrowseRecordsRequest, BrowseRecordsResponse,
    CollectionSchema, CollectionSummary, ConnectionTestResult, CreateCollectionRequest,
    FilterCondition, FilterLogic, FilterSpec, PayloadFieldSchema, SearchRequest, SearchResponse,
    VectorDbAdapter, VectorRecord,
};

pub struct SurrealDbAdapter {
    base_url: String,
    namespace: String,
    database: String,
    auth_header: Option<String>,
    client: reqwest::Client,
}

fn sanitize_surreal_ident(name: &str) -> Result<String, AdapterError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(AdapterError::InvalidRequest(format!(
            "Invalid SurrealDB table name '{}'",
            name
        )));
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return Err(AdapterError::InvalidRequest("Empty identifier".to_string()));
    };
    if !(first.is_ascii_alphabetic() || first == '_')
        || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(AdapterError::InvalidRequest(format!(
            "SurrealDB identifier '{}' must match [a-zA-Z_][a-zA-Z0-9_]*",
            name
        )));
    }
    Ok(trimmed.to_string())
}

fn format_surreal_record_id(table: &str, id: &str) -> String {
    let escaped = id.replace('`', "\\`");
    format!("{}:`{}`", table, escaped)
}

fn strip_table_prefix(table: &str, raw_id: &str) -> String {
    let prefix = format!("{}:", table);
    let body = raw_id.strip_prefix(&prefix).unwrap_or(raw_id);
    if (body.starts_with('`') && body.ends_with('`'))
        || (body.starts_with('⟨') && body.ends_with('⟩'))
    {
        let mut chars = body.chars();
        chars.next();
        chars.next_back();
        return chars.as_str().to_string();
    }
    body.to_string()
}

fn sql_str_lit(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
}

fn condition_to_surql(cond: &FilterCondition) -> Result<Option<String>, AdapterError> {
    let key = cond.field.trim();
    if key.is_empty() {
        return Ok(None);
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
    {
        return Err(AdapterError::InvalidRequest(format!(
            "Unsafe metadata filter key '{}'",
            key
        )));
    }
    let field_expr = format!("payload.{}", key);
    let val_lit = serde_json::to_string(&cond.value).unwrap_or_else(|_| "null".to_string());
    match cond.op.as_str() {
        "eq" => Ok(Some(format!("{} = {}", field_expr, val_lit))),
        "neq" => Ok(Some(format!("{} != {}", field_expr, val_lit))),
        "gt" => Ok(Some(format!("{} > {}", field_expr, val_lit))),
        "gte" => Ok(Some(format!("{} >= {}", field_expr, val_lit))),
        "lt" => Ok(Some(format!("{} < {}", field_expr, val_lit))),
        "lte" => Ok(Some(format!("{} <= {}", field_expr, val_lit))),
        "contains" => {
            let needle = cond
                .value
                .as_str()
                .map(ToString::to_string)
                .unwrap_or_else(|| cond.value.to_string());
            Ok(Some(format!(
                "string::contains(string::lowercase(<string>{}), string::lowercase({}))",
                field_expr,
                sql_str_lit(&needle)
            )))
        }
        "in" => {
            let arr = if cond.value.is_array() {
                cond.value.clone()
            } else if let Some(s) = cond.value.as_str() {
                let items: Vec<String> = s
                    .split(',')
                    .map(str::trim)
                    .filter(|x| !x.is_empty())
                    .map(ToString::to_string)
                    .collect();
                json!(items)
            } else {
                json!([cond.value])
            };
            Ok(Some(format!("{} IN {}", field_expr, arr)))
        }
        _ => Ok(None),
    }
}

fn build_surql_where(spec: Option<&FilterSpec>) -> Result<Option<String>, AdapterError> {
    let Some(filter) = spec else {
        return Ok(None);
    };
    match filter {
        FilterSpec::RawJson { json } => {
            if let Some(s) = json.as_str() {
                let trimmed = s.trim();
                return Ok((!trimmed.is_empty()).then(|| trimmed.to_string()));
            }
            if let Some(obj) = json.as_object() {
                let parts: Vec<String> = obj
                    .iter()
                    .filter(|(k, _)| {
                        k.chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
                    })
                    .map(|(k, v)| format!("payload.{} = {}", k, v))
                    .collect();
                if parts.is_empty() {
                    return Ok(None);
                }
                return Ok(Some(parts.join(" AND ")));
            }
            Ok(None)
        }
        FilterSpec::Visual { logic, conditions } => {
            let mut clauses = Vec::new();
            for c in conditions {
                if let Some(sql) = condition_to_surql(c)? {
                    clauses.push(sql);
                }
            }
            if clauses.is_empty() {
                return Ok(None);
            }
            let joiner = match logic {
                FilterLogic::And => " AND ",
                FilterLogic::Or => " OR ",
            };
            Ok(Some(format!("({})", clauses.join(joiner))))
        }
    }
}

fn distance_to_score(dist: f32, metric: &str) -> f32 {
    match metric.to_ascii_lowercase().as_str() {
        "euclidean" | "l2" => 1.0 / (1.0 + dist.max(0.0)),
        "dot" | "ip" => -dist,
        _ => 1.0 - dist,
    }
}

impl SurrealDbAdapter {
    pub fn from_local(base_url: String, user: &str, pass: &str) -> Result<Self, AdapterError> {
        let mut extra = HashMap::new();
        extra.insert("namespace".to_string(), "embedbay".to_string());
        extra.insert("database".to_string(), "default".to_string());
        let creds = format!("{}:{}", user, pass);
        Self::new(base_url, "basic".to_string(), Some(creds), extra)
    }

    pub fn new(
        base_url: String,
        auth_type: String,
        secret: Option<String>,
        extra: HashMap<String, String>,
    ) -> Result<Self, AdapterError> {
        let trimmed = base_url.trim().trim_end_matches('/').to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "SurrealDB endpoint URL cannot be empty".to_string(),
            ));
        }
        let client = http_client_for_url(&trimmed, 30)?;
        let auth_header = secret
            .filter(|s| !s.trim().is_empty())
            .map(|sec| match auth_type.as_str() {
                "basic" => {
                    if sec.contains(':') {
                        let encoded = base64::engine::general_purpose::STANDARD.encode(sec.as_bytes());
                        format!("Basic {}", encoded)
                    } else {
                        format!("Basic {}", sec)
                    }
                }
                _ => format!("Bearer {}", sec),
            });

        let namespace = extra
            .get("namespace")
            .cloned()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "embedbay".to_string());
        let database = extra
            .get("database")
            .cloned()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "default".to_string());

        Ok(Self {
            base_url: trimmed,
            namespace,
            database,
            auth_header,
            client,
        })
    }

    fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_static("application/json"),
        );
        if let Ok(ns) = HeaderValue::from_str(&self.namespace) {
            h.insert("surreal-ns", ns);
        }
        if let Ok(db) = HeaderValue::from_str(&self.database) {
            h.insert("surreal-db", db);
        }
        if let Some(auth) = &self.auth_header {
            if let Ok(val) = HeaderValue::from_str(auth) {
                h.insert(reqwest::header::AUTHORIZATION, val);
            }
        }
        h
    }

    async fn exec_sql(&self, sql: &str) -> Result<Vec<Value>, AdapterError> {
        let url = format!("{}/sql", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .body(sql.to_string())
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
                "SurrealDB",
                status,
                &text,
            )));
        }
        let parsed: Value = serde_json::from_str(&text)
            .map_err(|_| AdapterError::Api(format_invalid_json_error("SurrealDB", &text)))?;
        let arr = parsed.as_array().ok_or_else(|| {
            AdapterError::Api("Unexpected response array from SurrealDB /sql".to_string())
        })?;

        let mut results = Vec::with_capacity(arr.len());
        for stmt in arr {
            let st_status = stmt.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if st_status != "OK" {
                let detail = stmt
                    .get("result")
                    .and_then(|v| v.as_str())
                    .or_else(|| stmt.get("detail").and_then(|v| v.as_str()))
                    .unwrap_or("SurrealQL query failed");
                return Err(AdapterError::Api(detail.to_string()));
            }
            results.push(stmt.get("result").cloned().unwrap_or(Value::Null));
        }
        Ok(results)
    }

    async fn read_collection_meta(&self, table: &str) -> (Option<usize>, String) {
        let sql = format!(
            "SELECT dimensions, distance_metric FROM _embedbay_collections WHERE name = {};",
            sql_str_lit(table)
        );
        if let Ok(res) = self.exec_sql(&sql).await {
            if let Some(first) = res.first().and_then(|v| v.as_array()).and_then(|a| a.first()) {
                let dims = first
                    .get("dimensions")
                    .and_then(|v| v.as_u64())
                    .map(|d| d as usize);
                let metric = first
                    .get("distance_metric")
                    .and_then(|v| v.as_str())
                    .unwrap_or("cosine")
                    .to_string();
                return (dims, metric);
            }
        }
        (None, "cosine".to_string())
    }
}

#[async_trait]
impl VectorDbAdapter for SurrealDbAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let url = format!("{}/health", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| AdapterError::Http(format_reqwest_error(&e)))?;
        if !resp.status().is_success() {
            let st = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(AdapterError::Api(format_http_status_error(
                "SurrealDB",
                st,
                &text,
            )));
        }
        let latency_ms = start.elapsed().as_millis() as u64;
        let ver = self
            .client
            .get(format!("{}/version", self.base_url))
            .send()
            .await
            .ok()
            .and_then(|r| if r.status().is_success() { Some(r) } else { None });
        let ver_str = match ver {
            Some(r) => r
                .text()
                .await
                .ok()
                .map(|s| s.trim().trim_start_matches("surrealdb-").to_string())
                .filter(|s| !s.is_empty()),
            None => None,
        };
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms,
            engine_version: ver_str.clone(),
            message: format!(
                "Connected to SurrealDB{}",
                ver_str.map(|v| format!(" v{}", v)).unwrap_or_default()
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let meta_res = self
            .exec_sql("SELECT name, dimensions, distance_metric FROM _embedbay_collections;")
            .await
            .unwrap_or_default();

        let mut meta_map: BTreeMap<String, (Option<usize>, Option<String>)> = BTreeMap::new();
        if let Some(rows) = meta_res.first().and_then(|v| v.as_array()) {
            for row in rows {
                if let Some(name) = row.get("name").and_then(|v| v.as_str()) {
                    let dims = row
                        .get("dimensions")
                        .and_then(|v| v.as_u64())
                        .map(|d| d as usize);
                    let metric = row
                        .get("distance_metric")
                        .and_then(|v| v.as_str())
                        .map(ToString::to_string);
                    meta_map.insert(name.to_string(), (dims, metric));
                }
            }
        }

        if let Ok(info_res) = self.exec_sql("INFO FOR DB;").await {
            if let Some(tables) = info_res
                .first()
                .and_then(|v| v.get("tables"))
                .and_then(|v| v.as_object())
            {
                for name in tables.keys() {
                    if !name.starts_with('_') {
                        meta_map.entry(name.clone()).or_insert((None, None));
                    }
                }
            }
        }

        let mut out = Vec::with_capacity(meta_map.len());
        for (name, (dims, metric)) in meta_map {
            let count = self
                .exec_sql(&format!("SELECT count() FROM `{}` GROUP ALL;", name))
                .await
                .ok()
                .and_then(|r| {
                    r.first()
                        .and_then(|v| v.as_array())
                        .and_then(|a| a.first())
                        .and_then(|row| row.get("count"))
                        .and_then(|c| c.as_u64())
                });
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
        let table = sanitize_surreal_ident(collection)?;
        let (dims, metric) = self.read_collection_meta(&table).await;
        let count = self
            .exec_sql(&format!("SELECT count() FROM `{}` GROUP ALL;", table))
            .await
            .ok()
            .and_then(|r| {
                r.first()
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|row| row.get("count"))
                    .and_then(|c| c.as_u64())
            })
            .unwrap_or(0);

        let mut fields = BTreeMap::new();
        if let Ok(sample) = self
            .exec_sql(&format!("SELECT payload FROM `{}` LIMIT 20;", table))
            .await
        {
            if let Some(rows) = sample.first().and_then(|v| v.as_array()) {
                for row in rows {
                    if let Some(obj) = row.get("payload").and_then(|p| p.as_object()) {
                        for (k, v) in obj {
                            let ty = if v.is_number() {
                                "number"
                            } else if v.is_boolean() {
                                "boolean"
                            } else if v.is_string() {
                                "string"
                            } else {
                                "json"
                            };
                            fields.entry(k.clone()).or_insert_with(|| ty.to_string());
                        }
                    }
                }
            }
        }

        Ok(CollectionSchema {
            name: table,
            vector_count: count,
            dimensions: dims,
            distance_metric: Some(metric),
            index_type: Some("HNSW (SurrealKV)".to_string()),
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
        let table = sanitize_surreal_ident(&req.name)?;
        let dims = req.dimensions.max(1);
        let dist = match req.distance_metric.as_str() {
            "euclidean" => "EUCLIDEAN",
            "dot" => "DOT",
            _ => "COSINE",
        };
        let sql = format!(
            concat!(
                "DEFINE TABLE IF NOT EXISTS _embedbay_collections SCHEMALESS;\n",
                "DEFINE TABLE `{table}` SCHEMALESS;\n",
                "DEFINE INDEX idx_vec_{table} ON TABLE `{table}` FIELDS vector HNSW DIMENSION {dims} DIST {dist} TYPE F32;\n",
                "UPSERT _embedbay_collections:`{table}` CONTENT {{ name: {name_lit}, dimensions: {dims}, distance_metric: {metric_lit} }};"
            ),
            table = table,
            dims = dims,
            dist = dist,
            name_lit = sql_str_lit(&table),
            metric_lit = sql_str_lit(&req.distance_metric),
        );
        self.exec_sql(&sql).await?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let table = sanitize_surreal_ident(collection)?;
        let sql = format!(
            "REMOVE TABLE IF EXISTS `{table}`; DELETE _embedbay_collections:`{table}`;",
            table = table
        );
        self.exec_sql(&sql).await?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let table = sanitize_surreal_ident(collection)?;
        let cols = if req.include_vectors {
            "id, payload, document, vector"
        } else {
            "id, payload, document"
        };
        let where_clause = build_surql_where(req.filter.as_ref())?
            .map(|w| format!(" WHERE {}", w))
            .unwrap_or_default();
        let sql = format!(
            "SELECT {cols} FROM `{table}`{where_clause} LIMIT {limit} START {offset}; SELECT count() FROM `{table}`{where_clause} GROUP ALL;",
            cols = cols,
            table = table,
            where_clause = where_clause,
            limit = req.limit.clamp(1, 1000),
            offset = req.offset,
        );
        let res = self.exec_sql(&sql).await?;
        let rows = res
            .first()
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let total = res.get(1).and_then(|v| {
            v.as_array()
                .and_then(|a| a.first())
                .and_then(|r| r.get("count"))
                .and_then(|c| c.as_u64())
        });

        let records = rows
            .into_iter()
            .map(|r| parse_surreal_row(&table, &r, req.include_vectors, None))
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
        let table = sanitize_surreal_ident(collection)?;
        let mut stmts = String::new();
        for rec in &records {
            let rid = format_surreal_record_id(&table, &rec.id);
            let content = json!({
                "payload": rec.payload,
                "document": rec.document,
                "vector": rec.vector,
            });
            stmts.push_str(&format!("UPSERT {} CONTENT {};\n", rid, content));
        }
        self.exec_sql(&stmts).await?;
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
        let table = sanitize_surreal_ident(collection)?;
        let mut stmts = String::new();
        for id in &ids {
            stmts.push_str(&format!(
                "DELETE {};\n",
                format_surreal_record_id(&table, id)
            ));
        }
        self.exec_sql(&stmts).await?;
        Ok(ids.len())
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let table = sanitize_surreal_ident(collection)?;
        let (_, metric) = self.read_collection_meta(&table).await;
        let top_k = req.top_k.clamp(1, 500);
        let cols = if req.include_vectors {
            "id, payload, document, vector, vector::distance::knn() AS __dist"
        } else {
            "id, payload, document, vector::distance::knn() AS __dist"
        };
        let extra_where = build_surql_where(req.filter.as_ref())?
            .map(|w| format!(" AND ({})", w))
            .unwrap_or_default();
        let vec_json = serde_json::to_string(&req.vector).unwrap_or_else(|_| "[]".to_string());

        let sql = format!(
            "SELECT {cols} FROM `{table}` WHERE vector <|{k},40|> {vec_json}{extra_where} ORDER BY __dist ASC;",
            cols = cols,
            table = table,
            k = top_k,
            vec_json = vec_json,
            extra_where = extra_where,
        );
        let res = self.exec_sql(&sql).await?;
        let latency_ms = start.elapsed().as_millis() as u64;
        let rows = res
            .first()
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut records = Vec::new();
        for row in rows {
            let score = row
                .get("__dist")
                .and_then(|v| v.as_f64())
                .map(|d| distance_to_score(d as f32, &metric));
            if let (Some(thresh), Some(sc)) = (req.score_threshold, score) {
                if sc < thresh {
                    continue;
                }
            }
            records.push(parse_surreal_row(&table, &row, req.include_vectors, score));
        }

        Ok(SearchResponse {
            records,
            latency_ms,
        })
    }
}

fn parse_surreal_row(
    table: &str,
    row: &Value,
    include_vectors: bool,
    score: Option<f32>,
) -> VectorRecord {
    let raw_id = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let id = strip_table_prefix(table, raw_id);
    let payload = row.get("payload").cloned().unwrap_or_else(|| json!({}));
    let document = row
        .get("document")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    let vector = if include_vectors {
        row.get("vector").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_f64().map(|f| f as f32))
                    .collect()
            })
        })
    } else {
        None
    };

    VectorRecord {
        id,
        payload,
        document,
        vector,
        score,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn surrealdb_adapter_roundtrip_mock() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();

        let server = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = [0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let first = req.lines().next().unwrap_or("");
                let body_part = req.split("\r\n\r\n").nth(1).unwrap_or("");

                let (ctype, text) = if first.starts_with("GET /health ") {
                    ("text/plain", "OK".to_string())
                } else if first.starts_with("GET /version ") {
                    ("text/plain", "surrealdb-4.0.1".to_string())
                } else if body_part.contains("INFO FOR DB") {
                    (
                        "application/json",
                        json!([{ "status": "OK", "result": { "tables": { "docs": "DEFINE TABLE docs" } } }]).to_string(),
                    )
                } else if body_part.contains("SELECT name, dimensions") {
                    (
                        "application/json",
                        json!([{ "status": "OK", "result": [{ "name": "docs", "dimensions": 3, "distance_metric": "cosine" }] }]).to_string(),
                    )
                } else if body_part.contains("SELECT dimensions, distance_metric") {
                    (
                        "application/json",
                        json!([{ "status": "OK", "result": [{ "dimensions": 3, "distance_metric": "cosine" }] }]).to_string(),
                    )
                } else if body_part.contains("vector::distance::knn()") {
                    (
                        "application/json",
                        json!([{ "status": "OK", "result": [{ "id": "docs:s1", "payload": { "topic": "graph" }, "document": "Surreal doc", "__dist": 0.05 }] }]).to_string(),
                    )
                } else if body_part.contains("SELECT id, payload, document") {
                    (
                        "application/json",
                        json!([
                            { "status": "OK", "result": [{ "id": "docs:s1", "payload": { "topic": "graph" }, "document": "Surreal doc", "vector": [1.0, 0.0, 0.0] }] },
                            { "status": "OK", "result": [{ "count": 1 }] }
                        ]).to_string(),
                    )
                } else if body_part.contains("SELECT count()") {
                    (
                        "application/json",
                        json!([{ "status": "OK", "result": [{ "count": 1 }] }]).to_string(),
                    )
                } else {
                    (
                        "application/json",
                        json!([{ "status": "OK", "result": [] }]).to_string(),
                    )
                };

                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    ctype,
                    text.len(),
                    text
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });

        let adapter = SurrealDbAdapter::from_local(
            format!("http://127.0.0.1:{}", port),
            "root",
            "root",
        )
        .expect("surreal");

        let conn = adapter.test_connection().await.expect("test");
        assert!(conn.ok);
        assert_eq!(conn.engine_version.as_deref(), Some("4.0.1"));

        let cols = adapter.list_collections().await.expect("list");
        assert_eq!(cols[0].name, "docs");
        assert_eq!(cols[0].vector_count, Some(1));

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
        assert_eq!(browsed.records[0].id, "s1");

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
        assert_eq!(searched.records[0].id, "s1");
        assert!((searched.records[0].score.unwrap_or(0.0) - 0.95).abs() < 0.001);
        server.abort();
    }
}
