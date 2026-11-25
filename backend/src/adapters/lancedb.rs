use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;

use crate::adapters::{
    AdapterError, BrowseRecordsRequest, BrowseRecordsResponse, CollectionSchema,
    CollectionSummary, ConnectionTestResult, CreateCollectionRequest, FilterCondition,
    FilterLogic, FilterSpec, PayloadFieldSchema, SearchRequest, SearchResponse, VectorDbAdapter,
    VectorRecord,
};
use crate::supervisor::metrics::dir_size_bytes;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LanceCollectionMeta {
    dimensions: usize,
    distance_metric: String,
    version: u64,
}

pub struct LanceDbAdapter {
    root_dir: PathBuf,
}

impl LanceDbAdapter {
    pub fn new(root_dir: PathBuf) -> Result<Self, AdapterError> {
        fs::create_dir_all(&root_dir).map_err(|e| AdapterError::Api(e.to_string()))?;
        Ok(Self { root_dir })
    }

    fn is_single_lance_table(&self) -> bool {
        self.root_dir
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(".lance"))
            .unwrap_or(false)
            && self.root_dir.join("_versions").is_dir()
    }

    fn resolve_table_dir(&self, collection: &str) -> Result<PathBuf, AdapterError> {
        let clean = collection.trim();
        if clean.is_empty()
            || clean.contains("..")
            || clean.contains('/')
            || clean.contains('\\')
        {
            return Err(AdapterError::InvalidRequest(format!(
                "Invalid LanceDB table name '{}'",
                collection
            )));
        }

        if self.is_single_lance_table() {
            let root_name = self
                .root_dir
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("default");
            if clean == root_name {
                return Ok(self.root_dir.clone());
            }
        }

        let with_ext = if clean.ends_with(".lance") {
            clean.to_string()
        } else {
            format!("{}.lance", clean)
        };
        Ok(self.root_dir.join(with_ext))
    }

    fn list_table_dirs(&self) -> Vec<(String, PathBuf)> {
        if self.is_single_lance_table() {
            let name = self
                .root_dir
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("default")
                .to_string();
            return vec![(name, self.root_dir.clone())];
        }

        let mut out = Vec::new();
        let Ok(entries) = fs::read_dir(&self.root_dir) else {
            return out;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                if let Some(stem) = fname.strip_suffix(".lance") {
                    out.push((stem.to_string(), path));
                } else if path.join("_versions").is_dir() {
                    out.push((fname.to_string(), path));
                }
            }
        }
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    fn read_records_file(&self, table_dir: &Path) -> Result<Vec<VectorRecord>, AdapterError> {
        let data_file = table_dir.join("data").join("records.jsonl");
        if !data_file.is_file() {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&data_file).map_err(|e| AdapterError::Api(e.to_string()))?;
        let mut out = Vec::new();
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(rec) = serde_json::from_str::<VectorRecord>(trimmed) {
                out.push(rec);
            }
        }
        Ok(out)
    }

    fn write_records_file(
        &self,
        table_dir: &Path,
        records: &[VectorRecord],
        meta: &mut LanceCollectionMeta,
    ) -> Result<(), AdapterError> {
        let data_dir = table_dir.join("data");
        let versions_dir = table_dir.join("_versions");
        fs::create_dir_all(&data_dir).map_err(|e| AdapterError::Api(e.to_string()))?;
        fs::create_dir_all(&versions_dir).map_err(|e| AdapterError::Api(e.to_string()))?;

        let mut content = String::new();
        for rec in records {
            let line = serde_json::to_string(rec).map_err(|e| AdapterError::Api(e.to_string()))?;
            content.push_str(&line);
            content.push('\n');
        }
        fs::write(data_dir.join("records.jsonl"), content)
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        meta.version += 1;
        let meta_json =
            serde_json::to_string_pretty(meta).map_err(|e| AdapterError::Api(e.to_string()))?;
        fs::write(table_dir.join("_embedbay_schema.json"), meta_json)
            .map_err(|e| AdapterError::Api(e.to_string()))?;

        // Emit minimal Lance protobuf manifest so _versions/*.manifest stays present
        let manifest_bytes = encode_minimal_lance_manifest(meta.version);
        let manifest_path = versions_dir.join(format!("{}.manifest", meta.version));
        fs::write(manifest_path, manifest_bytes).map_err(|e| AdapterError::Api(e.to_string()))?;

        Ok(())
    }

    fn read_table_meta(&self, table_dir: &Path) -> LanceCollectionMeta {
        let schema_file = table_dir.join("_embedbay_schema.json");
        if let Ok(raw) = fs::read_to_string(&schema_file) {
            if let Ok(meta) = serde_json::from_str::<LanceCollectionMeta>(&raw) {
                return meta;
            }
        }

        // External .lance directory fallback: inspect _versions/*.manifest
        let manifest_info = inspect_latest_lance_manifest(&table_dir.join("_versions"));
        LanceCollectionMeta {
            dimensions: 0,
            distance_metric: "cosine".to_string(),
            version: manifest_info.version.max(1),
        }
    }
}

