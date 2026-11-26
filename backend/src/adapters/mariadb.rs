use std::collections::BTreeMap;
use std::time::Instant;

use async_trait::async_trait;
use mysql_async::prelude::Queryable;
use mysql_async::{Conn, Opts, OptsBuilder, Params, SslOpts, Value as MyValue};
use serde_json::{json, Value};

use crate::adapters::{
    format_connection_error, AdapterError, BrowseRecordsRequest, BrowseRecordsResponse,
    CollectionSchema, CollectionSummary, ConnectionTestResult, CreateCollectionRequest,
    FilterCondition, FilterLogic, FilterSpec, PayloadFieldSchema, SearchRequest, SearchResponse,
    VectorDbAdapter, VectorRecord,
};

pub struct MariaDbAdapter {
    opts: Opts,
}

pub fn sanitize_mariadb_identifier(name: &str) -> Result<String, AdapterError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(AdapterError::InvalidRequest(format!(
            "Invalid MariaDB identifier '{}'",
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
            "MariaDB identifier '{}' must match [a-zA-Z_][a-zA-Z0-9_]*",
            name
        )));
    }
    Ok(trimmed.to_string())
}

pub fn format_vector_text(vec: &[f32]) -> String {
    let mut s = String::with_capacity(vec.len() * 10 + 2);
    s.push('[');
    for (i, v) in vec.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        if v.is_finite() {
            s.push_str(&v.to_string());
        } else {
            s.push('0');
        }
    }
    s.push(']');
    s
}

pub fn parse_vector_text(raw: &str) -> Vec<f32> {
    raw.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .filter_map(|p| p.trim().parse::<f32>().ok())
        .collect()
}

pub fn parse_vector_column_dims(column_type: &str) -> Option<usize> {
    let lower = column_type.trim().to_ascii_lowercase();
    let inner = lower.strip_prefix("vector(")?.strip_suffix(')')?;
    inner.trim().parse::<usize>().ok()
}

pub fn build_mariadb_where_clause(
    spec: Option<&FilterSpec>,
    params: &mut Vec<MyValue>,
) -> Result<String, AdapterError> {
    let Some(filter) = spec else {
        return Ok(String::new());
    };
    match filter {
        FilterSpec::RawJson { json } => {
            if let Some(obj) = json.as_object() {
                if obj.is_empty() {
                    return Ok(String::new());
                }
                let mut clauses = Vec::new();
                for (k, v) in obj {
                    validate_json_key(k)?;
                    let val_str = match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    params.push(MyValue::from(val_str));
                    clauses.push(format!(
                        "JSON_UNQUOTE(JSON_EXTRACT(payload, '$.{}')) = ?",
                        k
                    ));
                }
                return Ok(format!("WHERE ({})", clauses.join(" AND ")));
            }
            Ok(String::new())
        }
        FilterSpec::Visual { logic, conditions } => {
            if conditions.is_empty() {
                return Ok(String::new());
            }
            let mut clauses = Vec::new();
            for cond in conditions {
                if let Some(c) = condition_to_mariadb_sql(cond, params)? {
                    clauses.push(c);
                }
            }
            if clauses.is_empty() {
                return Ok(String::new());
            }
            let joiner = match logic {
                FilterLogic::And => " AND ",
                FilterLogic::Or => " OR ",
            };
            Ok(format!("WHERE ({})", clauses.join(joiner)))
        }
    }
}

fn validate_json_key(key: &str) -> Result<(), AdapterError> {
    if key.is_empty()
        || !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(AdapterError::InvalidRequest(format!(
            "Unsafe metadata filter key '{}'",
            key
        )));
    }
    Ok(())
}

