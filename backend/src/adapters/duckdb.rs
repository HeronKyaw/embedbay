use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Instant;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use crate::adapters::{
    AdapterError, BrowseRecordsRequest, BrowseRecordsResponse, CollectionSchema,
    CollectionSummary, ConnectionTestResult, CreateCollectionRequest, FilterCondition,
    FilterLogic, FilterSpec, PayloadFieldSchema, SearchRequest, SearchResponse, VectorDbAdapter,
    VectorRecord,
};
use crate::platform;

pub struct DuckDbAdapter {
    db_path: PathBuf,
    cli_binary: PathBuf,
}

pub fn sanitize_duckdb_ident(name: &str) -> Result<String, AdapterError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(AdapterError::InvalidRequest(format!(
            "Invalid DuckDB table name '{}'",
            name
        )));
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return Err(AdapterError::InvalidRequest("Empty table name".to_string()));
    };
    if !(first.is_ascii_alphabetic() || first == '_')
        || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(AdapterError::InvalidRequest(format!(
            "DuckDB identifier '{}' must match [a-zA-Z_][a-zA-Z0-9_]*",
            name
        )));
    }
    Ok(trimmed.to_string())
}

pub fn sql_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', "''"))
}

pub fn format_duckdb_float_array(vec: &[f32], dims: usize) -> String {
    let mut parts = Vec::with_capacity(vec.len());
    for v in vec {
        if v.is_finite() {
            parts.push(v.to_string());
        } else {
            parts.push("0.0".to_string());
        }
    }
    format!("[{}]::FLOAT[{}]", parts.join(","), dims.max(vec.len()).max(1))
}