#[derive(Debug, Default)]
pub struct DecodedLanceManifest {
    pub version: u64,
    pub field_names: Vec<String>,
    pub fragment_count: usize,
}

/// Minimal pure-Rust protobuf wire decoder for Lance `_versions/*.manifest` files
/// (avoids needing `protoc` on Windows while reading external `.lance` table metadata).
pub fn inspect_latest_lance_manifest(versions_dir: &Path) -> DecodedLanceManifest {
    let Ok(entries) = fs::read_dir(versions_dir) else {
        return DecodedLanceManifest::default();
    };
    let mut best: Option<(u64, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("manifest") {
            let num = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
            if best.as_ref().map(|(n, _)| num >= *n).unwrap_or(true) {
                best = Some((num, path));
            }
        }
    }
    let Some((file_ver, path)) = best else {
        return DecodedLanceManifest::default();
    };
    let Ok(bytes) = fs::read(&path) else {
        return DecodedLanceManifest {
            version: file_ver,
            ..Default::default()
        };
    };

    let mut decoded = decode_lance_manifest_bytes(&bytes);
    if decoded.version == 0 {
        decoded.version = file_ver;
    }
    decoded
}

fn encode_varint(mut v: u64, out: &mut Vec<u8>) {
    loop {
        let byte = (v & 0x7F) as u8;
        v >>= 7;
        if v == 0 {
            out.push(byte);
            break;
        } else {
            out.push(byte | 0x80);
        }
    }
}

fn encode_minimal_lance_manifest(version: u64) -> Vec<u8> {
    let mut buf = Vec::new();
    // Lance Manifest field 2 (varint): version
    buf.push((2 << 3) | 0);
    encode_varint(version, &mut buf);
    buf
}

fn read_varint(bytes: &[u8], pos: &mut usize) -> Option<u64> {
    let mut val = 0u64;
    let mut shift = 0u32;
    while *pos < bytes.len() && shift < 64 {
        let b = bytes[*pos];
        *pos += 1;
        val |= ((b & 0x7F) as u64) << shift;
        if b & 0x80 == 0 {
            return Some(val);
        }
        shift += 7;
    }
    None
}

fn decode_lance_manifest_bytes(bytes: &[u8]) -> DecodedLanceManifest {
    let mut out = DecodedLanceManifest::default();
    let mut pos = 0usize;

    while pos < bytes.len() {
        let Some(tag) = read_varint(bytes, &mut pos) else {
            break;
        };
        let field_num = tag >> 3;
        let wire_type = tag & 0x07;
        match wire_type {
            0 => {
                let Some(val) = read_varint(bytes, &mut pos) else {
                    break;
                };
                if field_num == 2 {
                    out.version = val;
                }
            }
            2 => {
                let Some(len) = read_varint(bytes, &mut pos) else {
                    break;
                };
                let end = pos.saturating_add(len as usize).min(bytes.len());
                let slice = &bytes[pos..end];
                pos = end;
                // Field 1: repeated Field (submessage with field 2 = name string)
                if field_num == 1 {
                    if let Some(name) = extract_proto_string_field(slice, 2) {
                        out.field_names.push(name);
                    }
                } else if field_num == 3 {
                    // Field 3: repeated DataFragment
                    out.fragment_count += 1;
                }
            }
            1 => pos = pos.saturating_add(8).min(bytes.len()),
            5 => pos = pos.saturating_add(4).min(bytes.len()),
            _ => break,
        }
    }
    out
}

