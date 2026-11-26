export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type CloseBehavior = "tray" | "quit";

export type ActivitySection = "explorer" | "runtimes" | "store";

export type SettingsTabId =
  | "general"
  | "embeddings"
  | "storage"
  | "diagnostics"
  | "about";

export interface PlatformInfo {
  os: string;
  arch: string;
  target_triple: string;
}

export interface AppStatus {
  app_version: string;
  platform: PlatformInfo;
  data_dir: string;
  db_path: string;
  schema_version: number;
  autostart_enabled: boolean;
  close_behavior: CloseBehavior;
}

export interface WorkspacePreferences {
  defaultSection: ActivitySection;
  defaultPageSize: 25 | 50 | 100 | 200;
  defaultSearchTopK: 5 | 10 | 20 | 50;
  defaultIdleTimeoutMinutes: 0 | 15 | 30 | 60;
  defaultEmbeddingProfileId: string | null;
}

export interface VacuumResult {
  before_bytes: number;
  after_bytes: number;
  freed_bytes: number;
}

export interface TableRowCounts {
  installed_engines: number;
  instances: number;
  remote_connections: number;
  connection_groups: number;
  tags: number;
  embedding_profiles: number;
  search_history: number;
  search_presets: number;
}

export interface SqliteDiagnostics {
  schema_version: number;
  sqlite_version: string;
  journal_mode: string;
  foreign_keys: boolean;
  quick_check: string;
  db_bytes: number;
  wal_bytes: number;
  shm_bytes: number;
  table_counts: TableRowCounts;
  stored_secret_refs: number;
}

export interface ManifestDiagnostics {
  path: string;
  schema_version: number;
  updated_at: string;
  engine_count: number;
}

export interface AppRuntimeDiagnostics {
  version: string;
  tauri_version: string;
  build_profile: string;
  pid: number;
  uptime_secs: number;
  autostart_enabled: boolean;
  tray_mode: string;
}

export interface HostDiagnostics {
  os_name: string;
  os_version: string;
  kernel_version: string;
  arch: string;
  target_triple: string;
  cpu_brand: string;
  cpu_cores: number;
  cpu_percent: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  disk_available_bytes: number;
  disk_total_bytes: number;
}

export interface InstanceDiagnosticRow {
  id: string;
  name: string;
  engine_type: string;
  engine_version: string;
  status: string;
  host: string;
  port: number;
  pid: number | null;
  ram_bytes: number;
  cpu_percent: number;
  disk_bytes: number;
  uptime_secs: number;
  restart_count: number;
  last_error: string | null;
}

export interface SupervisorDiagnostics {
  total_instances: number;
  running_count: number;
  embedded_count: number;
  stopped_count: number;
  error_count: number;
  total_ram_bytes: number;
  total_cpu_percent: number;
  total_disk_bytes: number;
  total_restarts: number;
  instances: InstanceDiagnosticRow[];
}

export interface KeyringDiagnostics {
  backend_name: string;
  service_name: string;
  stored_secret_refs: number;
}

export interface DiagnosticPaths {
  data_dir: string;
  db_path: string;
  bin_dir: string;
  instances_dir: string;
  manifest_path: string;
}

export interface DiagnosticsReport {
  app: AppRuntimeDiagnostics;
  host: HostDiagnostics;
  supervisor: SupervisorDiagnostics;
  database: SqliteDiagnostics;
  manifest: ManifestDiagnostics;
  keyring: KeyringDiagnostics;
  paths: DiagnosticPaths;
}

export interface SwatchPreset {
  id: string;
  label: string;
  hex: string;
}

export const SWATCH_PRESETS: readonly SwatchPreset[] = [
  { id: "teal", label: "Teal", hex: "#14B8A6" },
  { id: "sky", label: "Sky", hex: "#38BDF8" },
  { id: "indigo", label: "Indigo", hex: "#818CF8" },
  { id: "violet", label: "Violet", hex: "#A78BFA" },
  { id: "pink", label: "Pink", hex: "#F472B6" },
  { id: "orange", label: "Orange", hex: "#FB923C" },
  { id: "emerald", label: "Emerald", hex: "#10B981" },
  { id: "rose", label: "Rose", hex: "#F43F5E" },
] as const;