fn condition_to_mariadb_sql(
    cond: &FilterCondition,
    params: &mut Vec<MyValue>,
) -> Result<Option<String>, AdapterError> {
    let key = cond.field.trim();
    if key.is_empty() {
        return Ok(None);
    }
    validate_json_key(key)?;
    let extract = format!("JSON_UNQUOTE(JSON_EXTRACT(payload, '$.{}'))", key);
    let val_str = match &cond.value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    match cond.op.as_str() {
        "eq" => {
            params.push(MyValue::from(val_str));
            Ok(Some(format!("{} = ?", extract)))
        }
        "neq" => {
            params.push(MyValue::from(val_str));
            Ok(Some(format!("COALESCE({}, '') <> ?", extract)))
        }
        "contains" => {
            params.push(MyValue::from(format!("%{}%", val_str)));
            Ok(Some(format!("LOWER({}) LIKE LOWER(?)", extract)))
        }
        "in" => {
            let items: Vec<String> = if let Some(arr) = cond.value.as_array() {
                arr.iter()
                    .map(|v| {
                        v.as_str()
                            .map(ToString::to_string)
                            .unwrap_or_else(|| v.to_string())
                    })
                    .collect()
            } else {
                val_str
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(ToString::to_string)
                    .collect()
            };
            if items.is_empty() {
                return Ok(None);
            }
            let placeholders = vec!["?"; items.len()].join(", ");
            for item in items {
                params.push(MyValue::from(item));
            }
            Ok(Some(format!("{} IN ({})", extract, placeholders)))
        }
        "gt" | "gte" | "lt" | "lte" => {
            let op_sym = match cond.op.as_str() {
                "gt" => ">",
                "gte" => ">=",
                "lt" => "<",
                "lte" => "<=",
                _ => "=",
            };
            let num: f64 = cond.value.as_f64().ok_or_else(|| {
                AdapterError::InvalidRequest(format!(
                    "Numeric range filter '{}' requires a number",
                    cond.op
                ))
            })?;
            params.push(MyValue::from(num));
            Ok(Some(format!("CAST({} AS DOUBLE) {} ?", extract, op_sym)))
        }
        _ => Ok(None),
    }
}

fn distance_to_score(dist: f32, metric: &str) -> f32 {
    match metric.to_ascii_lowercase().as_str() {
        "euclidean" | "l2" => 1.0 / (1.0 + dist.max(0.0)),
        _ => 1.0 - dist,
    }
}

impl MariaDbAdapter {
    pub fn from_local(host: &str, port: u16) -> Result<Self, AdapterError> {
        let url = format!("mysql://root@{}:{}/embedbay", host, port);
        let opts = Opts::from_url(&url)
            .map_err(|e| AdapterError::InvalidRequest(format!("Invalid MariaDB URL: {}", e)))?;
        Ok(Self { opts })
    }

    pub fn from_remote(endpoint_url: &str, secret: Option<&str>) -> Result<Self, AdapterError> {
        let mut trimmed = endpoint_url.trim().to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "MariaDB connection URI cannot be empty".to_string(),
            ));
        }
        if let Some(rest) = trimmed.strip_prefix("mariadb://") {
            trimmed = format!("mysql://{}", rest);
        } else if !trimmed.starts_with("mysql://") {
            trimmed = format!("mysql://{}", trimmed);
        }

        if let Some(pwd) = secret.filter(|s| !s.trim().is_empty()) {
            if let Some((scheme, rest)) = trimmed.split_once("://") {
                if !rest.contains('@') {
                    trimmed = format!("{}://root:{}@{}", scheme, pwd, rest);
                } else if let Some((auth, host_part)) = rest.split_once('@') {
                    if !auth.contains(':') {
                        trimmed = format!("{}://{}:{}@{}", scheme, auth, pwd, host_part);
                    }
                }
            }
        }

        let lower = trimmed.to_ascii_lowercase();
        let is_loopback = lower.contains("127.0.0.1") || lower.contains("localhost");
        let use_tls = lower.contains("sslmode=require")
            || lower.contains("ssl-mode=required")
            || (!is_loopback && !lower.contains("sslmode=disable"));

        let base_opts = Opts::from_url(&trimmed)
            .map_err(|e| AdapterError::InvalidRequest(format!("Invalid MariaDB URI: {}", e)))?;
        let mut builder = OptsBuilder::from_opts(base_opts);
        if use_tls {
            builder = builder.ssl_opts(SslOpts::default());
        }
        Ok(Self {
            opts: Opts::from(builder),
        })
    }

    async fn connect(&self) -> Result<Conn, AdapterError> {
        tokio::time::timeout(
            std::time::Duration::from_secs(8),
            Conn::new(self.opts.clone()),
        )
        .await
        .map_err(|_| {
            AdapterError::Http("Connection timed out. Check the host, VPN, or firewall.".to_string())
        })?
        .map_err(|e| AdapterError::Http(format_connection_error("MariaDB", &e.to_string())))
    }

    async fn detect_vector_col(
        &self,
        conn: &mut Conn,
        table: &str,
    ) -> Result<(String, Option<usize>, String), AdapterError> {
        let rows: Vec<(String, String)> = conn
            .exec(
                "SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                 AND (DATA_TYPE = 'vector' OR LOWER(COLUMN_TYPE) LIKE 'vector(%')",
                (table,),
            )
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let (col_name, col_type) = rows.into_iter().next().ok_or_else(|| {
            AdapterError::NotFound(format!("Vector table '{}' not found", table))
        })?;
        let dims = parse_vector_column_dims(&col_type);

        let idx_rows: Vec<(Option<String>,)> = conn
            .exec(
                "SELECT INDEX_TYPE FROM INFORMATION_SCHEMA.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
                 LIMIT 1",
                (table, &col_name),
            )
            .await
            .unwrap_or_default();
        let _ = idx_rows;

        Ok((col_name, dims, "cosine".to_string()))
    }
}