fn extract_proto_string_field(bytes: &[u8], target_field: u64) -> Option<String> {
    let mut pos = 0usize;
    while pos < bytes.len() {
        let tag = read_varint(bytes, &mut pos)?;
        let f = tag >> 3;
        let wt = tag & 0x07;
        match wt {
            0 => {
                let _ = read_varint(bytes, &mut pos)?;
            }
            2 => {
                let len = read_varint(bytes, &mut pos)? as usize;
                let end = pos.saturating_add(len).min(bytes.len());
                let slice = &bytes[pos..end];
                pos = end;
                if f == target_field {
                    return String::from_utf8(slice.to_vec()).ok();
                }
            }
            1 => pos = pos.saturating_add(8).min(bytes.len()),
            5 => pos = pos.saturating_add(4).min(bytes.len()),
            _ => break,
        }
    }
    None
}

fn matches_filter(rec: &VectorRecord, spec: &FilterSpec) -> bool {
    match spec {
        FilterSpec::RawJson { json } => {
            if let Some(obj) = json.as_object() {
                for (k, v) in obj {
                    if rec.payload.get(k) != Some(v) {
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
                FilterLogic::And => conditions.iter().all(|c| matches_condition(rec, c)),
                FilterLogic::Or => conditions.iter().any(|c| matches_condition(rec, c)),
            }
        }
    }
}

fn matches_condition(rec: &VectorRecord, cond: &FilterCondition) -> bool {
    let field = cond.field.trim();
    if field.is_empty() {
        return true;
    }
    let val = rec.payload.get(field);
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

fn similarity_score(a: &[f32], b: &[f32], metric: &str) -> f32 {
    let len = a.len().min(b.len());
    if len == 0 {
        return 0.0;
    }
    match metric.to_ascii_lowercase().as_str() {
        "dot" | "ip" => a[..len].iter().zip(&b[..len]).map(|(x, y)| x * y).sum(),
        "euclidean" | "l2" => {
            let sq: f32 = a[..len]
                .iter()
                .zip(&b[..len])
                .map(|(x, y)| {
                    let d = x - y;
                    d * d
                })
                .sum();
            1.0 / (1.0 + sq.sqrt())
        }
        _ => {
            let mut dot = 0.0f32;
            let mut na = 0.0f32;
            let mut nb = 0.0f32;
            for i in 0..len {
                dot += a[i] * b[i];
                na += a[i] * a[i];
                nb += b[i] * b[i];
            }
            let denom = na.sqrt() * nb.sqrt();
            if denom <= 1e-12 {
                0.0
            } else {
                dot / denom
            }
        }
    }
}

#[async_trait]
impl VectorDbAdapter for LanceDbAdapter {
    async fn test_connection(&self) -> Result<ConnectionTestResult, AdapterError> {
        let count = self.list_table_dirs().len();
        Ok(ConnectionTestResult {
            ok: true,
            latency_ms: 0,
            engine_version: Some("embedded-1.0".to_string()),
            message: format!(
                "LanceDB embedded directory ready ({} table(s) at {})",
                count,
                self.root_dir.display()
            ),
        })
    }

    async fn list_collections(&self) -> Result<Vec<CollectionSummary>, AdapterError> {
        let tables = self.list_table_dirs();
        let mut out = Vec::with_capacity(tables.len());
        for (name, path) in tables {
            let meta = self.read_table_meta(&path);
            let recs = self.read_records_file(&path).unwrap_or_default();
            let dims = if meta.dimensions > 0 {
                Some(meta.dimensions)
            } else {
                recs.first().and_then(|r| r.vector.as_ref()).map(|v| v.len())
            };
            out.push(CollectionSummary {
                name,
                vector_count: Some(recs.len() as u64),
                dimensions: dims,
                distance_metric: Some(meta.distance_metric),
            });
        }
        Ok(out)
    }

    async fn get_collection_info(&self, collection: &str) -> Result<CollectionSchema, AdapterError> {
        let dir = self.resolve_table_dir(collection)?;
        if !dir.is_dir() {
            return Err(AdapterError::NotFound(format!(
                "LanceDB table '{}' not found",
                collection
            )));
        }
        let meta = self.read_table_meta(&dir);
        let manifest = inspect_latest_lance_manifest(&dir.join("_versions"));
        let recs = self.read_records_file(&dir)?;

        let dims = if meta.dimensions > 0 {
            Some(meta.dimensions)
        } else {
            recs.first().and_then(|r| r.vector.as_ref()).map(|v| v.len())
        };

        let mut field_types = BTreeMap::new();
        for fname in manifest.field_names {
            field_types.insert(fname, "lance_column".to_string());
        }
        for rec in recs.iter().take(20) {
            if let Some(obj) = rec.payload.as_object() {
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
                    field_types.entry(k.clone()).or_insert_with(|| dt.to_string());
                }
            }
        }

        Ok(CollectionSchema {
            name: collection.to_string(),
            vector_count: recs.len() as u64,
            dimensions: dims,
            distance_metric: Some(meta.distance_metric),
            index_type: Some("Lance Columnar".to_string()),
            segment_count: Some(manifest.fragment_count.max(1)),
            disk_bytes: Some(dir_size_bytes(&dir)),
            vector_field_name: Some("vector".to_string()),
            payload_fields: field_types
                .into_iter()
                .map(|(name, data_type)| PayloadFieldSchema { name, data_type })
                .collect(),
        })
    }

    async fn create_collection(&self, req: CreateCollectionRequest) -> Result<(), AdapterError> {
        let dir = self.resolve_table_dir(&req.name)?;
        if dir.exists() {
            return Err(AdapterError::InvalidRequest(format!(
                "Table '{}' already exists",
                req.name
            )));
        }
        fs::create_dir_all(&dir).map_err(|e| AdapterError::Api(e.to_string()))?;
        let mut meta = LanceCollectionMeta {
            dimensions: req.dimensions.max(1),
            distance_metric: req.distance_metric,
            version: 0,
        };
        self.write_records_file(&dir, &[], &mut meta)
    }

    async fn delete_collection(&self, collection: &str) -> Result<(), AdapterError> {
        let dir = self.resolve_table_dir(collection)?;
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| AdapterError::Api(e.to_string()))?;
        }
        Ok(())
    }

    async fn browse_records(
        &self,
        collection: &str,
        req: BrowseRecordsRequest,
    ) -> Result<BrowseRecordsResponse, AdapterError> {
        let dir = self.resolve_table_dir(collection)?;
        if !dir.is_dir() {
            return Err(AdapterError::NotFound(format!(
                "Table '{}' not found",
                collection
            )));
        }
        let all = self.read_records_file(&dir)?;
        let filtered: Vec<VectorRecord> = all
            .into_iter()
            .filter(|r| req.filter.as_ref().map(|f| matches_filter(r, f)).unwrap_or(true))
            .collect();
        let total = filtered.len() as u64;
        let slice = filtered
            .into_iter()
            .skip(req.offset)
            .take(req.limit.clamp(1, 1000))
            .map(|mut r| {
                if !req.include_vectors {
                    r.vector = None;
                }
                r
            })
            .collect();

        Ok(BrowseRecordsResponse {
            records: slice,
            next_cursor: None,
            total_count: Some(total),
        })
    }

    async fn upsert_records(
        &self,
        collection: &str,
        records: Vec<VectorRecord>,
    ) -> Result<usize, AdapterError> {
        let dir = self.resolve_table_dir(collection)?;
        if !dir.is_dir() {
            return Err(AdapterError::NotFound(format!(
                "Table '{}' not found",
                collection
            )));
        }
        let mut meta = self.read_table_meta(&dir);
        let mut existing = self.read_records_file(&dir)?;
        let mut by_id: HashMap<String, usize> = existing
            .iter()
            .enumerate()
            .map(|(i, r)| (r.id.clone(), i))
            .collect();

        let count = records.len();
        for rec in records {
            if let Some(&idx) = by_id.get(&rec.id) {
                existing[idx] = rec;
            } else {
                by_id.insert(rec.id.clone(), existing.len());
                existing.push(rec);
            }
        }

        self.write_records_file(&dir, &existing, &mut meta)?;
        Ok(count)
    }

    async fn delete_records(
        &self,
        collection: &str,
        ids: Vec<String>,
    ) -> Result<usize, AdapterError> {
        let dir = self.resolve_table_dir(collection)?;
        if !dir.is_dir() {
            return Err(AdapterError::NotFound(format!(
                "Table '{}' not found",
                collection
            )));
        }
        let mut meta = self.read_table_meta(&dir);
        let existing = self.read_records_file(&dir)?;
        let before = existing.len();
        let remaining: Vec<VectorRecord> = existing
            .into_iter()
            .filter(|r| !ids.contains(&r.id))
            .collect();
        let deleted = before.saturating_sub(remaining.len());
        self.write_records_file(&dir, &remaining, &mut meta)?;
        Ok(deleted)
    }

    async fn search_vectors(
        &self,
        collection: &str,
        req: SearchRequest,
    ) -> Result<SearchResponse, AdapterError> {
        let start = std::time::Instant::now();
        let dir = self.resolve_table_dir(collection)?;
        if !dir.is_dir() {
            return Err(AdapterError::NotFound(format!(
                "Table '{}' not found",
                collection
            )));
        }
        let meta = self.read_table_meta(&dir);
        let recs = self.read_records_file(&dir)?;

        let mut scored: Vec<VectorRecord> = recs
            .into_iter()
            .filter(|r| req.filter.as_ref().map(|f| matches_filter(r, f)).unwrap_or(true))
            .filter_map(|mut r| {
                let vec = r.vector.as_ref()?;
                let sc = similarity_score(&req.vector, vec, &meta.distance_metric);
                if let Some(thresh) = req.score_threshold {
                    if sc < thresh {
                        return None;
                    }
                }
                if !req.include_vectors {
                    r.vector = None;
                }
                r.score = Some(sc);
                Some(r)
            })
            .collect();

        scored.sort_by(|a, b| {
            b.score
                .unwrap_or(0.0)
                .partial_cmp(&a.score.unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(req.top_k.clamp(1, 500));

        Ok(SearchResponse {
            records: scored,
            latency_ms: start.elapsed().as_millis() as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lancedb_embedded_crud_filter_and_search_roundtrip() {
        let dir = tempfile::tempdir().expect("temp dir");
        let adapter = LanceDbAdapter::new(dir.path().to_path_buf()).expect("lancedb init");

        adapter
            .create_collection(CreateCollectionRequest {
                name: "articles".to_string(),
                dimensions: 3,
                distance_metric: "cosine".to_string(),
                index_type: None,
            })
            .await
            .expect("create collection");

        assert!(dir.path().join("articles.lance").join("_versions").is_dir());

        let cols = adapter.list_collections().await.expect("list");
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "articles");

        adapter
            .upsert_records(
                "articles",
                vec![
                    VectorRecord {
                        id: "a1".to_string(),
                        payload: json!({"topic": "rust", "year": 2026}),
                        document: Some("Rust vector search".to_string()),
                        vector: Some(vec![1.0, 0.0, 0.0]),
                        score: None,
                    },
                    VectorRecord {
                        id: "a2".to_string(),
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
                "articles",
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
            .expect("browse filtered");
        assert_eq!(browsed.records.len(), 1);
        assert_eq!(browsed.records[0].id, "a1");

        let searched = adapter
            .search_vectors(
                "articles",
                SearchRequest {
                    vector: vec![0.95, 0.05, 0.0],
                    top_k: 2,
                    score_threshold: Some(0.5),
                    include_vectors: false,
                    filter: None,
                },
            )
            .await
            .expect("search");
        assert_eq!(searched.records.len(), 1);
        assert_eq!(searched.records[0].id, "a1");

        let deleted = adapter
            .delete_records("articles", vec!["a2".to_string()])
            .await
            .expect("delete");
        assert_eq!(deleted, 1);

        let info = adapter.get_collection_info("articles").await.expect("info");
        assert_eq!(info.vector_count, 1);
        assert_eq!(info.dimensions, Some(3));
    }
}
