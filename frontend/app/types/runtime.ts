export type ArchiveType = "zip" | "tar_gz" | "binary";

export type InstanceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error"
  | "embedded";

export interface CatalogVersionView {
  version: string;
  recommended: boolean;
  size_bytes: number;
  sha256: string;
  archive_type: ArchiveType;
  installed: boolean;
  installed_id: string | null;
}

export interface CatalogEngineView {
  engine_type: string;
  display_name: string;
  description: string;
  tier: number;
  embedded: boolean;
  default_port: number;
  default_grpc_port: number | null;
  versions: CatalogVersionView[];
}

export interface InstalledEngine {
  id: string;
  engine_type: string;
  version: string;
  target_triple: string;
  binary_path: string;
  sha256: string;
  installed_at: number;
}

export interface InstallProgressEvent {
  engine_type: string;
  version: string;
  stage: string;
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
  message: string;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
  is_collapsed: boolean;
  created_at: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface InstanceRecord {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  group_id: string | null;
  engine_type: string;
  engine_version: string;
  host: string;
  port: number;
  grpc_port: number | null;
  data_dir: string;
  config_json: string;
  auto_start: boolean;
  idle_timeout_minutes: number;
  sort_order: number;
  created_at: number;
  tag_ids: string[];
}

export interface CreateInstancePayload {
  name: string;
  description?: string | null;
  color?: string | null;
  group_id?: string | null;
  engine_type: string;
  engine_version: string;
  host?: string;
  port: number;
  grpc_port?: number | null;
  data_dir?: string | null;
  config_json?: string;
  auto_start?: boolean;
  idle_timeout_minutes?: number;
  tag_ids?: string[];
}

export interface UpdateInstancePayload {
  name?: string;
  description?: string | null;
  color?: string | null;
  group_id?: string | null;
  engine_version?: string;
  host?: string;
  port?: number;
  grpc_port?: number | null;
  data_dir?: string;
  config_json?: string;
  auto_start?: boolean;
  idle_timeout_minutes?: number;
  sort_order?: number;
  tag_ids?: string[];
}

export interface InstanceMetrics {
  instance_id: string;
  status: InstanceStatus;
  pid: number | null;
  ram_bytes: number;
  cpu_percent: number;
  uptime_secs: number;
  disk_bytes: number;
  restart_count: number;
  last_error: string | null;
  last_activity_at: number;
}

export interface SystemMetricsSummary {
  total_ram_bytes: number;
  running_count: number;
  instances: Record<string, InstanceMetrics>;
}

export interface LogEntry {
  timestamp_ms: number;
  stream: string;
  message: string;
}

export interface InstanceLogEvent {
  instance_id: string;
  entry: LogEntry;
}

export interface InstanceStatusChangedEvent {
  instance_id: string;
  status: InstanceStatus;
  pid: number | null;
  last_error: string | null;
}

export interface BatchActionResult {
  instance_id: string;
  name: string;
  ok: boolean;
  error: string | null;
}

export interface ReorderItem {
  entity_type: "group" | "instance" | "remote_connection";
  id: string;
  sort_order: number;
  group_id?: string | null;
}

export interface InstalledEngineStorage {
  id: string;
  engine_type: string;
  version: string;
  binary_path: string;
  size_bytes: number;
  in_use_by: string[];
}

export interface InstanceStorage {
  instance_id: string;
  name: string;
  engine_type: string;
  data_dir: string;
  size_bytes: number;
}

export interface StorageUsageSummary {
  data_root: string;
  total_engine_bytes: number;
  unused_engine_bytes: number;
  unused_engine_count: number;
  total_instance_bytes: number;
  engines: InstalledEngineStorage[];
  instances: InstanceStorage[];
}

export interface CleanupResult {
  removed_count: number;
  freed_bytes: number;
  removed_ids: string[];
  skipped: string[];
}
