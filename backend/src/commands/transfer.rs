use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::adapters::embeddings;
use crate::adapters::{resolve_adapter, BrowseRecordsRequest, ConnectionTarget, FilterSpec, VectorRecord};
use crate::platform::secrets;
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
}
