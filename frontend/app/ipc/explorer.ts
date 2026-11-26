import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/ipc/system";
import type {
  BrowseRecordsRequest,
  BrowseRecordsResponse,
  CollectionIndexInfo,
  CollectionSchema,
  CollectionSummary,
  ConnectionTarget,
  ConnectionTestResult,
  CreateCollectionRequest,
  CreateIndexRequest,
  SaveSearchHistoryPayload,
  SaveSearchPresetPayload,
  SearchHistoryItem,
  SearchPreset,
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

export async function listSearchHistory(
  connectionKey: string,
  collection: string,
  limit?: number,
): Promise<SearchHistoryItem[]> {
  if (!isTauriRuntime()) return [];
  return invoke<SearchHistoryItem[]>("list_search_history", {
    connectionKey,
    collection,
    limit,
  });
}

export async function recordSearchHistory(
  payload: SaveSearchHistoryPayload,
): Promise<SearchHistoryItem> {
  return invoke<SearchHistoryItem>("record_search_history", { payload });
}

export async function clearSearchHistory(
  connectionKey: string,
  collection: string,
): Promise<number> {
  return invoke<number>("clear_search_history", {
    connectionKey,
    collection,
  });
}

export async function listSearchPresets(
  connectionKey: string,
  collection: string,
): Promise<SearchPreset[]> {
  if (!isTauriRuntime()) return [];
  return invoke<SearchPreset[]>("list_search_presets", {
    connectionKey,
    collection,
  });
}

export async function saveSearchPreset(
  payload: SaveSearchPresetPayload,
): Promise<SearchPreset> {
  return invoke<SearchPreset>("save_search_preset", { payload });
}

export async function deleteSearchPreset(id: string): Promise<boolean> {
  return invoke<boolean>("delete_search_preset", { id });
}

export async function listCollectionIndexes(
  target: ConnectionTarget,
  collection: string,
): Promise<CollectionIndexInfo[]> {
  if (!isTauriRuntime()) return [];
  return invoke<CollectionIndexInfo[]>("list_collection_indexes", {
    target,
    collection,
  });
}

export async function createCollectionIndex(
  target: ConnectionTarget,
  collection: string,
  request: CreateIndexRequest,
): Promise<void> {
  return invoke<void>("create_collection_index", {
    target,
    collection,
    request,
  });
}

export async function deleteCollectionIndex(
  target: ConnectionTarget,
  collection: string,
  indexName: string,
): Promise<void> {
  return invoke<void>("delete_collection_index", {
    target,
    collection,
    indexName,
  });
}
