use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Once;
use std::time::Instant;

use async_trait::async_trait;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::adapters::{
    AdapterError, BrowseRecordsRequest, BrowseRecordsResponse, CollectionSchema,
    CollectionSummary, ConnectionTestResult, CreateCollectionRequest, FilterCondition,
    FilterLogic, FilterSpec, PayloadFieldSchema, SearchRequest, SearchResponse, VectorDbAdapter,
    VectorRecord,
};

static REGISTER_SQLITE_VEC: Once = Once::new();

fn ensure_sqlite_vec_registered() {
    REGISTER_SQLITE_VEC.call_once(|| unsafe {
        #[allow(clippy::missing_transmute_annotations)]
        let init_fn: Option<
            unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut std::os::raw::c_char,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> std::os::raw::c_int,
        > = Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        ));
        rusqlite::ffi::sqlite3_auto_extension(init_fn);
    });
}

pub struct SqliteVecAdapter {
    db_path: PathBuf,
}

fn sanitize_ident(name: &str) -> Result<String, AdapterError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(AdapterError::InvalidRequest(format!(
            "Invalid SQLite collection name '{}'",
            name
        )));
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return Err(AdapterError::InvalidRequest("Empty collection name".to_string()));
    };
    if !(first.is_ascii_alphabetic() || first == '_')
        || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(AdapterError::InvalidRequest(format!(
            "Collection name '{}' must match [a-zA-Z_][a-zA-Z0-9_]*",
            name
        )));
    }
    Ok(trimmed.to_string())
}

fn vec_to_le_bytes(vec: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(vec.len() * 4);
    for v in vec {
        let f = if v.is_finite() { *v } else { 0.0 };
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

fn le_bytes_to_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

fn matches_filter(payload: &Value, spec: &FilterSpec) -> bool {
    match spec {
        FilterSpec::RawJson { json } => {
            if let Some(obj) = json.as_object() {
                for (k, v) in obj {
                    if payload.get(k) != Some(v) {
                        return false;
                    }
                }
            }
            true
        }
        FilterSpec::Visual { logic, conditions } => {
            if conditions.is_empty() {
                return true;
            }
            match logic {
                FilterLogic::And => conditions.iter().all(|c| matches_condition(payload, c)),
                FilterLogic::Or => conditions.iter().any(|c| matches_condition(payload, c)),
            }
        }
    }
}

fn matches_condition(payload: &Value, cond: &FilterCondition) -> bool {
    let field = cond.field.trim();
    if field.is_empty() {
        return true;
    }
    let val = payload.get(field);
    match cond.op.as_str() {
        "eq" => val == Some(&cond.value),
        "neq" => val != Some(&cond.value),
        "in" => {
            let Some(v) = val else { return false };
            if let Some(arr) = cond.value.as_array() {
                arr.contains(v)
            } else if let Some(s) = cond.value.as_str() {
                let v_str = v.as_str().map(ToString::to_string).unwrap_or_else(|| v.to_string());
                s.split(',').map(str::trim).any(|item| item == v_str)
            } else {
                false
            }
        }
        "contains" => {
            let needle = cond
                .value
                .as_str()
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_else(|| cond.value.to_string().to_ascii_lowercase());
            val.map(|v| v.to_string().to_ascii_lowercase().contains(&needle))
                .unwrap_or(false)
        }
        "gt" | "gte" | "lt" | "lte" => {
            let Some(lhs) = val.and_then(|v| v.as_f64()) else {
                return false;
            };
            let Some(rhs) = cond.value.as_f64() else {
                return false;
            };
            match cond.op.as_str() {
                "gt" => lhs > rhs,
                "gte" => lhs >= rhs,
                "lt" => lhs < rhs,
                "lte" => lhs <= rhs,
                _ => false,
            }
        }
        _ => true,
    }
}

fn distance_to_score(dist: f32, metric: &str) -> f32 {
    match metric.to_ascii_lowercase().as_str() {
        "euclidean" | "l2" => 1.0 / (1.0 + dist.max(0.0)),
        _ => 1.0 - dist,
    }
}

impl SqliteVecAdapter {
    pub fn new(root_dir: PathBuf) -> Result<Self, AdapterError> {
        ensure_sqlite_vec_registered();
        let is_file_target = root_dir
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("db") || e.eq_ignore_ascii_case("sqlite"));
        let db_path = if is_file_target {
            if let Some(parent) = root_dir.parent() {
                fs::create_dir_all(parent).map_err(|e| AdapterError::Api(e.to_string()))?;
            }
            root_dir
        } else {
            fs::create_dir_all(&root_dir).map_err(|e| AdapterError::Api(e.to_string()))?;
            root_dir.join("vectors.db")
        };
        Ok(Self { db_path })
    }

    fn open_conn(&self) -> Result<Connection, AdapterError> {
        ensure_sqlite_vec_registered();
        let conn = Connection::open(&self.db_path).map_err(|e| AdapterError::Api(e.to_string()))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS _embedbay_collections (
                 name TEXT PRIMARY KEY,
                 dimensions INTEGER NOT NULL,
                 distance_metric TEXT NOT NULL
             );",
        )
        .map_err(|e| AdapterError::Api(e.to_string()))?;
        Ok(conn)
    }

    async fn with_db<F, T>(&self, f: F) -> Result<T, AdapterError>
    where
        F: FnOnce(&mut Connection, &Path) -> Result<T, AdapterError> + Send + 'static,
        T: Send + 'static,
    {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            let adapter = SqliteVecAdapter {
                db_path: db_path.clone(),
            };
            let mut conn = adapter.open_conn()?;
            f(&mut conn, &db_path)
        })
        .await
        .map_err(|e| AdapterError::Api(e.to_string()))?
    }
}