pub fn build_duckdb_where_clause(spec: Option<&FilterSpec>) -> Result<String, AdapterError> {
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
                    clauses.push(format!(
                        "json_extract_string(payload, '$.{}') = {}",
                        k,
                        sql_quote(&val_str)
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
                if let Some(c) = condition_to_duckdb_sql(cond)? {
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

fn condition_to_duckdb_sql(cond: &FilterCondition) -> Result<Option<String>, AdapterError> {
    let key = cond.field.trim();
    if key.is_empty() {
        return Ok(None);
    }
    validate_json_key(key)?;
    let extract = format!("json_extract_string(payload, '$.{}')", key);
    let val_str = match &cond.value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    match cond.op.as_str() {
        "eq" => Ok(Some(format!("{} = {}", extract, sql_quote(&val_str)))),
        "neq" => Ok(Some(format!(
            "COALESCE({}, '') <> {}",
            extract,
            sql_quote(&val_str)
        ))),
        "contains" => Ok(Some(format!(
            "LOWER({}) LIKE LOWER({})",
            extract,
            sql_quote(&format!("%{}%", val_str))
        ))),
        "in" => {
            let items: Vec<String> = if let Some(arr) = cond.value.as_array() {
                arr.iter()
                    .map(|v| {
                        sql_quote(
                            &v.as_str()
                                .map(ToString::to_string)
                                .unwrap_or_else(|| v.to_string()),
                        )
                    })
                    .collect()
            } else {
                val_str
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(sql_quote)
                    .collect()
            };
            if items.is_empty() {
                Ok(None)
            } else {
                Ok(Some(format!("{} IN ({})", extract, items.join(", "))))
            }
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
            Ok(Some(format!("TRY_CAST({} AS DOUBLE) {} {}", extract, op_sym, num)))
        }
        _ => Ok(None),
    }
}

fn parse_duckdb_row(row: &Value, include_vectors: bool, score: Option<f32>) -> VectorRecord {
    let id = row
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let document = row
        .get("document")
        .and_then(|v| v.as_str())
        .map(ToString::to_string);
    let payload = match row.get("payload") {
        Some(Value::String(s)) => serde_json::from_str::<Value>(s).unwrap_or_else(|_| json!({})),
        Some(v) if v.is_object() => v.clone(),
        _ => json!({}),
    };
    let vector = if include_vectors {
        row.get("embedding").and_then(|v| {
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

impl DuckDbAdapter {
    pub fn new(root_dir: PathBuf, cli_binary: PathBuf) -> Result<Self, AdapterError> {
        let is_file_target = root_dir
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("duckdb") || e.eq_ignore_ascii_case("db"));
        let db_path = if is_file_target {
            if let Some(parent) = root_dir.parent() {
                fs::create_dir_all(parent).map_err(|e| AdapterError::Api(e.to_string()))?;
            }
            root_dir
        } else {
            fs::create_dir_all(&root_dir).map_err(|e| AdapterError::Api(e.to_string()))?;
            root_dir.join("vectors.duckdb")
        };
        Ok(Self {
            db_path,
            cli_binary,
        })
    }

    async fn run_sql_json(&self, sql: &str) -> Result<Vec<Value>, AdapterError> {
        let mut cmd = tokio::process::Command::new(&self.cli_binary);
        cmd.arg("-json")
            .arg(&self.db_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        platform::configure_tokio_command(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| {
            AdapterError::Api(format!(
                "Failed to spawn DuckDB CLI at {}: {}",
                self.cli_binary.display(),
                e
            ))
        })?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(sql.as_bytes())
                .await
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            let _ = stdin.shutdown().await;
        }

        let output = child
            .wait_with_output()
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        if !output.status.success() {
            let err_txt = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AdapterError::Api(if err_txt.is_empty() {
                format!("DuckDB exited with {}", output.status)
            } else {
                err_txt
            }));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let trimmed = stdout.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        serde_json::from_str::<Vec<Value>>(trimmed).map_err(|e| {
            AdapterError::Api(format!("Failed to parse DuckDB JSON output: {}", e))
        })
    }

    async fn ensure_meta_table(&self) -> Result<(), AdapterError> {
        self.run_sql_json(
            "CREATE TABLE IF NOT EXISTS _embedbay_collections (
                name VARCHAR PRIMARY KEY,
                dimensions INTEGER NOT NULL,
                distance_metric VARCHAR NOT NULL
            );",
        )
        .await?;
        Ok(())
    }

    async fn read_collection_meta(&self, table: &str) -> Result<(usize, String), AdapterError> {
        self.ensure_meta_table().await?;
        let rows = self
            .run_sql_json(&format!(
                "SELECT dimensions, distance_metric FROM _embedbay_collections WHERE name = {};",
                sql_quote(table)
            ))
            .await?;
        let first = rows.first().ok_or_else(|| {
            AdapterError::NotFound(format!("Collection '{}' not found", table))
        })?;
        let dims = first
            .get("dimensions")
            .and_then(|v| v.as_u64())
            .unwrap_or(1)
            .max(1) as usize;
        let metric = first
            .get("distance_metric")
            .and_then(|v| v.as_str())
            .unwrap_or("cosine")
            .to_string();
        Ok((dims, metric))
    }
}

#[async_trait]
impl VectorDbAdapter for DuckDbAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let rows = self
            .run_sql_json("SELECT version() AS ver;")
            .await?;
        let latency_ms = start.elapsed().as_millis() as u64;
        let ver = rows
            .first()
            .and_then(|r| r.get("ver"))
            .and_then(|v| v.as_str())
            .map(ToString::to_string);
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms,
            engine_version: ver.clone(),
            message: format!(
                "DuckDB{} embedded database ready ({})",
                ver.map(|v| format!(" {}", v)).unwrap_or_default(),
                self.db_path.display()
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        self.ensure_meta_table().await?;
        let rows = self
            .run_sql_json(
                "SELECT name, dimensions, distance_metric FROM _embedbay_collections ORDER BY name;",
            )
            .await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let Some(name) = row.get("name").and_then(|v| v.as_str()).map(ToString::to_string) else {
                continue;
            };
            let dims = row
                .get("dimensions")
                .and_then(|v| v.as_u64())
                .map(|d| d as usize);
            let metric = row
                .get("distance_metric")
                .and_then(|v| v.as_str())
                .map(ToString::to_string);
            let cnt = self
                .run_sql_json(&format!("SELECT COUNT(*) AS cnt FROM \"{}\";", name))
                .await
                .ok()
                .and_then(|r| r.first().and_then(|x| x.get("cnt")).and_then(|c| c.as_u64()));
            out.push(CollectionSummary {
                name,
                vector_count: cnt,
                dimensions: dims,
                distance_metric: metric,
            });
        }
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let table = sanitize_duckdb_ident(collection)?;
        let (dims, metric) = self.read_collection_meta(&table).await?;
        let cnt = self
            .run_sql_json(&format!("SELECT COUNT(*) AS cnt FROM \"{}\";", table))
            .await?
            .first()
            .and_then(|r| r.get("cnt"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let sample = self
            .run_sql_json(&format!("SELECT payload FROM \"{}\" LIMIT 20;", table))
            .await
            .unwrap_or_default();
        let mut fields = BTreeMap::new();
        for row in sample {
            let obj_opt = match row.get("payload") {
                Some(Value::String(s)) => serde_json::from_str::<Value>(s).ok(),
                Some(v) => Some(v.clone()),
                None => None,
            };
            if let Some(Value::Object(obj)) = obj_opt {
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

        let disk_bytes = fs::metadata(&self.db_path).map(|m| m.len()).ok();
        Ok(CollectionSchema {
            name: table,
            vector_count: cnt,
            dimensions: Some(dims),
            distance_metric: Some(metric),
            index_type: Some("DuckDB Columnar + VSS".to_string()),
            segment_count: None,
            disk_bytes,
            vector_field_name: Some("embedding".to_string()),
            payload_fields: fields
                .into_iter()
                .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
                .collect(),
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let table = sanitize_duckdb_ident(&req.name)?;
        let dims = req.dimensions.max(1);
        self.ensure_meta_table().await?;
        let sql = format!(
            "CREATE TABLE \"{table}\" (
                id VARCHAR PRIMARY KEY,
                document VARCHAR,
                payload JSON,
                embedding FLOAT[{dims}]
            );
            INSERT INTO _embedbay_collections (name, dimensions, distance_metric)
            VALUES ({name_q}, {dims}, {metric_q});",
            table = table,
            dims = dims,
            name_q = sql_quote(&table),
            metric_q = sql_quote(&req.distance_metric),
        );
        self.run_sql_json(&sql).await?;

        // Best-effort HNSW index via DuckDB vss extension (gracefully skipped if offline)
        let vss_metric = match req.distance_metric.as_str() {
            "euclidean" | "l2" => "l2sq",
            "dot" | "ip" => "ip",
            _ => "cosine",
        };
        let vss_sql = format!(
            "SET hnsw_enable_experimental_persistence = true;
             INSTALL vss;
             LOAD vss;
             CREATE INDEX idx_hnsw_{table} ON \"{table}\" USING HNSW (embedding) WITH (metric = '{vss_metric}');",
            table = table,
            vss_metric = vss_metric
        );
        let _ = self.run_sql_json(&vss_sql).await;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let table = sanitize_duckdb_ident(collection)?;
        self.ensure_meta_table().await?;
        self.run_sql_json(&format!(
            "DROP TABLE IF EXISTS \"{table}\";
             DELETE FROM _embedbay_collections WHERE name = {q};",
            table = table,
            q = sql_quote(&table)
        ))
        .await?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let table = sanitize_duckdb_ident(collection)?;
        let _ = self.read_collection_meta(&table).await?;
        let where_clause = build_duckdb_where_clause(req.filter.as_ref())?;

        let cnt_rows = self
            .run_sql_json(&format!(
                "SELECT COUNT(*) AS cnt FROM \"{}\" {};",
                table, where_clause
            ))
            .await?;
        let total = cnt_rows
            .first()
            .and_then(|r| r.get("cnt"))
            .and_then(|v| v.as_u64());

        let cols = if req.include_vectors {
            "id, document, CAST(payload AS VARCHAR) AS payload, embedding"
        } else {
            "id, document, CAST(payload AS VARCHAR) AS payload"
        };
        let rows = self
            .run_sql_json(&format!(
                "SELECT {cols} FROM \"{table}\" {where_clause} ORDER BY id ASC LIMIT {limit} OFFSET {offset};",
                cols = cols,
                table = table,
                where_clause = where_clause,
                limit = req.limit.clamp(1, 1000),
                offset = req.offset
            ))
            .await?;

        let records = rows
            .iter()
            .map(|r| parse_duckdb_row(r, req.include_vectors, None))
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
        let table = sanitize_duckdb_ident(collection)?;
        let (dims, _) = self.read_collection_meta(&table).await?;

        let mut sql = String::new();
        for rec in &records {
            let doc_sql = match &rec.document {
                Some(d) => sql_quote(d),
                None => "NULL".to_string(),
            };
            let payload_str =
                serde_json::to_string(&rec.payload).unwrap_or_else(|_| "{}".to_string());
            let vec_sql = match &rec.vector {
                Some(v) => format_duckdb_float_array(v, dims),
                None => format_duckdb_float_array(&vec![0.0; dims], dims),
            };
            sql.push_str(&format!(
                "INSERT OR REPLACE INTO \"{table}\" (id, document, payload, embedding) VALUES ({id}, {doc}, {payload}::JSON, {vec});\n",
                table = table,
                id = sql_quote(&rec.id),
                doc = doc_sql,
                payload = sql_quote(&payload_str),
                vec = vec_sql
            ));
        }
        self.run_sql_json(&sql).await?;
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
        let table = sanitize_duckdb_ident(collection)?;
        let quoted_ids: Vec<String> = ids.iter().map(|i| sql_quote(i)).collect();
        self.run_sql_json(&format!(
            "DELETE FROM \"{}\" WHERE id IN ({});",
            table,
            quoted_ids.join(", ")
        ))
        .await?;
        Ok(ids.len())
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let table = sanitize_duckdb_ident(collection)?;
        let (dims, metric) = self.read_collection_meta(&table).await?;
        let where_clause = build_duckdb_where_clause(req.filter.as_ref())?;
        let q_lit = format_duckdb_float_array(&req.vector, dims);

        let score_expr = match metric.as_str() {
            "dot" | "ip" => format!("array_inner_product(embedding, {})", q_lit),
            "euclidean" | "l2" => format!("1.0 / (1.0 + array_distance(embedding, {}))", q_lit),
            _ => format!("array_cosine_similarity(embedding, {})", q_lit),
        };
        let cols = if req.include_vectors {
            "id, document, CAST(payload AS VARCHAR) AS payload, embedding"
        } else {
            "id, document, CAST(payload AS VARCHAR) AS payload"
        };

        let sql = format!(
            "SELECT {cols}, {score_expr} AS __score
             FROM \"{table}\"
             {where_clause}
             ORDER BY __score DESC
             LIMIT {top_k};",
            cols = cols,
            score_expr = score_expr,
            table = table,
            where_clause = where_clause,
            top_k = req.top_k.clamp(1, 500)
        );
        let rows = self.run_sql_json(&sql).await?;
        let latency_ms = start.elapsed().as_millis() as u64;

        let mut records = Vec::new();
        for row in rows {
            let score = row
                .get("__score")
                .and_then(|v| v.as_f64())
                .map(|s| s as f32);
            if let (Some(thresh), Some(sc)) = (req.score_threshold, score) {
                if sc < thresh {
                    continue;
                }
            }
            records.push(parse_duckdb_row(&row, req.include_vectors, score));
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
    fn validates_duckdb_identifiers_and_float_arrays() {
        assert_eq!(sanitize_duckdb_ident("rag_docs").expect("valid"), "rag_docs");
        assert!(sanitize_duckdb_ident("123bad").is_err());
        assert_eq!(
            format_duckdb_float_array(&[0.5, 0.25, 0.0], 3),
            "[0.5,0.25,0]::FLOAT[3]"
        );
        assert_eq!(sql_quote("O'Reilly"), "'O''Reilly'");
    }

    #[test]
    fn builds_duckdb_filters_and_parses_json_rows() {
        let spec = FilterSpec::Visual {
            logic: FilterLogic::Or,
            conditions: vec![
                FilterCondition {
                    field: "topic".to_string(),
                    op: "eq".to_string(),
                    value: json!("duckdb"),
                },
                FilterCondition {
                    field: "rank".to_string(),
                    op: "lt".to_string(),
                    value: json!(5),
                },
            ],
        };
        let clause = build_duckdb_where_clause(Some(&spec)).expect("where");
        assert!(clause.contains("json_extract_string(payload, '$.topic') = 'duckdb'"));
        assert!(clause.contains("TRY_CAST(json_extract_string(payload, '$.rank') AS DOUBLE) < 5"));

        let row = json!({
            "id": "d1",
            "document": "DuckDB vector",
            "payload": "{\"topic\":\"duckdb\"}",
            "embedding": [1.0, 0.0, 0.0]
        });
        let rec = parse_duckdb_row(&row, true, Some(0.99));
        assert_eq!(rec.id, "d1");
        assert_eq!(rec.payload["topic"], "duckdb");
        assert_eq!(rec.vector, Some(vec![1.0, 0.0, 0.0]));
        assert_eq!(rec.score, Some(0.99));
    }
}
