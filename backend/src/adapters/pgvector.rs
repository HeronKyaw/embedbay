use std::collections::BTreeMap;
use std::time::Instant;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio_postgres::{Client, NoTls};
use tokio_postgres_rustls::MakeRustlsConnect;

use crate::adapters::{
    format_connection_error, AdapterError, BrowseRecordsRequest, BrowseRecordsResponse,
    CollectionSchema, CollectionSummary, ConnectionTestResult, CreateCollectionRequest,
    FilterCondition, FilterLogic, FilterSpec, PayloadFieldSchema, SearchRequest, SearchResponse,
    VectorDbAdapter, VectorRecord,
};

pub struct PgVectorAdapter {
    conn_string: String,
    use_tls: bool,
}

pub fn sanitize_pg_identifier(name: &str) -> Result<String, AdapterError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 63 {
        return Err(AdapterError::InvalidRequest(format!(
            "Invalid PostgreSQL identifier '{}'",
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
            "PostgreSQL identifier '{}' must match [a-zA-Z_][a-zA-Z0-9_]*",
            name
        )));
    }
    Ok(trimmed.to_string())
}

pub fn format_pg_vector_literal(vec: &[f32]) -> String {
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

fn parse_pg_vector_text(raw: &str) -> Vec<f32> {
    raw.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .filter_map(|p| p.trim().parse::<f32>().ok())
        .collect()
}

fn build_pg_where_clause(
    spec: Option<&FilterSpec>,
    params: &mut Vec<String>,
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
                params.push(json.to_string());
                return Ok(format!("WHERE metadata @> ${}::jsonb", params.len()));
            }
            Ok(String::new())
        }
        FilterSpec::Visual { logic, conditions } => {
            if conditions.is_empty() {
                return Ok(String::new());
            }
            let mut clauses = Vec::new();
            for cond in conditions {
                if let Some(c) = condition_to_pg_sql(cond, params)? {
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

fn condition_to_pg_sql(
    cond: &FilterCondition,
    params: &mut Vec<String>,
) -> Result<Option<String>, AdapterError> {
    let key = cond.field.trim();
    if key.is_empty() {
        return Ok(None);
    }
    // Validate JSON key characters strictly to avoid SQL injection inside metadata->>'key'
    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.') {
        return Err(AdapterError::InvalidRequest(format!(
            "Unsafe metadata filter key '{}'",
            key
        )));
    }

    let val_str = match &cond.value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };

    match cond.op.as_str() {
        "eq" => {
            params.push(val_str);
            Ok(Some(format!("metadata->>'{}' = ${}", key, params.len())))
        }
        "neq" => {
            params.push(val_str);
            Ok(Some(format!(
                "COALESCE(metadata->>'{}', '') <> ${}",
                key,
                params.len()
            )))
        }
        "contains" => {
            params.push(format!("%{}%", val_str));
            Ok(Some(format!("metadata->>'{}' ILIKE ${}", key, params.len())))
        }
        "in" => {
            let items: Vec<String> = if let Some(arr) = cond.value.as_array() {
                arr.iter()
                    .map(|v| v.as_str().map(ToString::to_string).unwrap_or_else(|| v.to_string()))
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
            let mut placeholders = Vec::with_capacity(items.len());
            for item in items {
                params.push(item);
                placeholders.push(format!("${}", params.len()));
            }
            Ok(Some(format!(
                "metadata->>'{}' IN ({})",
                key,
                placeholders.join(", ")
            )))
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
            params.push(num.to_string());
            Ok(Some(format!(
                "(metadata->>'{}')::double precision {} ${}::double precision",
                key,
                op_sym,
                params.len()
            )))
        }
        _ => Ok(None),
    }
}

impl PgVectorAdapter {
    pub fn from_local(host: &str, port: u16) -> Self {
        Self {
            conn_string: format!(
                "host={} port={} user=postgres dbname=postgres",
                host, port
            ),
            use_tls: false,
        }
    }

    pub fn from_remote(endpoint_url: &str, secret: Option<&str>) -> Result<Self, AdapterError> {
        let trimmed = endpoint_url.trim().to_string();
        if trimmed.is_empty() {
            return Err(AdapterError::InvalidRequest(
                "PostgreSQL connection URI cannot be empty".to_string(),
            ));
        }

        let mut conn_string = trimmed.clone();
        if let Some(pwd) = secret.filter(|s| !s.trim().is_empty()) {
            if conn_string.starts_with("postgres://") || conn_string.starts_with("postgresql://") {
                if !conn_string.contains('@') {
                    if let Some((scheme, rest)) = conn_string.split_once("://") {
                        conn_string = format!("{}://postgres:{}@{}", scheme, pwd, rest);
                    }
                } else if !conn_string.contains("password=") {
                    let sep = if conn_string.contains('?') { '&' } else { '?' };
                    conn_string = format!("{}{}password={}", conn_string, sep, pwd);
                }
            } else if !conn_string.contains("password=") {
                conn_string = format!("{} password={}", conn_string, pwd);
            }
        }

        let lower = conn_string.to_ascii_lowercase();
        let is_loopback = lower.contains("127.0.0.1") || lower.contains("localhost");
        let use_tls = lower.contains("sslmode=require")
            || lower.contains("sslmode=verify")
            || (!is_loopback && !lower.contains("sslmode=disable"));

        Ok(Self {
            conn_string,
            use_tls,
        })
    }

    async fn connect(&self) -> Result<Client, AdapterError> {
        let timeout_dur = std::time::Duration::from_secs(8);
        if self.use_tls {
            let mut root_store = rustls::RootCertStore::empty();
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let config = rustls::ClientConfig::builder()
                .with_root_certificates(root_store)
                .with_no_client_auth();
            let tls = MakeRustlsConnect::new(config);
            let (client, connection) =
                tokio::time::timeout(timeout_dur, tokio_postgres::connect(&self.conn_string, tls))
                    .await
                    .map_err(|_| {
                        AdapterError::Http(
                            "Connection timed out. Check the host, VPN, or firewall.".to_string(),
                        )
                    })?
                    .map_err(|e| {
                        AdapterError::Http(format_connection_error("PostgreSQL", &e.to_string()))
                    })?;
            tokio::spawn(async move {
                let _ = connection.await;
            });
            Ok(client)
        } else {
            let (client, connection) = tokio::time::timeout(
                timeout_dur,
                tokio_postgres::connect(&self.conn_string, NoTls),
            )
            .await
            .map_err(|_| {
                AdapterError::Http(
                    "Connection timed out. Check the host, VPN, or firewall.".to_string(),
                )
            })?
            .map_err(|e| {
                AdapterError::Http(format_connection_error("PostgreSQL", &e.to_string()))
            })?;
            tokio::spawn(async move {
                let _ = connection.await;
            });
            Ok(client)
        }
    }

    async fn detect_vector_column(
        &self,
        client: &Client,
        table: &str,
    ) -> Result<(String, Option<usize>), AdapterError> {
        let row = client
            .query_opt(
                "SELECT a.attname, format_type(a.atttypid, a.atttypmod)
                 FROM pg_attribute a
                 JOIN pg_class c ON c.oid = a.attrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 JOIN pg_type t ON t.oid = a.atttypid
                 WHERE n.nspname = 'public'
                   AND c.relname = $1
                   AND a.attnum > 0
                   AND NOT a.attisdropped
                   AND t.typname = 'vector'
                 LIMIT 1",
                &[&table],
            )
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        if let Some(r) = row {
            let col_name: String = r.get(0);
            let type_str: String = r.get(1);
            let dims = type_str
                .strip_prefix("vector(")
                .and_then(|s| s.strip_suffix(')'))
                .and_then(|n| n.parse::<usize>().ok());
            Ok((col_name, dims))
        } else {
            Ok(("embedding".to_string(), None))
        }
    }
}

#[async_trait]
impl VectorDbAdapter for PgVectorAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let start = Instant::now();
        let client = self.connect().await?;
        let row = client
            .query_one("SELECT version()", &[])
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        let latency_ms = start.elapsed().as_millis() as u64;
        let ver: String = row.get(0);
        let short_ver = ver.split_whitespace().take(2).collect::<Vec<_>>().join(" ");
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms,
            engine_version: Some(short_ver.clone()),
            message: format!("Connected to {}", short_ver),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let client = self.connect().await?;
        let rows = client
            .query(
                "SELECT c.relname, format_type(a.atttypid, a.atttypmod), c.reltuples::bigint
                 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                 JOIN pg_attribute a ON a.attrelid = c.oid
                 JOIN pg_type t ON t.oid = a.atttypid
                 WHERE n.nspname = 'public'
                   AND c.relkind IN ('r', 'p')
                   AND a.attnum > 0
                   AND NOT a.attisdropped
                   AND t.typname = 'vector'
                 ORDER BY c.relname ASC",
                &[],
            )
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let name: String = row.get(0);
            let type_str: String = row.get(1);
            let approx_count: i64 = row.get(2);
            let dims = type_str
                .strip_prefix("vector(")
                .and_then(|s| s.strip_suffix(')'))
                .and_then(|n| n.parse::<usize>().ok());
            out.push(CollectionSummary {
                name,
                vector_count: Some(approx_count.max(0) as u64),
                dimensions: dims,
                distance_metric: Some("cosine".to_string()),
            });
        }
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let table = sanitize_pg_identifier(collection)?;
        let client = self.connect().await?;
        let (vec_col, dimensions) = self.detect_vector_column(&client, &table).await?;

        let count_sql = format!("SELECT COUNT(*)::bigint FROM \"{}\"", table);
        let count_row = client
            .query_one(&count_sql, &[])
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        let vector_count = count_row.get::<_, i64>(0).max(0) as u64;

        let size_row = client
            .query_opt(
                "SELECT pg_total_relation_size(quote_ident($1))::bigint",
                &[&table],
            )
            .await
            .ok()
            .flatten();
        let disk_bytes = size_row.map(|r| r.get::<_, i64>(0).max(0) as u64);

        let idx_row = client
            .query_opt(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 AND indexdef ILIKE '%vector%' LIMIT 1",
                &[&table],
            )
            .await
            .ok()
            .flatten();
        let index_type = idx_row
            .map(|r| {
                let def: String = r.get(0);
                if def.to_ascii_lowercase().contains("hnsw") {
                    "HNSW".to_string()
                } else if def.to_ascii_lowercase().contains("ivfflat") {
                    "IVFFlat".to_string()
                } else {
                    "Index".to_string()
                }
            })
            .or_else(|| Some("Sequential / HNSW".to_string()));

        let col_rows = client
            .query(
                "SELECT column_name, data_type
                 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = $1",
                &[&table],
            )
            .await
            .unwrap_or_default();
        let mut fields = BTreeMap::new();
        for r in col_rows {
            let cname: String = r.get(0);
            let dtype: String = r.get(1);
            fields.insert(cname, dtype);
        }

        Ok(CollectionSchema {
            name: table,
            vector_count,
            dimensions,
            distance_metric: Some("cosine".to_string()),
            index_type,
            segment_count: None,
            disk_bytes,
            vector_field_name: Some(vec_col),
            payload_fields: fields
                .into_iter()
                .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
                .collect(),
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let table = sanitize_pg_identifier(&req.name)?;
        let dims = req.dimensions.max(1);
        let client = self.connect().await?;

        client
            .batch_execute("CREATE EXTENSION IF NOT EXISTS vector;")
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let ops = match req.distance_metric.to_ascii_lowercase().as_str() {
            "dot" | "ip" => "vector_ip_ops",
            "euclidean" | "l2" => "vector_l2_ops",
            _ => "vector_cosine_ops",
        };

        let ddl = format!(
            "CREATE TABLE \"{table}\" (
                id TEXT PRIMARY KEY,
                embedding vector({dims}),
                metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb,
                document TEXT
             );
             CREATE INDEX \"{table}_embedding_hnsw_idx\" ON \"{table}\" USING hnsw (embedding {ops});"
        );
        client
            .batch_execute(&ddl)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        Ok(())
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let table = sanitize_pg_identifier(collection)?;
        let client = self.connect().await?;
        let sql = format!("DROP TABLE IF EXISTS \"{}\"", table);
        client
            .batch_execute(&sql)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let table = sanitize_pg_identifier(collection)?;
        let client = self.connect().await?;
        let (vec_col, _) = self.detect_vector_column(&client, &table).await?;

        let mut params: Vec<String> = Vec::new();
        let where_sql = build_pg_where_clause(req.filter.as_ref(), &mut params)?;
        let vec_expr = if req.include_vectors {
            format!("COALESCE({}::text, '')", vec_col)
        } else {
            "''::text".to_string()
        };

        let sql = format!(
            "SELECT id::text, COALESCE(metadata::text, '{{}}'), document, {vec_expr}
             FROM \"{table}\"
             {where_sql}
             ORDER BY id ASC
             LIMIT {} OFFSET {}",
            req.limit.clamp(1, 1000),
            req.offset
        );

        let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = params
            .iter()
            .map(|p| p as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();

        let rows = client
            .query(&sql, &param_refs)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let records = rows
            .into_iter()
            .map(|r| {
                let id: String = r.get(0);
                let meta_str: String = r.get(1);
                let document: Option<String> = r.get(2);
                let vec_str: String = r.get(3);
                let payload = serde_json::from_str::<Value>(&meta_str).unwrap_or_else(|_| json!({}));
                let vector = if req.include_vectors && !vec_str.is_empty() {
                    Some(parse_pg_vector_text(&vec_str))
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

        let count_sql = format!("SELECT COUNT(*)::bigint FROM \"{}\" {}", table, where_sql);
        let total_count = client
            .query_one(&count_sql, &param_refs)
            .await
            .ok()
            .map(|r| r.get::<_, i64>(0).max(0) as u64);

        Ok(BrowseRecordsResponse {
            records,
            next_cursor: None,
            total_count,
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
        let table = sanitize_pg_identifier(collection)?;
        let client = self.connect().await?;
        let (vec_col, _) = self.detect_vector_column(&client, &table).await?;

        let sql = format!(
            "INSERT INTO \"{table}\" (id, {vec_col}, metadata, document)
             VALUES ($1, $2::text::vector, $3::text::jsonb, $4)
             ON CONFLICT (id) DO UPDATE SET
               {vec_col} = COALESCE(EXCLUDED.{vec_col}, \"{table}\".{vec_col}),
               metadata = EXCLUDED.metadata,
               document = EXCLUDED.document"
        );

        for rec in &records {
            let vec_lit: Option<String> = rec.vector.as_ref().map(|v| format_pg_vector_literal(v));
            let meta_str = serde_json::to_string(&rec.payload).unwrap_or_else(|_| "{}".to_string());
            client
                .execute(&sql, &[&rec.id, &vec_lit, &meta_str, &rec.document])
                .await
                .map_err(|e| AdapterError::Api(e.to_string()))?;
        }
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
        let table = sanitize_pg_identifier(collection)?;
        let client = self.connect().await?;
        let sql = format!("DELETE FROM \"{}\" WHERE id::text = ANY($1)", table);
        let affected = client
            .execute(&sql, &[&ids])
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;
        Ok(affected as usize)
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = Instant::now();
        let table = sanitize_pg_identifier(collection)?;
        let client = self.connect().await?;
        let (vec_col, _) = self.detect_vector_column(&client, &table).await?;

        let mut params = vec![format_pg_vector_literal(&req.vector)];
        let where_sql = build_pg_where_clause(req.filter.as_ref(), &mut params)?;
        let vec_expr = if req.include_vectors {
            format!("COALESCE({}::text, '')", vec_col)
        } else {
            "''::text".to_string()
        };

        let sql = format!(
            "SELECT id::text, COALESCE(metadata::text, '{{}}'), document, {vec_expr},
                    (1.0 - ({vec_col} <=> $1::text::vector))::real AS score
             FROM \"{table}\"
             {where_sql}
             ORDER BY {vec_col} <=> $1::text::vector ASC
             LIMIT {}",
            req.top_k.clamp(1, 500)
        );

        let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = params
            .iter()
            .map(|p| p as &(dyn tokio_postgres::types::ToSql + Sync))
            .collect();

        let rows = client
            .query(&sql, &param_refs)
            .await
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        let latency_ms = start.elapsed().as_millis() as u64;
        let mut records = Vec::with_capacity(rows.len());
        for r in rows {
            let score: f32 = r.get(4);
            if let Some(thresh) = req.score_threshold {
                if score < thresh {
                    continue;
                }
            }
            let id: String = r.get(0);
            let meta_str: String = r.get(1);
            let document: Option<String> = r.get(2);
            let vec_str: String = r.get(3);
            let payload = serde_json::from_str::<Value>(&meta_str).unwrap_or_else(|_| json!({}));
            let vector = if req.include_vectors && !vec_str.is_empty() {
                Some(parse_pg_vector_text(&vec_str))
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
    fn validates_sql_identifiers_and_vector_formatting() {
        assert_eq!(
            sanitize_pg_identifier("docs_v1").expect("valid"),
            "docs_v1"
        );
        assert!(sanitize_pg_identifier("docs; DROP TABLE users;").is_err());
        assert!(sanitize_pg_identifier("123bad").is_err());

        assert_eq!(format_pg_vector_literal(&[0.5, -0.25, 1.0]), "[0.5,-0.25,1]");
        assert_eq!(parse_pg_vector_text("[0.5, -0.25, 1]"), vec![0.5, -0.25, 1.0]);

        let mut params = Vec::new();
        let where_sql = build_pg_where_clause(
            Some(&FilterSpec::Visual {
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
                        value: json!(2024),
                    },
                ],
            }),
            &mut params,
        )
        .expect("build where");
        assert!(where_sql.contains("metadata->>'topic' = $1"));
        assert!(where_sql.contains("(metadata->>'year')::double precision >= $2"));
        assert_eq!(params, vec!["rust", "2024"]);
    }
}