#[async_trait]
impl VectorDbAdapter for SqliteVecAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let (vec_ver, sqlite_ver) = self
            .with_db(|conn, _| {
                conn.query_row("SELECT vec_version(), sqlite_version()", [], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| AdapterError::Api(e.to_string()))
            })
            .await?;
        let latency_ms = start.elapsed().as_millis() as u64;
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms,
            engine_version: Some(vec_ver.clone()),
            message: format!(
                "sqlite-vec {} ready (SQLite {} at {})",
                vec_ver,
                sqlite_ver,
                self.db_path.display()
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        self.with_db(|conn, _| {
            let mut stmt = conn
                .prepare("SELECT name, dimensions, distance_metric FROM _embedbay_collections ORDER BY name")
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? as usize,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| AdapterError::Api(e.to_string()))?;

            let mut out = Vec::new();
            for row in rows {
                let (name, dims, metric) = row.map_err(|e| AdapterError::Api(e.to_string()))?;
                let count: u64 = conn
                    .query_row(
                        &format!("SELECT COUNT(*) FROM \"meta_{}\"", name),
                        [],
                        |r| r.get::<_, i64>(0),
                    )
                    .unwrap_or(0)
                    .max(0) as u64;
                out.push(CollectionSummary {
                    name,
                    vector_count: Some(count),
                    dimensions: Some(dims),
                    distance_metric: Some(metric),
                });
            }
            Ok(out)
        })
        .await
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let name = sanitize_ident(collection)?;
        self.with_db(move |conn, db_path| {
            let meta: Option<(i64, String)> = conn
                .query_row(
                    "SELECT dimensions, distance_metric FROM _embedbay_collections WHERE name = ?1",
                    [&name],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            let (dims, metric) = meta.ok_or_else(|| {
                AdapterError::NotFound(format!("Collection '{}' not found", name))
            })?;

            let count: u64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM \"meta_{}\"", name),
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .map_err(|e| AdapterError::Api(e.to_string()))?
                .max(0) as u64;

            let mut field_types = BTreeMap::new();
            let mut stmt = conn
                .prepare(&format!("SELECT payload FROM \"meta_{}\" LIMIT 20", name))
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            for raw in rows.flatten() {
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
                        field_types.entry(k).or_insert_with(|| dt.to_string());
                    }
                }
            }

            let disk_bytes = fs::metadata(db_path).map(|m| m.len()).ok();
            Ok(CollectionSchema {
                name,
                vector_count: count,
                dimensions: Some(dims.max(1) as usize),
                distance_metric: Some(metric),
                index_type: Some("sqlite-vec (vec0)".to_string()),
                segment_count: None,
                disk_bytes,
                vector_field_name: Some("embedding".to_string()),
                payload_fields: field_types
                    .into_iter()
                    .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
                    .collect(),
            })
        })
        .await
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let name = sanitize_ident(&req.name)?;
        let dims = req.dimensions.max(1);
        let metric = req.distance_metric.clone();
        let vec0_metric = match req.distance_metric.as_str() {
            "euclidean" | "l2" => "L2",
            _ => "cosine",
        };
        self.with_db(move |conn, _| {
            let exists: Option<String> = conn
                .query_row(
                    "SELECT name FROM _embedbay_collections WHERE name = ?1",
                    [&name],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            if exists.is_some() {
                return Err(AdapterError::InvalidRequest(format!(
                    "Collection '{}' already exists",
                    name
                )));
            }

            conn.execute_batch(&format!(
                "CREATE VIRTUAL TABLE \"vec_{name}\" USING vec0(embedding float[{dims}] distance_metric={vec0_metric});
                 CREATE TABLE \"meta_{name}\" (
                     rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                     id TEXT UNIQUE NOT NULL,
                     document TEXT,
                     payload TEXT NOT NULL
                 );",
                name = name,
                dims = dims,
                vec0_metric = vec0_metric
            ))
            .map_err(|e| AdapterError::Api(e.to_string()))?;

            conn.execute(
                "INSERT INTO _embedbay_collections (name, dimensions, distance_metric) VALUES (?1, ?2, ?3)",
                params![name, dims as i64, metric],
            )
            .map_err(|e| AdapterError::Api(e.to_string()))?;
            Ok(())
        })
        .await
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let name = sanitize_ident(collection)?;
        self.with_db(move |conn, _| {
            conn.execute_batch(&format!(
                "DROP TABLE IF EXISTS \"vec_{name}\";
                 DROP TABLE IF EXISTS \"meta_{name}\";",
                name = name
            ))
            .map_err(|e| AdapterError::Api(e.to_string()))?;
            conn.execute("DELETE FROM _embedbay_collections WHERE name = ?1", [&name])
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            Ok(())
        })
        .await
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let name = sanitize_ident(collection)?;
        self.with_db(move |conn, _| {
            let sql = if req.include_vectors {
                format!(
                    "SELECT m.id, m.document, m.payload, v.embedding
                     FROM \"meta_{name}\" m
                     LEFT JOIN \"vec_{name}\" v ON v.rowid = m.rowid
                     ORDER BY m.rowid ASC",
                    name = name
                )
            } else {
                format!(
                    "SELECT m.id, m.document, m.payload, NULL
                     FROM \"meta_{name}\" m
                     ORDER BY m.rowid ASC",
                    name = name
                )
            };
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<Vec<u8>>>(3)?,
                    ))
                })
                .map_err(|e| AdapterError::Api(e.to_string()))?;

            let mut matched = Vec::new();
            for row in rows {
                let (id, document, payload_raw, vec_bytes) =
                    row.map_err(|e| AdapterError::Api(e.to_string()))?;
                let payload: Value =
                    serde_json::from_str(&payload_raw).unwrap_or_else(|_| json!({}));
                if req
                    .filter
                    .as_ref()
                    .is_some_and(|f| !matches_filter(&payload, f))
                {
                    continue;
                }
                let vector = if req.include_vectors {
                    vec_bytes.map(|b| le_bytes_to_vec(&b))
                } else {
                    None
                };
                matched.push(VectorRecord {
                    id,
                    payload,
                    document,
                    vector,
                    score: None,
                });
            }

            let total_count = matched.len() as u64;
            let records = matched
                .into_iter()
                .skip(req.offset)
                .take(req.limit.clamp(1, 1000))
                .collect();
            Ok(BrowseRecordsResponse {
                records,
                next_cursor: None,
                total_count: Some(total_count),
            })
        })
        .await
    }

    async fn upsert_records(
        &self,
        collection: &str,
        records: Vec<VectorRecord>,
    ) -> Result<usize, AdapterError> {
        if records.is_empty() {
            return Ok(0);
        }
        let name = sanitize_ident(collection)?;
        self.with_db(move |conn, _| {
            let expected_dims: usize = conn
                .query_row(
                    "SELECT dimensions FROM _embedbay_collections WHERE name = ?1",
                    [&name],
                    |r| r.get::<_, i64>(0),
                )
                .map_err(|_| AdapterError::NotFound(format!("Collection '{}' not found", name)))?
                .max(1) as usize;

            let tx = conn
                .transaction()
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            for rec in &records {
                let existing_rowid: Option<i64> = tx
                    .query_row(
                        &format!("SELECT rowid FROM \"meta_{}\" WHERE id = ?1", name),
                        [&rec.id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| AdapterError::Api(e.to_string()))?;
                if let Some(rid) = existing_rowid {
                    tx.execute(
                        &format!("DELETE FROM \"vec_{}\" WHERE rowid = ?1", name),
                        [rid],
                    )
                    .map_err(|e| AdapterError::Api(e.to_string()))?;
                    tx.execute(
                        &format!("DELETE FROM \"meta_{}\" WHERE rowid = ?1", name),
                        [rid],
                    )
                    .map_err(|e| AdapterError::Api(e.to_string()))?;
                }

                let payload_str =
                    serde_json::to_string(&rec.payload).unwrap_or_else(|_| "{}".to_string());
                tx.execute(
                    &format!(
                        "INSERT INTO \"meta_{}\" (id, document, payload) VALUES (?1, ?2, ?3)",
                        name
                    ),
                    params![rec.id, rec.document, payload_str],
                )
                .map_err(|e| AdapterError::Api(e.to_string()))?;
                let rowid = tx.last_insert_rowid();

                let vec = rec.vector.clone().unwrap_or_else(|| vec![0.0; expected_dims]);
                let vec_bytes = vec_to_le_bytes(&vec);
                tx.execute(
                    &format!(
                        "INSERT INTO \"vec_{}\" (rowid, embedding) VALUES (?1, ?2)",
                        name
                    ),
                    params![rowid, vec_bytes],
                )
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            }
            tx.commit().map_err(|e| AdapterError::Api(e.to_string()))?;
            Ok(records.len())
        })
        .await
    }

    async fn delete_records(
        &self,
        collection: &str,
        ids: Vec<String>,
    ) -> Result<usize, AdapterError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let name = sanitize_ident(collection)?;
        self.with_db(move |conn, _| {
            let tx = conn
                .transaction()
                .map_err(|e| AdapterError::Api(e.to_string()))?;
            let mut deleted = 0usize;
            for id in &ids {
                let rowid: Option<i64> = tx
                    .query_row(
                        &format!("SELECT rowid FROM \"meta_{}\" WHERE id = ?1", name),
                        [id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| AdapterError::Api(e.to_string()))?;
                if let Some(rid) = rowid {
                    tx.execute(
                        &format!("DELETE FROM \"vec_{}\" WHERE rowid = ?1", name),
                        [rid],
                    )
                    .map_err(|e| AdapterError::Api(e.to_string()))?;
                    tx.execute(
                        &format!("DELETE FROM \"meta_{}\" WHERE rowid = ?1", name),
                        [rid],
                    )
                    .map_err(|e| AdapterError::Api(e.to_string()))?;
                    deleted += 1;
                }
            }
            tx.commit().map_err(|e| AdapterError::Api(e.to_string()))?;
            Ok(deleted)
        })
        .await
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let name = sanitize_ident(collection)?;
        let start = Instant::now();
        let records = self
            .with_db(move |conn, _| {
                let metric: String = conn
                    .query_row(
                        "SELECT distance_metric FROM _embedbay_collections WHERE name = ?1",
                        [&name],
                        |r| r.get(0),
                    )
                    .map_err(|_| {
                        AdapterError::NotFound(format!("Collection '{}' not found", name))
                    })?;

                let total_rows: usize = conn
                    .query_row(
                        &format!("SELECT COUNT(*) FROM \"meta_{}\"", name),
                        [],
                        |r| r.get::<_, i64>(0),
                    )
                    .unwrap_or(0)
                    .max(0) as usize;
                if total_rows == 0 {
                    return Ok(Vec::new());
                }

                let top_k = req.top_k.clamp(1, 500);
                let fetch_k = if req.filter.is_some() {
                    total_rows.min((top_k * 8).max(64))
                } else {
                    top_k.min(total_rows)
                };

                let q_bytes = vec_to_le_bytes(&req.vector);
                let sql = if req.include_vectors {
                    format!(
                        "SELECT m.id, m.document, m.payload, v.distance, v.embedding
                         FROM \"vec_{name}\" v
                         JOIN \"meta_{name}\" m ON m.rowid = v.rowid
                         WHERE v.embedding MATCH ?1 AND k = ?2
                         ORDER BY v.distance ASC",
                        name = name
                    )
                } else {
                    format!(
                        "SELECT m.id, m.document, m.payload, v.distance, NULL
                         FROM \"vec_{name}\" v
                         JOIN \"meta_{name}\" m ON m.rowid = v.rowid
                         WHERE v.embedding MATCH ?1 AND k = ?2
                         ORDER BY v.distance ASC",
                        name = name
                    )
                };

                let mut stmt = conn
                    .prepare(&sql)
                    .map_err(|e| AdapterError::Api(e.to_string()))?;
                let rows = stmt
                    .query_map(params![q_bytes, fetch_k as i64], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, Option<String>>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, f64>(3)? as f32,
                            r.get::<_, Option<Vec<u8>>>(4)?,
                        ))
                    })
                    .map_err(|e| AdapterError::Api(e.to_string()))?;

                let mut out = Vec::new();
                for row in rows {
                    let (id, document, payload_raw, dist, vec_bytes) =
                        row.map_err(|e| AdapterError::Api(e.to_string()))?;
                    let payload: Value =
                        serde_json::from_str(&payload_raw).unwrap_or_else(|_| json!({}));
                    if req
                        .filter
                        .as_ref()
                        .is_some_and(|f| !matches_filter(&payload, f))
                    {
                        continue;
                    }
                    let score = distance_to_score(dist, &metric);
                    if let Some(thresh) = req.score_threshold {
                        if score < thresh {
                            continue;
                        }
                    }
                    let vector = if req.include_vectors {
                        vec_bytes.map(|b| le_bytes_to_vec(&b))
                    } else {
                        None
                    };
                    out.push(VectorRecord {
                        id,
                        payload,
                        document,
                        vector,
                        score: Some(score),
                    });
                    if out.len() >= top_k {
                        break;
                    }
                }
                Ok(out)
            })
            .await?;

        Ok(SearchResponse {
            records,
            latency_ms: start.elapsed().as_millis() as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sqlite_vec_real_crud_filter_and_knn_roundtrip() {
        let dir = tempfile::tempdir().expect("temp dir");
        let adapter = SqliteVecAdapter::new(dir.path().to_path_buf()).expect("sqlite_vec init");

        let conn = adapter.test_connection().await.expect("test connection");
        assert!(conn.ok);
        assert!(conn.engine_version.is_some());

        adapter
            .create_collection(CreateCollectionRequest {
                name: "notes".to_string(),
                dimensions: 3,
                distance_metric: "cosine".to_string(),
                index_type: None,
            })
            .await
            .expect("create collection");

        adapter
            .upsert_records(
                "notes",
                vec![
                    VectorRecord {
                        id: "n1".to_string(),
                        payload: json!({"topic": "rust", "year": 2026}),
                        document: Some("Rust sqlite-vec".to_string()),
                        vector: Some(vec![1.0, 0.0, 0.0]),
                        score: None,
                    },
                    VectorRecord {
                        id: "n2".to_string(),
                        payload: json!({"topic": "python", "year": 2025}),
                        document: Some("Python notes".to_string()),
                        vector: Some(vec![0.0, 1.0, 0.0]),
                        score: None,
                    },
                ],
            )
            .await
            .expect("upsert");

        let browsed = adapter
            .browse_records(
                "notes",
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
        assert_eq!(browsed.records[0].id, "n1");
        assert_eq!(browsed.records[0].vector, Some(vec![1.0, 0.0, 0.0]));

        let searched = adapter
            .search_vectors(
                "notes",
                SearchRequest {
                    vector: vec![0.98, 0.02, 0.0],
                    top_k: 2,
                    score_threshold: Some(0.8),
                    include_vectors: false,
                    filter: None,
                },
            )
            .await
            .expect("search");
        assert_eq!(searched.records.len(), 1);
        assert_eq!(searched.records[0].id, "n1");

        let deleted = adapter
            .delete_records("notes", vec!["n2".to_string()])
            .await
            .expect("delete");
        assert_eq!(deleted, 1);

        let info = adapter.get_collection_info("notes").await.expect("info");
        assert_eq!(info.vector_count, 1);
        assert_eq!(info.dimensions, Some(3));
    }
}