#[async_trait]
impl VectorDbAdapter for MariaDbAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let mut conn = self.connect().await?;
        let ver: Option<String> = conn
            .query_first("SELECT VERSION()")
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        let _ = conn.disconnect().await;
        let latency_ms = start.elapsed().as_millis() as u64;
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms,
            engine_version: ver.clone(),
            message: format!(
                "Connected to MariaDB{}",
                ver.map(|v| format!(" v{}", v)).unwrap_or_default()
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let mut conn = self.connect().await?;
        let rows: Vec<(String, String)> = conn
            .query(
                "SELECT TABLE_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                 AND (DATA_TYPE = 'vector' OR LOWER(COLUMN_TYPE) LIKE 'vector(%')
                 ORDER BY TABLE_NAME",
            )
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let mut out = Vec::with_capacity(rows.len());
        for (table, col_type) in rows {
            let count: Option<u64> = conn
                .query_first(format!("SELECT COUNT(*) FROM `{}`", table))
                .await
                .unwrap_or(None);
            out.push(CollectionSummary {
                name: table,
                vector_count: count,
                dimensions: parse_vector_column_dims(&col_type),
                distance_metric: Some("cosine".to_string()),
            });
        }
        let _ = conn.disconnect().await;
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let table = sanitize_mariadb_identifier(collection)?;
        let mut conn = self.connect().await?;
        let (vec_col, dims, metric) = self.detect_vector_col(&mut conn, &table).await?;
        let count: u64 = conn
            .query_first(format!("SELECT COUNT(*) FROM `{}`", table))
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?
            .unwrap_or(0);

        let sample_rows: Vec<(Option<String>,)> = conn
            .query(format!(
                "SELECT CAST(payload AS CHAR) FROM `{}` LIMIT 20",
                table
            ))
            .await
            .unwrap_or_default();
        let _ = conn.disconnect().await;

        let mut fields = BTreeMap::new();
        for (raw_opt,) in sample_rows {
            if let Some(raw) = raw_opt {
                if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&raw) {
                    for (k, v) in obj {
                        let dt = if v.is_number() {
                            "number"
                        } else if v.is_boolean() {
                            "boolean"
                        } else if v.is_string() {
                            "string"
                        } else {
                            "json"
                        };
                        fields.entry(k).or_insert_with(|| dt.to_string());
                    }
                }
            }
        }

        Ok(CollectionSchema {
            name: table,
            vector_count: count,
            dimensions: dims,
            distance_metric: Some(metric),
            index_type: Some("HNSW (MariaDB VECTOR INDEX)".to_string()),
            segment_count: None,
            disk_bytes: None,
            vector_field_name: Some(vec_col),
            payload_fields: fields
                .into_iter()
                .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
                .collect(),
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let table = sanitize_mariadb_identifier(&req.name)?;
        let dims = req.dimensions.max(1);
        let dist = match req.distance_metric.as_str() {
            "euclidean" | "l2" => "euclidean",
            _ => "cosine",
        };
        let mut conn = self.connect().await?;
        let sql = format!(
            "CREATE TABLE `{table}` (
                id VARCHAR(255) PRIMARY KEY,
                document LONGTEXT NULL,
                payload JSON NOT NULL,
                embedding VECTOR({dims}) NOT NULL,
                VECTOR INDEX (embedding) M=16 DISTANCE={dist}
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
            table = table,
            dims = dims,
            dist = dist
        );
        conn.query_drop(sql)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        let _ = conn.disconnect().await;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let table = sanitize_mariadb_identifier(collection)?;
        let mut conn = self.connect().await?;
        conn.query_drop(format!("DROP TABLE IF EXISTS `{}`", table))
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        let _ = conn.disconnect().await;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let table = sanitize_mariadb_identifier(collection)?;
        let mut conn = self.connect().await?;
        let (vec_col, _, _) = self.detect_vector_col(&mut conn, &table).await?;

        let mut params = Vec::new();
        let where_clause = build_mariadb_where_clause(req.filter.as_ref(), &mut params)?;
        let total: Option<u64> = conn
            .exec_first(
                format!("SELECT COUNT(*) FROM `{}` {}", table, where_clause),
                Params::Positional(params.clone()),
            )
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let vec_select = if req.include_vectors {
            format!("VEC_ToText(`{}`)", vec_col)
        } else {
            "NULL".to_string()
        };
        params.push(MyValue::from(req.limit.clamp(1, 1000) as u64));
        params.push(MyValue::from(req.offset as u64));

        let sql = format!(
            "SELECT id, document, CAST(payload AS CHAR), {} FROM `{}` {} ORDER BY id ASC LIMIT ? OFFSET ?",
            vec_select, table, where_clause
        );
        let rows: Vec<(String, Option<String>, Option<String>, Option<String>)> = conn
            .exec(sql, Params::Positional(params))
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        let _ = conn.disconnect().await;

        let records = rows
            .into_iter()
            .map(|(id, document, payload_raw, vec_raw)| {
                let payload = payload_raw
                    .as_deref()
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .unwrap_or_else(|| json!({}));
                let vector = if req.include_vectors {
                    vec_raw.as_deref().map(parse_vector_text)
                } else {
                    None
                };
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
        if records.is_empty() {
            return Ok(0);
        }
        let table = sanitize_mariadb_identifier(collection)?;
        let mut conn = self.connect().await?;
        let (vec_col, dims, _) = self.detect_vector_col(&mut conn, &table).await?;
        let fallback_dims = dims.unwrap_or(3);

        let sql = format!(
            "INSERT INTO `{table}` (id, document, payload, `{vec_col}`)
             VALUES (?, ?, ?, VEC_FromText(?))
             ON DUPLICATE KEY UPDATE
               document = VALUES(document),
               payload = VALUES(payload),
               `{vec_col}` = VALUES(`{vec_col}`)",
            table = table,
            vec_col = vec_col
        );

        let mut count = 0usize;
        for rec in &records {
            let payload_str =
                serde_json::to_string(&rec.payload).unwrap_or_else(|_| "{}".to_string());
            let vec_str = match &rec.vector {
                Some(v) => format_vector_text(v),
                None => format_vector_text(&vec![0.0; fallback_dims]),
            };
            conn.exec_drop(
                &sql,
                (rec.id.clone(), rec.document.clone(), payload_str, vec_str),
            )
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
            count += 1;
        }
        let _ = conn.disconnect().await;
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
        let table = sanitize_mariadb_identifier(collection)?;
        let mut conn = self.connect().await?;
        let placeholders = vec!["?"; ids.len()].join(", ");
        let params: Vec<MyValue> = ids.iter().map(|id| MyValue::from(id.clone())).collect();
        conn.exec_drop(
            format!("DELETE FROM `{}` WHERE id IN ({})", table, placeholders),
            Params::Positional(params),
        )
        .await
        .map_err(|e| AdapterError::Api(e.to_string()))?;
        let affected = conn.affected_rows() as usize;
        let _ = conn.disconnect().await;
        Ok(affected)
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let table = sanitize_mariadb_identifier(collection)?;
        let mut conn = self.connect().await?;
        let (vec_col, _, metric) = self.detect_vector_col(&mut conn, &table).await?;

        let dist_fn = match metric.as_str() {
            "euclidean" | "l2" => "VEC_DISTANCE_EUCLIDEAN",
            _ => "VEC_DISTANCE_COSINE",
        };
        let vec_lit = format_vector_text(&req.vector);
        let mut params = vec![MyValue::from(vec_lit)];
        let where_clause = build_mariadb_where_clause(req.filter.as_ref(), &mut params)?;
        params.push(MyValue::from(req.top_k.clamp(1, 500) as u64));

        let vec_select = if req.include_vectors {
            format!("VEC_ToText(`{}`)", vec_col)
        } else {
            "NULL".to_string()
        };
        let sql = format!(
            "SELECT id, document, CAST(payload AS CHAR), {vec_select},
                    {dist_fn}(`{vec_col}`, VEC_FromText(?)) AS __dist
             FROM `{table}`
             {where_clause}
             ORDER BY __dist ASC
             LIMIT ?",
            vec_select = vec_select,
            dist_fn = dist_fn,
            vec_col = vec_col,
            table = table,
            where_clause = where_clause
        );

        let rows: Vec<(String, Option<String>, Option<String>, Option<String>, f64)> = conn
            .exec(sql, Params::Positional(params))
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        let _ = conn.disconnect().await;
        let latency_ms = start.elapsed().as_millis() as u64;

        let mut records = Vec::new();
        for (id, document, payload_raw, vec_raw, dist) in rows {
            let score = distance_to_score(dist as f32, &metric);
            if let Some(thresh) = req.score_threshold {
                if score < thresh {
                    continue;
                }
            }
            let payload = payload_raw
                .as_deref()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .unwrap_or_else(|| json!({}));
            let vector = if req.include_vectors {
                vec_raw.as_deref().map(parse_vector_text)
            } else {
                None
            };
            records.push(VectorRecord {
                id,
                payload,
                document,
                vector,
                score: Some(score),
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

    #[test]
    fn sanitizes_mariadb_identifiers_and_parses_vector_dims() {
        assert_eq!(
            sanitize_mariadb_identifier("docs_v1").expect("valid"),
            "docs_v1"
        );
        assert!(sanitize_mariadb_identifier("bad; DROP TABLE").is_err());
        assert_eq!(parse_vector_column_dims("vector(1536)"), Some(1536));
        assert_eq!(parse_vector_column_dims("VECTOR(384)"), Some(384));
        assert_eq!(parse_vector_column_dims("varchar(255)"), None);
    }

    #[test]
    fn builds_mariadb_filter_sql_with_positional_params() {
        let mut params = Vec::new();
        let spec = FilterSpec::Visual {
            logic: FilterLogic::And,
            conditions: vec![
                FilterCondition {
                    field: "topic".to_string(),
                    op: "eq".to_string(),
                    value: json!("rust"),
                },
                FilterCondition {
                    field: "year".to_string(),
                    op: "gte".to_string(),
                    value: json!(2025),
                },
            ],
        };
        let clause = build_mariadb_where_clause(Some(&spec), &mut params).expect("where");
        assert!(clause.contains("JSON_UNQUOTE(JSON_EXTRACT(payload, '$.topic')) = ?"));
        assert!(clause.contains("CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.year')) AS DOUBLE) >= ?"));
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn roundtrips_vector_text_and_scores() {
        let txt = format_vector_text(&[0.25, -0.5, 1.0]);
        assert_eq!(txt, "[0.25,-0.5,1]");
        assert_eq!(parse_vector_text(&txt), vec![0.25, -0.5, 1.0]);
        assert!((distance_to_score(0.1, "cosine") - 0.9).abs() < 0.001);
        assert!((distance_to_score(1.0, "euclidean") - 0.5).abs() < 0.001);
    }
}
