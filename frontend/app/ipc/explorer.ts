import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/ipc/system";
import type {
  BrowseRecordsRequest,
  BrowseRecordsResponse,
  CollectionSchema,
  CollectionSummary,
  ConnectionTarget,
  ConnectionTestResult,
  CreateCollectionRequest,
  SearchRequest,
  SearchResponse,
  VectorRecord,
} from "@/types/explorer";

export async function testConnection(
  target: ConnectionTarget,
): Promise<ConnectionTestResult> {
  return invoke<ConnectionTestResult>("test_connection", { target });
}

export async function listCollections(
  target: ConnectionTarget,
): Promise<CollectionSummary[]> {
  if (!isTauriRuntime()) return [];
  return invoke<CollectionSummary[]>("list_collections", { target });
}

export async function getCollectionInfo(
  target: ConnectionTarget,
  collection: string,
): Promise<CollectionSchema> {
  return invoke<CollectionSchema>("get_collection_info", {
    target,
    collection,
  });
}

export async function createCollection(
  target: ConnectionTarget,
  request: CreateCollectionRequest,
): Promise<void> {
  return invoke<void>("create_collection", { target, request });
}

export async function deleteCollection(
  target: ConnectionTarget,
  collection: string,
): Promise<void> {
  return invoke<void>("delete_collection", { target, collection });
}

export async function browseRecords(
  target: ConnectionTarget,
  collection: string,
  request: BrowseRecordsRequest,
): Promise<BrowseRecordsResponse> {
  return invoke<BrowseRecordsResponse>("browse_records", {
    target,
    collection,
    request,
  });
}

export async function upsertRecords(
  target: ConnectionTarget,
  collection: string,
  records: VectorRecord[],
): Promise<number> {
  return invoke<number>("upsert_records", { target, collection, records });
}

export async function deleteRecords(
  target: ConnectionTarget,
  collection: string,
  ids: string[],
): Promise<number> {
  return invoke<number>("delete_records", { target, collection, ids });
}

export async function searchVectors(
  target: ConnectionTarget,
  collection: string,
  query: SearchRequest,
): Promise<SearchResponse> {
  return invoke<SearchResponse>("search_vectors", {
    target,
    collection,
    query,
  });
}
