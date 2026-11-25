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
