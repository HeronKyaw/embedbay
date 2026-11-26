import { invoke } from "@tauri-apps/api/core";
import type { ConnectionTarget, FilterSpec, VectorRecord } from "@/types/explorer";

export type TransferFormat = "jsonl" | "csv";

export interface ImportOptions {
  id_field?: string | null;
  vector_field?: string | null;
  text_field?: string | null;
  embedding_profile_id?: string | null;
}

export interface ImportResult {
  imported: number;
  failed: number;
  errors: string[];
}

export interface ExportResult {
  exported: number;
  dest_path: string;
}

export interface TransferProgressEvent {
  kind: string;
  processed: number;
  total: number;
  message: string;
}

export interface MigrateCollectionRequest {
  source_target: ConnectionTarget;
  source_collection: string;
  dest_target: ConnectionTarget;
  dest_collection: string;
  create_dest_if_missing: boolean;
  dest_dimensions?: number | null;
  dest_distance_metric?: string | null;
  filter?: FilterSpec | null;
  reembed_profile_id?: string | null;
  reembed_text_field?: string | null;
  batch_size?: number | null;
  max_records?: number | null;
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export type ChunkStrategy = "recursive" | "markdown_headers";

export interface ChunkOptions {
  strategy: ChunkStrategy;
  chunk_size: number;
  chunk_overlap: number;
}

export interface DocumentChunk {
  source_file: string;
  file_name: string;
  chunk_index: number;
  heading: string | null;
  text: string;
  char_count: number;
}

export interface DocumentChunkPreview {
  total_files: number;
  total_chunks: number;
  avg_chunk_length: number;
  chunks: DocumentChunk[];
}

export interface IngestResult {
  files_processed: number;
  chunks_ingested: number;
  failed: number;
  errors: string[];
}

export async function importRecords(
  target: ConnectionTarget,
  collection: string,
  filePath: string,
  format: TransferFormat,
  options: ImportOptions,
): Promise<ImportResult> {
  return invoke<ImportResult>("import_records", {
    target,
    collection,
    filePath,
    format,
    options,
  });
}

export async function exportRecords(
  target: ConnectionTarget,
  collection: string,
  destPath: string,
  format: TransferFormat,
  includeVectors: boolean,
  limit?: number,
  filter?: FilterSpec | null,
): Promise<ExportResult> {
  return invoke<ExportResult>("export_records", {
    target,
    collection,
    destPath,
    format,
    includeVectors,
    limit,
    filter,
  });
}

export async function exportSearchResults(
  records: VectorRecord[],
  destPath: string,
  format: TransferFormat,
  includeVectors: boolean,
): Promise<ExportResult> {
  return invoke<ExportResult>("export_search_results", {
    records,
    destPath,
    format,
    includeVectors,
  });
}

export async function migrateCollection(
  request: MigrateCollectionRequest,
): Promise<MigrationResult> {
  return invoke<MigrationResult>("migrate_collection", { request });
}

export async function previewDocumentChunks(
  paths: string[],
  options: ChunkOptions,
): Promise<DocumentChunkPreview> {
  return invoke<DocumentChunkPreview>("preview_document_chunks", {
    paths,
    options,
  });
}

export async function ingestDocuments(
  target: ConnectionTarget,
  collection: string,
  paths: string[],
  options: ChunkOptions,
  embeddingProfileId: string,
): Promise<IngestResult> {
  return invoke<IngestResult>("ingest_documents", {
    target,
    collection,
    paths,
    options,
    embeddingProfileId,
  });
}
