use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::adapters::embeddings;
use crate::adapters::{
    assert_writable, resolve_adapter, BrowseRecordsRequest, ConnectionTarget,
    CreateCollectionRequest, FilterSpec, VectorRecord,
};
use crate::db::Database;
use crate::platform::secrets;
use crate::supervisor::process_manager::ProcessManager;
use crate::supervisor::EventSink;
use crate::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferFormat {
    Jsonl,
    Csv,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportOptions {
    pub id_field: Option<String>,
    pub vector_field: Option<String>,
    pub text_field: Option<String>,
    pub embedding_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub imported: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportResult {
    pub exported: usize,
    pub dest_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferProgressEvent {
    pub kind: String,
    pub processed: usize,
    pub total: usize,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MigrateCollectionRequest {
    pub source_target: ConnectionTarget,
    pub source_collection: String,
    pub dest_target: ConnectionTarget,
    pub dest_collection: String,
    #[serde(default = "default_true")]
    pub create_dest_if_missing: bool,
    pub dest_dimensions: Option<usize>,
    pub dest_distance_metric: Option<String>,
    pub filter: Option<FilterSpec>,
    pub reembed_profile_id: Option<String>,
    pub reembed_text_field: Option<String>,
    pub batch_size: Option<usize>,
    pub max_records: Option<usize>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct MigrationResult {
    pub migrated: usize,
    pub skipped: usize,
    pub failed: usize,
    pub errors: Vec<String>,
}

fn emit_transfer_progress(sink: Option<&dyn EventSink>, evt: TransferProgressEvent) {
    if let Some(s) = sink {
        if let Ok(val) = serde_json::to_value(evt) {
            s.emit_json("transfer-progress", val);
        }
    }
}

pub fn parse_import_rows(
    file_path: &Path,
    format: &TransferFormat,
    options: &ImportOptions,
) -> Result<(Vec<VectorRecord>, Vec<String>, Vec<String>), String> {
    let mut records = Vec::new();
    let mut texts_to_embed = Vec::new();
    let mut errors = Vec::new();

    let id_col = options
        .id_field
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("id");
    let vec_col = options
        .vector_field
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("vector");
    let text_col = options
        .text_field
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    match format {
        TransferFormat::Jsonl => {
            let file = File::open(file_path).map_err(|e| e.to_string())?;
            let reader = BufReader::new(file);
            for (idx, line_res) in reader.lines().enumerate() {
                let line = match line_res {
                    Ok(l) => l,
                    Err(e) => {
                        errors.push(format!("Line {}: {}", idx + 1, e));
                        continue;
                    }
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(mut val) = serde_json::from_str::<Value>(trimmed) else {
                    errors.push(format!("Line {}: invalid JSON", idx + 1));
                    continue;
                };
                let Some(obj) = val.as_object_mut() else {
                    errors.push(format!("Line {}: JSON value must be an object", idx + 1));
                    continue;
                };

                let rec_id = obj
                    .remove(id_col)
                    .and_then(|v| match v {
                        Value::String(s) => Some(s),
                        Value::Number(n) => Some(n.to_string()),
                        _ => None,
                    })
                    .unwrap_or_else(|| Uuid::new_v4().to_string());

                let vector = obj.remove(vec_col).and_then(|v| {
                    v.as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|n| n.as_f64().map(|f| f as f32))
                            .collect::<Vec<f32>>()
                    })
                });

                let doc_text = text_col
                    .and_then(|col| obj.get(col).and_then(|v| v.as_str()).map(ToString::to_string))
                    .or_else(|| {
                        obj.get("document")
                            .or_else(|| obj.get("text"))
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string)
                    });

                let payload = obj
                    .remove("payload")
                    .filter(|v| v.is_object())
                    .unwrap_or(Value::Object(obj.clone()));

                texts_to_embed.push(doc_text.clone().unwrap_or_default());
                records.push(VectorRecord {
                    id: rec_id,
                    payload,
                    document: doc_text,
                    vector,
                    score: None,
                });
            }
        }
        TransferFormat::Csv => {
            let mut rdr = csv::Reader::from_path(file_path).map_err(|e| e.to_string())?;
            let headers = rdr.headers().map_err(|e| e.to_string())?.clone();
            for (idx, row_res) in rdr.records().enumerate() {
                let row = match row_res {
                    Ok(r) => r,
                    Err(e) => {
                        errors.push(format!("Row {}: {}", idx + 1, e));
                        continue;
                    }
                };
                let mut map = serde_json::Map::new();
                let mut rec_id: Option<String> = None;
                let mut vector: Option<Vec<f32>> = None;
                let mut doc_text: Option<String> = None;

                for (col_idx, h) in headers.iter().enumerate() {
                    let cell = row.get(col_idx).unwrap_or("");
                    if h == id_col && !cell.trim().is_empty() {
                        rec_id = Some(cell.trim().to_string());
                    } else if h == vec_col && !cell.trim().is_empty() {
                        if let Ok(parsed) = serde_json::from_str::<Vec<f32>>(cell) {
                            vector = Some(parsed);
                        }
                    } else {
                        if text_col == Some(h) || h == "document" || h == "text" {
                            if !cell.is_empty() {
                                doc_text = Some(cell.to_string());
                            }
                        }
                        if let Ok(num) = cell.parse::<f64>() {
                            if cell.contains('.') {
                                map.insert(h.to_string(), json!(num));
                            } else if let Ok(int_val) = cell.parse::<i64>() {
                                map.insert(h.to_string(), json!(int_val));
                            } else {
                                map.insert(h.to_string(), json!(num));
                            }
                        } else if cell == "true" || cell == "false" {
                            map.insert(h.to_string(), json!(cell == "true"));
                        } else {
                            map.insert(h.to_string(), json!(cell));
                        }
                    }
                }

                texts_to_embed.push(doc_text.clone().unwrap_or_default());
                records.push(VectorRecord {
                    id: rec_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
                    payload: Value::Object(map),
                    document: doc_text,
                    vector,
                    score: None,
                });
            }
        }
    }

    Ok((records, texts_to_embed, errors))
}

pub fn write_records_to_file(
    records: &[VectorRecord],
    dest_path: &Path,
    format: &TransferFormat,
    include_vectors: bool,
) -> Result<usize, String> {
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    match format {
        TransferFormat::Jsonl => {
            let mut file = File::create(dest_path).map_err(|e| e.to_string())?;
            for rec in records {
                let mut obj = serde_json::Map::new();
                obj.insert("id".to_string(), json!(rec.id));
                obj.insert("payload".to_string(), rec.payload.clone());
                if let Some(doc) = &rec.document {
                    obj.insert("document".to_string(), json!(doc));
                }
                if let Some(score) = rec.score {
                    obj.insert("score".to_string(), json!(score));
                }
                if include_vectors {
                    if let Some(vec) = &rec.vector {
                        obj.insert("vector".to_string(), json!(vec));
                    }
                }
                let line = serde_json::to_string(&Value::Object(obj)).map_err(|e| e.to_string())?;
                writeln!(file, "{}", line).map_err(|e| e.to_string())?;
            }
        }
        TransferFormat::Csv => {
            let mut wtr = csv::Writer::from_path(dest_path).map_err(|e| e.to_string())?;
            let mut headers = vec![
                "id".to_string(),
                "document".to_string(),
                "payload_json".to_string(),
            ];
            if include_vectors {
                headers.push("vector".to_string());
            }
            wtr.write_record(&headers).map_err(|e| e.to_string())?;

            for rec in records {
                let mut row = vec![
                    rec.id.clone(),
                    rec.document.clone().unwrap_or_default(),
                    serde_json::to_string(&rec.payload).unwrap_or_else(|_| "{}".to_string()),
                ];
                if include_vectors {
                    let vec_str = rec
                        .vector
                        .as_ref()
                        .map(|v| serde_json::to_string(v).unwrap_or_default())
                        .unwrap_or_default();
                    row.push(vec_str);
                }
                wtr.write_record(&row).map_err(|e| e.to_string())?;
            }
            wtr.flush().map_err(|e| e.to_string())?;
        }
    }

    Ok(records.len())
}

#[tauri::command]
pub async fn import_records(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    file_path: String,
    format: TransferFormat,
    options: ImportOptions,
) -> Result<ImportResult, String> {
    assert_writable(&state.db, &target)?;

    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;

    let (mut records, texts, mut errors) =
        parse_import_rows(Path::new(&file_path), &format, &options)?;
    let total = records.len();

    if let Some(profile_id) = options
        .embedding_profile_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        let profile = state
            .db
            .get_embedding_profile(profile_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Embedding profile '{}' not found", profile_id))?;
        let api_key = match &profile.secret_ref {
            Some(ref_key) => secrets::get_secret(ref_key)?,
            None => None,
        };

        for start in (0..records.len()).step_by(32) {
            let end = (start + 32).min(records.len());
            let batch_indices: Vec<usize> = (start..end)
                .filter(|&i| records[i].vector.is_none() && !texts[i].trim().is_empty())
                .collect();

            if !batch_indices.is_empty() {
                let batch_texts: Vec<String> =
                    batch_indices.iter().map(|&i| texts[i].clone()).collect();
                let (vecs, _) =
                    embeddings::embed_texts(&profile, api_key.as_deref(), &batch_texts)
                        .await
                        .map_err(|e| e.to_string())?;
                for (pos, rec_idx) in batch_indices.into_iter().enumerate() {
                    if let Some(v) = vecs.get(pos) {
                        records[rec_idx].vector = Some(v.clone());
                    }
                }
            }

            emit_transfer_progress(
                Some(state.event_sink.as_ref()),
                TransferProgressEvent {
                    kind: "import".to_string(),
                    processed: end,
                    total,
                    message: format!("Embedded {}/{} rows", end, total),
                },
            );
        }
    }

    let mut imported = 0usize;
    let mut failed = errors.len();
    for chunk in records.chunks(100) {
        match adapter.upsert_records(&collection, chunk.to_vec()).await {
            Ok(n) => imported += n,
            Err(err) => {
                failed += chunk.len();
                errors.push(err.to_string());
            }
        }
        emit_transfer_progress(
            Some(state.event_sink.as_ref()),
            TransferProgressEvent {
                kind: "import".to_string(),
                processed: imported.min(total),
                total,
                message: format!("Upserted {} records", imported),
            },
        );
    }

    Ok(ImportResult {
        imported,
        failed,
        errors,
    })
}

#[tauri::command]
pub async fn export_records(
    state: State<'_, AppState>,
    target: ConnectionTarget,
    collection: String,
    dest_path: String,
    format: TransferFormat,
    include_vectors: bool,
    limit: Option<usize>,
    filter: Option<FilterSpec>,
) -> Result<ExportResult, String> {
    let adapter = resolve_adapter(&state.db, &state.process_manager, &target)
        .await
        .map_err(|e| e.to_string())?;

    let max_rows = limit.unwrap_or(5000).clamp(1, 50_000);
    let mut collected = Vec::new();
    let mut cursor: Option<String> = None;
    let mut offset = 0usize;

    while collected.len() < max_rows {
        let batch_size = (max_rows - collected.len()).min(500);
        let page = adapter
            .browse_records(
                &collection,
                BrowseRecordsRequest {
                    limit: batch_size,
                    offset,
                    cursor: cursor.clone(),
                    include_vectors,
                    filter: filter.clone(),
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        if page.records.is_empty() {
            break;
        }
        let fetched = page.records.len();
        collected.extend(page.records);
        offset += fetched;
        cursor = page.next_cursor;
        if cursor.is_none() && fetched < batch_size {
            break;
        }
    }

    let exported = write_records_to_file(&collected, Path::new(&dest_path), &format, include_vectors)?;
    Ok(ExportResult {
        exported,
        dest_path,
    })
}

pub fn extract_record_text(rec: &VectorRecord, text_field: Option<&str>) -> Option<String> {
    if let Some(field) = text_field.map(str::trim).filter(|s| !s.is_empty()) {
        if field == "document" {
            if let Some(doc) = rec.document.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                return Some(doc.to_string());
            }
        }
        if let Some(val) = rec.payload.get(field) {
            let txt = match val {
                Value::String(s) => s.trim().to_string(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => b.to_string(),
                _ => String::new(),
            };
            if !txt.is_empty() {
                return Some(txt);
            }
        }
        return None;
    }

    rec.document
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            rec.payload
                .get("document")
                .or_else(|| rec.payload.get("text"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToString::to_string)
        })
}

pub async fn migrate_collection_impl(
    db: &Database,
    pm: &ProcessManager,
    sink: Option<&dyn EventSink>,
    req: MigrateCollectionRequest,
) -> Result<MigrationResult, String> {
    assert_writable(db, &req.dest_target)?;

    let dest_col = req.dest_collection.trim().to_string();
    if dest_col.is_empty() {
        return Err("Destination collection name cannot be empty".to_string());
    }
    let source_col = req.source_collection.trim().to_string();
    if source_col.is_empty() {
        return Err("Source collection name cannot be empty".to_string());
    }

    let source_adapter = resolve_adapter(db, pm, &req.source_target)
        .await
        .map_err(|e| e.to_string())?;
    let dest_adapter = resolve_adapter(db, pm, &req.dest_target)
        .await
        .map_err(|e| e.to_string())?;

    let reembed = match req
        .reembed_profile_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(pid) => {
            let profile = db
                .get_embedding_profile(pid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Embedding profile '{}' not found", pid))?;
            let api_key = match &profile.secret_ref {
                Some(ref_key) => secrets::get_secret(ref_key)?,
                None => None,
            };
            Some((profile, api_key))
        }
        None => None,
    };

    let source_info = source_adapter.get_collection_info(&source_col).await.ok();
    let mut dest_exists = dest_adapter.get_collection_info(&dest_col).await.is_ok();
    let estimated_total = source_info.as_ref().map(|i| i.vector_count as usize).unwrap_or(0);

    let batch_size = req.batch_size.unwrap_or(100).clamp(10, 500);
    let max_records = req.max_records.unwrap_or(50_000).clamp(1, 500_000);
    let total_budget = if estimated_total > 0 {
        estimated_total.min(max_records)
    } else {
        max_records
    };

    let mut migrated = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    let mut errors = Vec::new();
    let mut processed = 0usize;
    let mut cursor: Option<String> = None;
    let mut offset = 0usize;

    while processed < max_records {
        let fetch_limit = (max_records - processed).min(batch_size);
        let page = source_adapter
            .browse_records(
                &source_col,
                BrowseRecordsRequest {
                    limit: fetch_limit,
                    offset,
                    cursor: cursor.clone(),
                    include_vectors: reembed.is_none(),
                    filter: req.filter.clone(),
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        if page.records.is_empty() {
            break;
        }

        let fetched = page.records.len();
        processed += fetched;
        offset += fetched;
        cursor = page.next_cursor.clone();

        let mut records_to_upsert = Vec::new();

        if let Some((ref profile, ref api_key)) = reembed {
            let mut valid_records = Vec::new();
            let mut texts = Vec::new();
            for rec in page.records {
                if let Some(txt) = extract_record_text(&rec, req.reembed_text_field.as_deref()) {
                    texts.push(txt);
                    valid_records.push(rec);
                } else {
                    skipped += 1;
                }
            }

            for chunk_start in (0..valid_records.len()).step_by(32) {
                let chunk_end = (chunk_start + 32).min(valid_records.len());
                let slice_texts = &texts[chunk_start..chunk_end];
                match embeddings::embed_texts(profile, api_key.as_deref(), slice_texts).await {
                    Ok((vecs, _)) => {
                        for (idx, mut rec) in
                            valid_records[chunk_start..chunk_end].iter().cloned().enumerate()
                        {
                            if let Some(v) = vecs.get(idx).filter(|v| !v.is_empty()) {
                                rec.vector = Some(v.clone());
                                records_to_upsert.push(rec);
                            } else {
                                failed += 1;
                                errors.push(format!("Record '{}': empty embedding returned", rec.id));
                            }
                        }
                    }
                    Err(err) => {
                        let count = chunk_end - chunk_start;
                        failed += count;
                        errors.push(format!("Embedding batch failed: {}", err));
                    }
                }
            }
        } else {
            for rec in page.records {
                if rec.vector.as_ref().map(|v| !v.is_empty()).unwrap_or(false) {
                    records_to_upsert.push(rec);
                } else {
                    skipped += 1;
                }
            }
        }

        if !records_to_upsert.is_empty() {
            if !dest_exists && req.create_dest_if_missing {
                let dims = req
                    .dest_dimensions
                    .filter(|&d| d > 0)
                    .or_else(|| {
                        records_to_upsert
                            .iter()
                            .find_map(|r| r.vector.as_ref().map(|v| v.len()))
                    })
                    .or_else(|| {
                        reembed
                            .as_ref()
                            .and_then(|(p, _)| p.dimensions.map(|d| d as usize))
                    })
                    .or_else(|| source_info.as_ref().and_then(|s| s.dimensions))
                    .unwrap_or(384);
                let metric = req
                    .dest_distance_metric
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(ToString::to_string)
                    .or_else(|| {
                        source_info
                            .as_ref()
                            .and_then(|s| s.distance_metric.clone())
                    })
                    .unwrap_or_else(|| "cosine".to_string());

                dest_adapter
                    .create_collection(CreateCollectionRequest {
                        name: dest_col.clone(),
                        dimensions: dims,
                        distance_metric: metric,
                        index_type: None,
                    })
                    .await
                    .map_err(|e| e.to_string())?;
                dest_exists = true;
            }

            match dest_adapter
                .upsert_records(&dest_col, records_to_upsert.clone())
                .await
            {
                Ok(n) => migrated += n,
                Err(err) => {
                    failed += records_to_upsert.len();
                    errors.push(err.to_string());
                }
            }
        }

        emit_transfer_progress(
            sink,
            TransferProgressEvent {
                kind: "migrate".to_string(),
                processed: processed.min(total_budget),
                total: total_budget,
                message: format!(
                    "Migrated {} record(s){}...",
                    migrated,
                    if reembed.is_some() { " (re-embedded)" } else { "" }
                ),
            },
        );

        if cursor.is_none() && fetched < fetch_limit {
            break;
        }
    }

    if !dest_exists && req.create_dest_if_missing && migrated == 0 && skipped == 0 && failed == 0 {
        let dims = req
            .dest_dimensions
            .filter(|&d| d > 0)
            .or_else(|| {
                reembed
                    .as_ref()
                    .and_then(|(p, _)| p.dimensions.map(|d| d as usize))
            })
            .or_else(|| source_info.as_ref().and_then(|s| s.dimensions))
            .unwrap_or(384);
        let metric = req
            .dest_distance_metric
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
            .or_else(|| {
                source_info
                    .as_ref()
                    .and_then(|s| s.distance_metric.clone())
            })
            .unwrap_or_else(|| "cosine".to_string());
        dest_adapter
            .create_collection(CreateCollectionRequest {
                name: dest_col,
                dimensions: dims,
                distance_metric: metric,
                index_type: None,
            })
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(MigrationResult {
        migrated,
        skipped,
        failed,
        errors,
    })
}

#[tauri::command]
pub async fn migrate_collection(
    state: State<'_, AppState>,
    request: MigrateCollectionRequest,
) -> Result<MigrationResult, String> {
    migrate_collection_impl(
        &state.db,
        &state.process_manager,
        Some(state.event_sink.as_ref()),
        request,
    )
    .await
}

#[tauri::command]
pub fn export_search_results(
    records: Vec<VectorRecord>,
    dest_path: String,
    format: TransferFormat,
    include_vectors: bool,
) -> Result<ExportResult, String> {
    let exported = write_records_to_file(&records, Path::new(&dest_path), &format, include_vectors)?;
    Ok(ExportResult {
        exported,
        dest_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonl_and_csv_import_export_roundtrip() {
        let dir = tempfile::tempdir().expect("temp dir");
        let records = vec![
            VectorRecord {
                id: "r1".to_string(),
                payload: json!({"category": "docs"}),
                document: Some("EmbedBay local vectors".to_string()),
                vector: Some(vec![0.1, 0.2, 0.3]),
                score: None,
            },
            VectorRecord {
                id: "r2".to_string(),
                payload: json!({"category": "blog"}),
                document: Some("Zero Docker runtime".to_string()),
                vector: Some(vec![0.4, 0.5, 0.6]),
                score: None,
            },
        ];

        let jsonl_path = dir.path().join("out.jsonl");
        let written_j =
            write_records_to_file(&records, &jsonl_path, &TransferFormat::Jsonl, true)
                .expect("write jsonl");
        assert_eq!(written_j, 2);

        let (parsed_j, texts_j, errs_j) = parse_import_rows(
            &jsonl_path,
            &TransferFormat::Jsonl,
            &ImportOptions {
                id_field: None,
                vector_field: None,
                text_field: Some("document".to_string()),
                embedding_profile_id: None,
            },
        )
        .expect("parse jsonl");
        assert!(errs_j.is_empty());
        assert_eq!(parsed_j.len(), 2);
        assert_eq!(parsed_j[0].id, "r1");
        assert_eq!(texts_j[0], "EmbedBay local vectors");
        assert_eq!(parsed_j[1].vector.as_ref().expect("vec").len(), 3);

        let csv_path = dir.path().join("out.csv");
        write_records_to_file(&records, &csv_path, &TransferFormat::Csv, true).expect("write csv");
        let (parsed_c, _, errs_c) = parse_import_rows(
            &csv_path,
            &TransferFormat::Csv,
            &ImportOptions {
                id_field: None,
                vector_field: None,
                text_field: Some("document".to_string()),
                embedding_profile_id: None,
            },
        )
        .expect("parse csv");
        assert!(errs_c.is_empty());
        assert_eq!(parsed_c.len(), 2);
        assert_eq!(parsed_c[0].id, "r1");
        assert_eq!(parsed_c[0].vector.as_ref().expect("vec").len(), 3);
    }

    #[tokio::test]
    async fn migrate_collection_copies_and_reembeds_between_local_lancedb_instances() {
        use std::sync::Arc;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        use crate::adapters::lancedb::LanceDbAdapter;
        use crate::adapters::VectorDbAdapter;
        use crate::commands::connections::{
            create_embedding_profile_impl, create_remote_connection_impl,
        };
        use crate::db::models::{
            CreateEmbeddingProfilePayload, CreateInstancePayload, CreateRemoteConnectionPayload,
        };
        use crate::supervisor::logs::InstanceLogStore;

        let dir = tempfile::tempdir().expect("temp dir");
        let db = Arc::new(Database::init(dir.path().to_path_buf()).expect("db init"));
        let logs = Arc::new(InstanceLogStore::default());
        let pm = ProcessManager::new(Arc::clone(&db), logs);

        let src_dir = dir.path().join("src_lance");
        let dst_dir = dir.path().join("dst_lance");
        let dst_reembed_dir = dir.path().join("dst_reembed");

        let src_inst = db
            .create_instance(CreateInstancePayload {
                name: "Src Lance".to_string(),
                description: None,
                color: None,
                group_id: None,
                engine_type: "lancedb".to_string(),
                engine_version: "embedded-1.0".to_string(),
                host: None,
                port: 0,
                grpc_port: None,
                data_dir: Some(src_dir.to_string_lossy().into_owned()),
                config_json: None,
                auto_start: None,
                idle_timeout_minutes: None,
                tag_ids: None,
            })
            .expect("create src inst");

        let dst_inst = db
            .create_instance(CreateInstancePayload {
                name: "Dst Lance".to_string(),
                description: None,
                color: None,
                group_id: None,
                engine_type: "lancedb".to_string(),
                engine_version: "embedded-1.0".to_string(),
                host: None,
                port: 0,
                grpc_port: None,
                data_dir: Some(dst_dir.to_string_lossy().into_owned()),
                config_json: None,
                auto_start: None,
                idle_timeout_minutes: None,
                tag_ids: None,
            })
            .expect("create dst inst");

        let dst_reembed_inst = db
            .create_instance(CreateInstancePayload {
                name: "Dst Reembed".to_string(),
                description: None,
                color: None,
                group_id: None,
                engine_type: "lancedb".to_string(),
                engine_version: "embedded-1.0".to_string(),
                host: None,
                port: 0,
                grpc_port: None,
                data_dir: Some(dst_reembed_dir.to_string_lossy().into_owned()),
                config_json: None,
                auto_start: None,
                idle_timeout_minutes: None,
                tag_ids: None,
            })
            .expect("create dst reembed inst");

        let src_adapter = LanceDbAdapter::new(src_dir.clone()).expect("src lance");
        src_adapter
            .create_collection(CreateCollectionRequest {
                name: "notes".to_string(),
                dimensions: 3,
                distance_metric: "cosine".to_string(),
                index_type: None,
            })
            .await
            .expect("create src col");
        src_adapter
            .upsert_records(
                "notes",
                vec![
                    VectorRecord {
                        id: "1".to_string(),
                        payload: json!({"tag": "keep", "body": "First note"}),
                        document: Some("First note".to_string()),
                        vector: Some(vec![1.0, 0.0, 0.0]),
                        score: None,
                    },
                    VectorRecord {
                        id: "2".to_string(),
                        payload: json!({"tag": "skip", "body": "Second note"}),
                        document: Some("Second note".to_string()),
                        vector: Some(vec![0.0, 1.0, 0.0]),
                        score: None,
                    },
                ],
            )
            .await
            .expect("seed src");

        // 1. Direct filtered migration
        let res = migrate_collection_impl(
            &db,
            &pm,
            None,
            MigrateCollectionRequest {
                source_target: ConnectionTarget::LocalInstance {
                    instance_id: src_inst.id.clone(),
                },
                source_collection: "notes".to_string(),
                dest_target: ConnectionTarget::LocalInstance {
                    instance_id: dst_inst.id.clone(),
                },
                dest_collection: "notes_copy".to_string(),
                create_dest_if_missing: true,
                dest_dimensions: None,
                dest_distance_metric: None,
                filter: Some(FilterSpec::RawJson {
                    json: json!({"tag": "keep"}),
                }),
                reembed_profile_id: None,
                reembed_text_field: None,
                batch_size: Some(10),
                max_records: None,
            },
        )
        .await
        .expect("direct migration");
        assert_eq!(res.migrated, 1);
        assert_eq!(res.failed, 0);

        let dst_adapter = LanceDbAdapter::new(dst_dir).expect("dst lance");
        let dst_info = dst_adapter
            .get_collection_info("notes_copy")
            .await
            .expect("dst col info");
        assert_eq!(dst_info.vector_count, 1);
        assert_eq!(dst_info.dimensions, Some(3));

        // 2. Re-embedding migration using a mock embedding server
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = [0u8; 4096];
                let _ = sock.read(&mut buf).await;
                let body = serde_json::to_string(&json!({
                    "embeddings": [[0.2, 0.4, 0.6, 0.8], [0.1, 0.3, 0.5, 0.7]]
                }))
                .expect("json");
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });

        let profile = create_embedding_profile_impl(
            &db,
            CreateEmbeddingProfilePayload {
                name: "Mock 4d".to_string(),
                provider: "ollama".to_string(),
                model_name: "mock".to_string(),
                base_url: Some(format!("http://127.0.0.1:{}", port)),
                dimensions: Some(4),
                api_key: None,
            },
        )
        .expect("create profile");

        let reembed_res = migrate_collection_impl(
            &db,
            &pm,
            None,
            MigrateCollectionRequest {
                source_target: ConnectionTarget::LocalInstance {
                    instance_id: src_inst.id.clone(),
                },
                source_collection: "notes".to_string(),
                dest_target: ConnectionTarget::LocalInstance {
                    instance_id: dst_reembed_inst.id.clone(),
                },
                dest_collection: "notes_4d".to_string(),
                create_dest_if_missing: true,
                dest_dimensions: None,
                dest_distance_metric: Some("dot".to_string()),
                filter: None,
                reembed_profile_id: Some(profile.id.clone()),
                reembed_text_field: Some("body".to_string()),
                batch_size: None,
                max_records: None,
            },
        )
        .await
        .expect("reembed migration");
        assert_eq!(reembed_res.migrated, 2);
        assert_eq!(reembed_res.failed, 0);
        server.abort();

        let reembed_adapter = LanceDbAdapter::new(dst_reembed_dir).expect("dst reembed");
        let reembed_info = reembed_adapter
            .get_collection_info("notes_4d")
            .await
            .expect("reembed info");
        assert_eq!(reembed_info.dimensions, Some(4));
        assert_eq!(reembed_info.distance_metric.as_deref(), Some("dot"));

        // 3. Read-only destination must be blocked
        let ro_conn = create_remote_connection_impl(
            &db,
            CreateRemoteConnectionPayload {
                name: "RO Dest".to_string(),
                description: None,
                color: None,
                group_id: None,
                engine_type: "qdrant".to_string(),
                endpoint_url: "http://127.0.0.1:6333".to_string(),
                auth_type: "none".to_string(),
                secret: None,
                extra_json: None,
                read_only: Some(true),
                tag_ids: None,
            },
        )
        .expect("create ro conn");

        let ro_err = migrate_collection_impl(
            &db,
            &pm,
            None,
            MigrateCollectionRequest {
                source_target: ConnectionTarget::LocalInstance {
                    instance_id: src_inst.id,
                },
                source_collection: "notes".to_string(),
                dest_target: ConnectionTarget::RemoteConnection {
                    connection_id: ro_conn.id,
                },
                dest_collection: "blocked".to_string(),
                create_dest_if_missing: true,
                dest_dimensions: None,
                dest_distance_metric: None,
                filter: None,
                reembed_profile_id: None,
                reembed_text_field: None,
                batch_size: None,
                max_records: None,
            },
        )
        .await
        .expect_err("read-only destination rejected");
        assert!(ro_err.contains("Read-Only"));
    }
}
