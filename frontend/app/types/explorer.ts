export type ConnectionTarget =
  | { kind: "local_instance"; instance_id: string }
  | { kind: "remote_connection"; connection_id: string }
  | {
      kind: "direct";
      engine_type: string;
      endpoint_url: string;
      auth_type: string;
      secret?: string | null;
      extra_json?: string | null;
    };

export interface RemoteConnection {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  group_id: string | null;
  engine_type: string;
  endpoint_url: string;
  auth_type: string;
  secret_ref: string | null;
  extra_json: string;
  sort_order: number;
  created_at: number;
  tag_ids: string[];
}

export interface CreateRemoteConnectionPayload {
  name: string;
  description?: string | null;
  color?: string | null;
  group_id?: string | null;
  engine_type: string;
  endpoint_url: string;
  auth_type: string;
  secret?: string | null;
  extra_json?: string;
  tag_ids?: string[];
}

export interface UpdateRemoteConnectionPayload {
  name?: string;
  description?: string | null;
  color?: string | null;
  group_id?: string | null;
  engine_type?: string;
  endpoint_url?: string;
  auth_type?: string;
  secret?: string | null;
  extra_json?: string;
  sort_order?: number;
  tag_ids?: string[];
}

export interface EmbeddingProfile {
  id: string;
  name: string;
  provider: "ollama" | "openai_compatible" | string;
  model_name: string;
  base_url: string | null;
  dimensions: number | null;
  secret_ref: string | null;
}

export interface CreateEmbeddingProfilePayload {
  name: string;
  provider: string;
  model_name: string;
  base_url?: string | null;
  dimensions?: number | null;
  api_key?: string | null;
}

export interface UpdateEmbeddingProfilePayload {
  name?: string;
  provider?: string;
  model_name?: string;
  base_url?: string | null;
  dimensions?: number | null;
  api_key?: string | null;
}

export interface EmbeddingTestResult {
  ok: boolean;
  dimensions: number;
  latency_ms: number;
  message: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  latency_ms: number;
  engine_version: string | null;
  message: string;
}

export interface CollectionSummary {
  name: string;
  vector_count: number | null;
  dimensions: number | null;
  distance_metric: string | null;
}

export interface PayloadFieldSchema {
  name: string;
  data_type: string;
}

export interface CollectionSchema {
  name: string;
  vector_count: number;
  dimensions: number | null;
  distance_metric: string | null;
  index_type: string | null;
  segment_count: number | null;
  disk_bytes: number | null;
  vector_field_name: string | null;
  payload_fields: PayloadFieldSchema[];
}

export interface CreateCollectionRequest {
  name: string;
  dimensions: number;
  distance_metric: "cosine" | "dot" | "euclidean";
  index_type?: string | null;
}

export interface VectorRecord {
  id: string;
  payload: Record<string, unknown>;
  document?: string | null;
  vector?: number[] | null;
  score?: number | null;
}

export interface FilterCondition {
  field: string;
  op: "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "contains";
  value: unknown;
}

export type FilterSpec =
  | {
      mode: "visual";
      logic: "and" | "or";
      conditions: FilterCondition[];
    }
  | {
      mode: "raw_json";
      json: unknown;
    };

export interface BrowseRecordsRequest {
  limit: number;
  offset?: number;
  cursor?: string | null;
  include_vectors?: boolean;
  filter?: FilterSpec | null;
}

export interface BrowseRecordsResponse {
  records: VectorRecord[];
  next_cursor: string | null;
  total_count: number | null;
}

export interface SearchRequest {
  vector: number[];
  top_k: number;
  score_threshold?: number | null;
  include_vectors?: boolean;
  filter?: FilterSpec | null;
}

export interface SearchResponse {
  records: VectorRecord[];
  latency_ms: number;
}
