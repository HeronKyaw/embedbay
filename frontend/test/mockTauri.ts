import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  useAppStore,
} from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type {
  CollectionIndexInfo,
  CollectionSchema,
  CollectionSummary,
  EmbeddingProfile,
  RemoteConnection,
  SearchHistoryItem,
  SearchPreset,
  VectorRecord,
} from "@/types/explorer";
import type {
  CatalogEngineView,
  ConnectionGroup,
  InstalledEngine,
  InstallProgressEvent,
  InstanceMetrics,
  InstanceRecord,
  LogEntry,
  Tag,
} from "@/types/runtime";
import type { CloseBehavior } from "@/types/system";

export interface IpcCallRecord {
  cmd: string;
  args: Record<string, unknown>;
}

export interface MockBackendState {
  calls: IpcCallRecord[];
  autostartEnabled: boolean;
  closeBehavior: CloseBehavior;
  catalog: CatalogEngineView[];
  installedEngines: InstalledEngine[];
  activeInstalls: InstallProgressEvent[];
  holdInstall?: boolean;
  deferredInstall?: {
    resolve: (val: InstalledEngine) => void;
    reject: (err: Error) => void;
  };
  instances: InstanceRecord[];
  metrics: Record<string, InstanceMetrics>;
  logs: Record<string, LogEntry[]>;
  groups: ConnectionGroup[];
  tags: Tag[];
  remoteConnections: RemoteConnection[];
  embeddingProfiles: EmbeddingProfile[];
  collections: Record<string, CollectionSummary[]>;
  schemas: Record<string, CollectionSchema>;
  records: Record<string, VectorRecord[]>;
  indexes: Record<string, CollectionIndexInfo[]>;
  searchHistory: SearchHistoryItem[];
  searchPresets: SearchPreset[];
}

function targetKey(target: unknown): string {
  if (!target || typeof target !== "object") return "unknown";
  const t = target as Record<string, unknown>;
  if (t.kind === "local_instance") return `local:${String(t.instance_id)}`;
  if (t.kind === "remote_connection") return `remote:${String(t.connection_id)}`;
  if (t.kind === "direct") return `direct:${String(t.endpoint_url)}`;
  return "unknown";
}

export function createDefaultMockState(): MockBackendState {
  const now = Math.floor(Date.now() / 1000);
  return {
    calls: [],
    autostartEnabled: false,
    closeBehavior: "tray",
    catalog: [
      {
        engine_type: "qdrant",
        display_name: "Qdrant",
        description: "High-performance vector similarity engine written in Rust.",
        tier: 1,
        embedded: false,
        runtime_kind: "native",
        ram_hint: "~50–200 MB",
        category: "vector",
        install_notice: null,
        default_port: 6333,
        default_grpc_port: 6334,
        versions: [
          {
            version: "1.20.2",
            recommended: true,
            size_bytes: 32545356,
            sha256: "7a5290b9ef1b204b250a1626ddafec58",
            archive_type: "zip",
            installed: true,
            installed_id: "eng-qdrant-1202",
          },
          {
            version: "1.20.1",
            recommended: false,
            size_bytes: 32466981,
            sha256: "cdbcf8831a19b40785af300d10b76250",
            archive_type: "zip",
            installed: false,
            installed_id: null,
          },
        ],
      },
      {
        engine_type: "chroma",
        display_name: "Chroma",
        description: "Standalone Rust CLI server for Chroma local vector collections.",
        tier: 1,
        embedded: false,
        runtime_kind: "native",
        ram_hint: "~50–150 MB",
        category: "vector",
        install_notice: null,
        default_port: 8000,
        default_grpc_port: null,
        versions: [
          {
            version: "1.4.4",
            recommended: true,
            size_bytes: 55364096,
            sha256: "8697d3f5f55c4f982c6e114ac01cf006",
            archive_type: "binary",
            installed: false,
            installed_id: null,
          },
        ],
      },
      {
        engine_type: "sqlite_vec",
        display_name: "SQLite + sqlite-vec",
        description: "Built-in zero-daemon SQLite vec0 virtual tables.",
        tier: 1,
        embedded: true,
        runtime_kind: "embedded",
        ram_hint: "0 MB idle",
        category: "embedded",
        install_notice: null,
        default_port: 0,
        default_grpc_port: null,
        versions: [
          {
            version: "embedded-1.0",
            recommended: true,
            size_bytes: 0,
            sha256: "embedded",
            archive_type: "binary",
            installed: true,
            installed_id: "eng-sqlite-vec",
          },
        ],
      },
    ],
    installedEngines: [
      {
        id: "eng-qdrant-1202",
        engine_type: "qdrant",
        version: "1.20.2",
        target_triple: "x86_64-pc-windows-msvc",
        binary_path: "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app\\bin\\qdrant\\1.20.2\\qdrant.exe",
        sha256: "7a5290b9ef1b204b250a1626ddafec58",
        installed_at: now - 3600,
        last_used_at: now - 60,
      },
      {
        id: "eng-sqlite-vec",
        engine_type: "sqlite_vec",
        version: "embedded-1.0",
        target_triple: "universal",
        binary_path: "embedded",
        sha256: "embedded",
        installed_at: now - 3600,
        last_used_at: now - 60,
      },
    ],
    activeInstalls: [],
    holdInstall: false,
    instances: [
      {
        id: "inst-qdrant-1",
        name: "Local Qdrant Dev",
        description: "Primary local vector DB",
        color: "#14B8A6",
        group_id: "grp-1",
        engine_type: "qdrant",
        engine_version: "1.20.2",
        host: "127.0.0.1",
        port: 6333,
        grpc_port: 6334,
        data_dir: "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app\\instances\\inst-qdrant-1\\data",
        config_json: "{}",
        auto_start: false,
        idle_timeout_minutes: 0,
        sort_order: 0,
        created_at: now - 3600,
        tag_ids: ["tag-1"],
      },
    ],
    metrics: {
      "inst-qdrant-1": {
        instance_id: "inst-qdrant-1",
        status: "running",
        pid: 4242,
        ram_bytes: 68 * 1024 * 1024,
        cpu_percent: 1.4,
        uptime_secs: 320,
        disk_bytes: 12 * 1024 * 1024,
        restart_count: 0,
        last_error: null,
        last_activity_at: now,
      },
    },
    logs: {
      "inst-qdrant-1": [
        {
          timestamp_ms: Date.now() - 5000,
          stream: "stdout",
          message: "Qdrant HTTP listening on 127.0.0.1:6333",
        },
      ],
    },
    groups: [
      {
        id: "grp-1",
        name: "Local Dev",
        color: "#14B8A6",
        icon: null,
        sort_order: 0,
        is_collapsed: false,
        created_at: now - 3600,
      },
    ],
    tags: [{ id: "tag-1", name: "dev", color: "#14B8A6" }],
    remoteConnections: [
      {
        id: "rem-1",
        name: "Prod Pinecone RO",
        description: "Read-only production index",
        color: "#818CF8",
        group_id: null,
        engine_type: "pinecone",
        endpoint_url: "https://prod-index.svc.pinecone.io",
        auth_type: "api_key",
        secret_ref: "secret-rem-1",
        extra_json: "{}",
        read_only: true,
        sort_order: 0,
        created_at: now - 1800,
        tag_ids: [],
      },
    ],
    embeddingProfiles: [
      {
        id: "emb-1",
        name: "Local Ollama Nomic",
        provider: "ollama",
        model_name: "nomic-embed-text",
        base_url: "http://127.0.0.1:11434",
        dimensions: 4,
        secret_ref: null,
      },
    ],
    collections: {
      "local:inst-qdrant-1": [
        {
          name: "docs_chunks",
          vector_count: 3,
          dimensions: 4,
          distance_metric: "cosine",
        },
      ],
      "remote:rem-1": [
        {
          name: "prod_kb",
          vector_count: 2,
          dimensions: 4,
          distance_metric: "cosine",
        },
      ],
    },
    schemas: {
      "local:inst-qdrant-1::docs_chunks": {
        name: "docs_chunks",
        vector_count: 3,
        dimensions: 4,
        distance_metric: "cosine",
        index_type: "HNSW",
        segment_count: 1,
        disk_bytes: 24576,
        vector_field_name: "vector",
        payload_fields: [
          { name: "category", data_type: "keyword" },
          { name: "source", data_type: "text" },
        ],
      },
      "remote:rem-1::prod_kb": {
        name: "prod_kb",
        vector_count: 2,
        dimensions: 4,
        distance_metric: "cosine",
        index_type: "Serverless",
        segment_count: 1,
        disk_bytes: null,
        vector_field_name: "values",
        payload_fields: [{ name: "env", data_type: "keyword" }],
      },
    },
    records: {
      "local:inst-qdrant-1::docs_chunks": [
        {
          id: "rec-1",
          payload: { category: "guide", source: "architecture.md" },
          document: "EmbedBay separates React UI and Rust backend.",
          vector: [0.1, 0.2, 0.3, 0.4],
          score: null,
        },
        {
          id: "rec-2",
          payload: { category: "guide", source: "development.md" },
          document: "All OS-specific Rust code lives under platform/.",
          vector: [0.5, 0.1, 0.2, 0.3],
          score: null,
        },
        {
          id: "rec-3",
          payload: { category: "release", source: "CHANGELOG.md" },
          document: "EmbedBay v0.1.0 initial release.",
          vector: [0.2, 0.8, 0.1, 0.1],
          score: null,
        },
      ],
      "remote:rem-1::prod_kb": [
        {
          id: "prod-1",
          payload: { env: "production" },
          document: "Production read-only document.",
          vector: [0.3, 0.3, 0.3, 0.3],
          score: null,
        },
      ],
    },
    indexes: {
      "local:inst-qdrant-1::docs_chunks": [
        {
          name: "category_idx",
          field_name: "category",
          index_type: "keyword",
          params: {},
          status: "ready",
        },
      ],
    },
    searchHistory: [],
    searchPresets: [],
  };
}

export function resetAppStores(options?: { onboardingCompleted?: boolean }) {
  if (typeof window !== "undefined") {
    window.localStorage.clear();
    if (options?.onboardingCompleted !== false) {
      window.localStorage.setItem("embedbay-onboarding-completed", "true");
    }
  }

  const onboardingDone = options?.onboardingCompleted !== false;
  useAppStore.setState({
    theme: "dark",
    resolvedTheme: "dark",
    preferences: { ...DEFAULT_WORKSPACE_PREFERENCES },
    onboardingCompleted: onboardingDone,
    onboardingOpen: !onboardingDone,
    activeSection: "explorer",
    selectedStoreEngine: null,
    settingsOpen: false,
    settingsTab: "general",
    commandPaletteOpen: false,
    appStatus: null,
    statusLoading: false,
    statusError: null,
  });

  useRuntimeStore.setState({
    catalog: [],
    installedEngines: [],
    instances: [],
    groups: [],
    tags: [],
    metrics: {},
    totalRamBytes: 0,
    totalCpuPercent: 0,
    totalDiskBytes: 0,
    runningCount: 0,
    hostMetrics: {
      cpu_percent: 0,
      cpu_cores: 4,
      memory_used_bytes: 0,
      memory_total_bytes: 0,
      disk_available_bytes: 0,
      disk_total_bytes: 0,
    },
    installProgress: {},
    activeInstalls: {},
    logsByInstance: {},
    selectedConnectionKey: null,
    activeLogInstanceId: null,
    searchFilter: "",
    selectedTagIds: [],
    statusFilter: "all",
    loading: false,
    createModalOpen: false,
    editingInstance: null,
    createModalDefaultEngine: null,
  });

  useTabsStore.setState({
    tabs: [],
    activeTabId: null,
    remoteConnections: [],
    embeddingProfiles: [],
    remoteModalOpen: false,
    editingRemoteConnection: null,
    expandedConnections: {},
    collectionsByConnection: {},
    loadingConnections: {},
    connectionErrors: {},
  });
}

export function setupTauriMocks(
  state: MockBackendState = createDefaultMockState(),
): MockBackendState {
  clearMocks();
  mockWindows("main");

  mockIPC((cmd, rawArgs) => {
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    state.calls.push({ cmd, args });

    // Tauri v2 internal plugin commands
    if (cmd === "plugin:event|listen") return 1;
    if (cmd === "plugin:event|unlisten") return null;
    if (cmd === "plugin:window|is_maximized") return false;
    if (cmd === "plugin:window|minimize") return null;
    if (cmd === "plugin:window|toggle_maximize") return null;
    if (cmd === "plugin:window|close") return null;

    switch (cmd) {
      case "get_platform_info":
        return {
          os: "windows",
          arch: "x86_64",
          target_triple: "x86_64-pc-windows-msvc",
        };
      case "get_app_status":
        return {
          app_version: "0.1.0",
          platform: {
            os: "windows",
            arch: "x86_64",
            target_triple: "x86_64-pc-windows-msvc",
          },
          data_dir: "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app",
          db_path: "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app\\app.db",
          schema_version: 5,
          autostart_enabled: state.autostartEnabled,
          close_behavior: state.closeBehavior,
        };
      case "get_autostart_enabled":
        return state.autostartEnabled;
      case "set_autostart_enabled":
        state.autostartEnabled = Boolean(args.enabled);
        return state.autostartEnabled;
      case "set_close_behavior":
        state.closeBehavior = (args.behavior as CloseBehavior) ?? "tray";
        return state.closeBehavior;
      case "get_diagnostics":
        return {
          app: { version: "0.1.0", uptime_secs: 42 },
          host: {
            os_name: "Windows",
            os_version: "11",
            arch: "x86_64",
            cpu_brand: "Test CPU",
            cpu_cores: 8,
            cpu_percent: 12.5,
            memory_used_bytes: 8 * 1024 * 1024 * 1024,
            memory_total_bytes: 32 * 1024 * 1024 * 1024,
            disk_available_bytes: 120 * 1024 * 1024 * 1024,
            disk_total_bytes: 512 * 1024 * 1024 * 1024,
          },
          database: {
            schema_version: 5,
            sqlite_version: "3.46.0",
            journal_mode: "wal",
            foreign_keys: true,
            quick_check: "ok",
            db_bytes: 131072,
            wal_bytes: 4096,
            shm_bytes: 32768,
            table_counts: {
              installed_engines: state.installedEngines.length,
              instances: state.instances.length,
              remote_connections: state.remoteConnections.length,
              connection_groups: state.groups.length,
              tags: state.tags.length,
              embedding_profiles: state.embeddingProfiles.length,
              search_history: state.searchHistory.length,
              search_presets: state.searchPresets.length,
            },
            stored_secret_refs: 1,
          },
          manifest: {
            path: "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app\\manifests\\engines.json",
            schema_version: 1,
            updated_at: "2026-11-26T11:00:00Z",
            engine_count: state.catalog.length,
          },
          keyring: {
            backend_name: "Windows Credential Manager",
            stored_secret_refs: 1,
          },
          paths: {
            data_dir: "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app",
            db_path: "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app\\app.db",
            bin_dir: "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app\\bin",
            instances_dir:
              "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app\\instances",
          },
        };
      case "open_data_path":
      case "open_external_url":
        return null;

      // Engines
      case "list_engine_catalog":
      case "refresh_engine_catalog":
        return [...state.catalog];
      case "list_installed_engines":
        return [...state.installedEngines];
      case "list_active_installs":
        return [...state.activeInstalls];
      case "pause_engine_install": {
        state.activeInstalls = state.activeInstalls.map((a) =>
          a.engine_type === String(args.engineType) &&
          a.version === String(args.version)
            ? { ...a, stage: "paused", message: "Download paused" }
            : a,
        );
        return true;
      }
      case "resume_engine_install": {
        state.activeInstalls = state.activeInstalls.map((a) =>
          a.engine_type === String(args.engineType) &&
          a.version === String(args.version)
            ? { ...a, stage: "downloading", message: "Resuming download..." }
            : a,
        );
        return true;
      }
      case "cancel_engine_install": {
        state.activeInstalls = state.activeInstalls.filter(
          (a) =>
            !(
              a.engine_type === String(args.engineType) &&
              a.version === String(args.version)
            ),
        );
        if (state.deferredInstall) {
          const rej = state.deferredInstall.reject;
          state.deferredInstall = undefined;
          rej(new Error("Download cancelled by user"));
        }
        return true;
      }
      case "install_engine": {
        const engineType = String(args.engineType);
        const version = String(args.version);
        const id = `eng-${engineType}-${version}`;
        const installed: InstalledEngine = {
          id,
          engine_type: engineType,
          version,
          target_triple: "x86_64-pc-windows-msvc",
          binary_path: `C:\\Users\\qa\\AppData\\Local\\com.embedbay.app\\bin\\${engineType}\\${version}\\${engineType}.exe`,
          sha256: "mocksha256",
          installed_at: Math.floor(Date.now() / 1000),
          last_used_at: null,
        };
        if (state.holdInstall) {
          state.activeInstalls.push({
            engine_type: engineType,
            version,
            stage: "downloading",
            downloaded_bytes: 1024 * 1024,
            total_bytes: 10 * 1024 * 1024,
            percent: 10,
            message: "Downloading primary package...",
          });
          return new Promise<InstalledEngine>((resolve, reject) => {
            state.deferredInstall = {
              resolve: (val) => {
                state.installedEngines.push(val);
                state.catalog = state.catalog.map((e) =>
                  e.engine_type === engineType
                    ? {
                        ...e,
                        versions: e.versions.map((v) =>
                          v.version === version
                            ? { ...v, installed: true, installed_id: id }
                            : v,
                        ),
                      }
                    : e,
                );
                resolve(val);
              },
              reject,
            };
          });
        }
        state.installedEngines.push(installed);
        state.catalog = state.catalog.map((e) =>
          e.engine_type === engineType
            ? {
                ...e,
                versions: e.versions.map((v) =>
                  v.version === version
                    ? { ...v, installed: true, installed_id: id }
                    : v,
                ),
              }
            : e,
        );
        return installed;
      }
      case "uninstall_engine": {
        const id = String(args.id);
        state.installedEngines = state.installedEngines.filter((e) => e.id !== id);
        state.catalog = state.catalog.map((e) => ({
          ...e,
          versions: e.versions.map((v) =>
            v.installed_id === id ? { ...v, installed: false, installed_id: null } : v,
          ),
        }));
        return null;
      }
      case "get_storage_usage":
        return {
          data_root: "C:\\Users\\qa\\AppData\\Local\\com.embedbay.app",
          total_engine_bytes: 32545356,
          unused_engine_bytes: 0,
          unused_engine_count: 0,
          stale_unused_engine_bytes: 0,
          stale_unused_engine_count: 0,
          unused_grace_days: 7,
          total_instance_bytes: 12 * 1024 * 1024,
          db_bytes: 131072,
          logs_bytes: 8192,
          engines: [],
          instances: [],
        };
      case "cleanup_unused_engines":
        return {
          removed_count: 0,
          freed_bytes: 0,
          removed_ids: [],
          skipped: [],
        };
      case "compact_database":
        return {
          before_bytes: 131072,
          after_bytes: 98304,
          freed_bytes: 32768,
        };

      // Instances
      case "list_instances":
        return [...state.instances];
      case "create_instance": {
        const p = args.payload as Record<string, unknown>;
        const id = `inst-${state.instances.length + 1}`;
        const rec: InstanceRecord = {
          id,
          name: String(p.name ?? "New Instance"),
          description: (p.description as string | null) ?? null,
          color: (p.color as string | null) ?? "#14B8A6",
          group_id: (p.group_id as string | null) ?? null,
          engine_type: String(p.engine_type ?? "qdrant"),
          engine_version: String(p.engine_version ?? "1.20.2"),
          host: String(p.host ?? "127.0.0.1"),
          port: Number(p.port ?? 6335),
          grpc_port: (p.grpc_port as number | null) ?? null,
          data_dir: String(
            p.data_dir ??
              `C:\\Users\\qa\\AppData\\Local\\com.embedbay.app\\instances\\${id}\\data`,
          ),
          config_json: String(p.config_json ?? "{}"),
          auto_start: Boolean(p.auto_start ?? false),
          idle_timeout_minutes: Number(p.idle_timeout_minutes ?? 0),
          sort_order: state.instances.length,
          created_at: Math.floor(Date.now() / 1000),
          tag_ids: (p.tag_ids as string[]) ?? [],
        };
        state.instances.push(rec);
        state.metrics[id] = {
          instance_id: id,
          status: rec.engine_type === "sqlite_vec" ? "embedded" : "stopped",
          pid: null,
          ram_bytes: 0,
          cpu_percent: 0,
          uptime_secs: 0,
          disk_bytes: 0,
          restart_count: 0,
          last_error: null,
          last_activity_at: Math.floor(Date.now() / 1000),
        };
        state.collections[`local:${id}`] = [];
        return rec;
      }
      case "update_instance": {
        const id = String(args.id);
        const p = args.payload as Partial<InstanceRecord>;
        state.instances = state.instances.map((i) =>
          i.id === id ? { ...i, ...p } : i,
        );
        return state.instances.find((i) => i.id === id);
      }
      case "delete_instance": {
        const id = String(args.id);
        state.instances = state.instances.filter((i) => i.id !== id);
        delete state.metrics[id];
        return null;
      }
      case "start_instance":
      case "restart_instance": {
        const id = String(args.id);
        const m: InstanceMetrics = {
          ...(state.metrics[id] ?? {
            instance_id: id,
            ram_bytes: 48 * 1024 * 1024,
            cpu_percent: 0.8,
            uptime_secs: 1,
            disk_bytes: 1024,
            restart_count: 0,
            last_error: null,
            last_activity_at: Math.floor(Date.now() / 1000),
          }),
          status: "running",
          pid: 9001,
        };
        state.metrics[id] = m;
        return m;
      }
      case "stop_instance":
      case "force_kill_instance": {
        const id = String(args.id);
        if (state.metrics[id]) {
          state.metrics[id] = {
            ...state.metrics[id],
            status: "stopped",
            pid: null,
            ram_bytes: 0,
            cpu_percent: 0,
          };
        }
        return null;
      }
      case "stop_all_instances":
      case "stop_idle_instances":
      case "start_group_instances":
      case "stop_group_instances":
        return [];
      case "get_all_instance_metrics": {
        const vals = Object.values(state.metrics);
        const running = vals.filter((m) => m.status === "running");
        return {
          total_ram_bytes: running.reduce((a, b) => a + b.ram_bytes, 0),
          total_cpu_percent: running.reduce((a, b) => a + b.cpu_percent, 0),
          total_disk_bytes: vals.reduce((a, b) => a + b.disk_bytes, 0),
          running_count: running.length,
          host: {
            cpu_percent: 12.5,
            cpu_cores: 8,
            memory_used_bytes: 8 * 1024 * 1024 * 1024,
            memory_total_bytes: 32 * 1024 * 1024 * 1024,
            disk_available_bytes: 120 * 1024 * 1024 * 1024,
            disk_total_bytes: 512 * 1024 * 1024 * 1024,
          },
          instances: state.metrics,
        };
      }
      case "get_instance_logs":
      case "subscribe_instance_logs":
        return state.logs[String(args.id)] ?? [];
      case "clear_instance_logs":
        state.logs[String(args.id)] = [];
        return null;
      case "check_port_available":
        return true;
      case "suggest_available_port":
        return Number(args.preferred ?? 6333) + 2;
      case "backup_instance":
        return { zip_path: String(args.destPath ?? "backup.zip"), size_bytes: 1024 };
      case "restore_instance":
        return null;

      // Groups & Tags
      case "list_groups":
        return state.groups;
      case "create_group": {
        const p = args.payload as Record<string, unknown>;
        const g: ConnectionGroup = {
          id: `grp-${state.groups.length + 1}`,
          name: String(p.name),
          color: (p.color as string | null) ?? null,
          icon: (p.icon as string | null) ?? null,
          sort_order: state.groups.length,
          is_collapsed: false,
          created_at: Math.floor(Date.now() / 1000),
        };
        state.groups.push(g);
        return g;
      }
      case "update_group":
        return state.groups[0];
      case "delete_group":
        state.groups = state.groups.filter((g) => g.id !== String(args.id));
        return true;
      case "reorder_items":
        return null;
      case "list_tags":
        return state.tags;
      case "create_tag": {
        const t: Tag = {
          id: `tag-${state.tags.length + 1}`,
          name: String(args.name),
          color: String(args.color),
        };
        state.tags.push(t);
        return t;
      }
      case "update_tag":
        return state.tags[0];
      case "delete_tag":
        state.tags = state.tags.filter((t) => t.id !== String(args.id));
        return true;
      case "set_entity_tags":
        return (args.tagIds as string[]) ?? [];

      // Remote connections & embedding profiles
      case "list_remote_connections":
        return [...state.remoteConnections];
      case "create_remote_connection": {
        const p = args.payload as Record<string, unknown>;
        const conn: RemoteConnection = {
          id: `rem-${state.remoteConnections.length + 1}`,
          name: String(p.name),
          description: (p.description as string | null) ?? null,
          color: (p.color as string | null) ?? null,
          group_id: (p.group_id as string | null) ?? null,
          engine_type: String(p.engine_type),
          endpoint_url: String(p.endpoint_url),
          auth_type: String(p.auth_type ?? "none"),
          secret_ref: p.secret ? "secret-new" : null,
          extra_json: String(p.extra_json ?? "{}"),
          read_only: Boolean(p.read_only ?? false),
          sort_order: state.remoteConnections.length,
          created_at: Math.floor(Date.now() / 1000),
          tag_ids: (p.tag_ids as string[]) ?? [],
        };
        state.remoteConnections.push(conn);
        state.collections[`remote:${conn.id}`] = [];
        return conn;
      }
      case "update_remote_connection": {
        const id = String(args.id);
        const p = args.payload as Partial<RemoteConnection>;
        state.remoteConnections = state.remoteConnections.map((c) =>
          c.id === id ? { ...c, ...p } : c,
        );
        return state.remoteConnections.find((c) => c.id === id);
      }
      case "delete_remote_connection":
        state.remoteConnections = state.remoteConnections.filter(
          (c) => c.id !== String(args.id),
        );
        return true;
      case "list_embedding_profiles":
        return state.embeddingProfiles;
      case "create_embedding_profile": {
        const p = args.payload as Record<string, unknown>;
        const prof: EmbeddingProfile = {
          id: `emb-${state.embeddingProfiles.length + 1}`,
          name: String(p.name),
          provider: String(p.provider),
          model_name: String(p.model_name),
          base_url: (p.base_url as string | null) ?? null,
          dimensions: (p.dimensions as number | null) ?? 4,
          secret_ref: p.api_key ? "secret-emb" : null,
        };
        state.embeddingProfiles.push(prof);
        return prof;
      }
      case "update_embedding_profile":
        return state.embeddingProfiles[0];
      case "delete_embedding_profile":
        state.embeddingProfiles = state.embeddingProfiles.filter(
          (p) => p.id !== String(args.id),
        );
        return true;
      case "test_embedding_profile":
      case "test_embedding_profile_draft":
        return { ok: true, dimensions: 4, latency_ms: 14, message: "OK" };
      case "embed_texts": {
        const texts = (args.texts as string[]) ?? [""];
        return [texts.map(() => [0.1, 0.2, 0.3, 0.4]), 12];
      }

      // Explorer
      case "test_connection":
        return {
          ok: true,
          latency_ms: 8,
          engine_version: "1.20.2",
          message: "Connected successfully",
        };
      case "list_collections":
        return state.collections[targetKey(args.target)] ?? [];
      case "get_collection_info": {
        const key = `${targetKey(args.target)}::${String(args.collection)}`;
        return (
          state.schemas[key] ?? {
            name: String(args.collection),
            vector_count: 0,
            dimensions: 4,
            distance_metric: "cosine",
            index_type: "HNSW",
            segment_count: 1,
            disk_bytes: 0,
            vector_field_name: "vector",
            payload_fields: [],
          }
        );
      }
      case "create_collection": {
        const tk = targetKey(args.target);
        const req = args.request as {
          name: string;
          dimensions: number;
          distance_metric: string;
        };
        state.collections[tk] = [
          ...(state.collections[tk] ?? []),
          {
            name: req.name,
            vector_count: 0,
            dimensions: req.dimensions,
            distance_metric: req.distance_metric,
          },
        ];
        state.schemas[`${tk}::${req.name}`] = {
          name: req.name,
          vector_count: 0,
          dimensions: req.dimensions,
          distance_metric: req.distance_metric,
          index_type: "HNSW",
          segment_count: 1,
          disk_bytes: 0,
          vector_field_name: "vector",
          payload_fields: [],
        };
        state.records[`${tk}::${req.name}`] = [];
        return null;
      }
      case "delete_collection": {
        const tk = targetKey(args.target);
        const col = String(args.collection);
        state.collections[tk] = (state.collections[tk] ?? []).filter(
          (c) => c.name !== col,
        );
        delete state.schemas[`${tk}::${col}`];
        delete state.records[`${tk}::${col}`];
        return null;
      }
      case "browse_records": {
        const key = `${targetKey(args.target)}::${String(args.collection)}`;
        const recs = state.records[key] ?? [];
        return {
          records: recs,
          next_cursor: null,
          total_count: recs.length,
        };
      }
      case "upsert_records": {
        const key = `${targetKey(args.target)}::${String(args.collection)}`;
        const incoming = (args.records as VectorRecord[]) ?? [];
        const existing = state.records[key] ?? [];
        const map = new Map(existing.map((r) => [r.id, r]));
        for (const r of incoming) map.set(r.id, r);
        state.records[key] = Array.from(map.values());
        return incoming.length;
      }
      case "delete_records": {
        const key = `${targetKey(args.target)}::${String(args.collection)}`;
        const ids = new Set((args.ids as string[]) ?? []);
        const before = (state.records[key] ?? []).length;
        state.records[key] = (state.records[key] ?? []).filter(
          (r) => !ids.has(r.id),
        );
        return before - state.records[key].length;
      }
      case "search_vectors": {
        const key = `${targetKey(args.target)}::${String(args.collection)}`;
        const recs = (state.records[key] ?? []).map((r, i) => ({
          ...r,
          score: Number((0.98 - i * 0.08).toFixed(2)),
        }));
        return { records: recs, latency_ms: 5 };
      }
      case "list_collection_indexes":
        return (
          state.indexes[`${targetKey(args.target)}::${String(args.collection)}`] ??
          []
        );
      case "create_collection_index":
      case "delete_collection_index":
        return null;

      // Search meta
      case "list_search_history":
        return state.searchHistory;
      case "record_search_history": {
        const p = args.payload as Record<string, unknown>;
        const item: SearchHistoryItem = {
          id: `hist-${state.searchHistory.length + 1}`,
          connection_key: String(p.connection_key),
          collection: String(p.collection),
          search_mode: String(p.search_mode),
          query_text: (p.query_text as string | null) ?? null,
          vector_json: (p.vector_json as string | null) ?? null,
          embedding_profile_id: (p.embedding_profile_id as string | null) ?? null,
          top_k: Number(p.top_k ?? 10),
          score_threshold: (p.score_threshold as number | null) ?? null,
          filter_json: (p.filter_json as string | null) ?? null,
          result_count: Number(p.result_count ?? 0),
          latency_ms: (p.latency_ms as number | null) ?? 5,
          created_at: Math.floor(Date.now() / 1000),
        };
        state.searchHistory.unshift(item);
        return item;
      }
      case "clear_search_history":
        state.searchHistory = [];
        return null;
      case "list_search_presets":
        return state.searchPresets;
      case "save_search_preset": {
        const p = args.payload as Record<string, unknown>;
        const preset: SearchPreset = {
          id: `preset-${state.searchPresets.length + 1}`,
          name: String(p.name),
          connection_key: String(p.connection_key),
          collection: String(p.collection),
          search_mode: String(p.search_mode),
          query_text: (p.query_text as string | null) ?? null,
          vector_json: (p.vector_json as string | null) ?? null,
          embedding_profile_id: (p.embedding_profile_id as string | null) ?? null,
          top_k: Number(p.top_k ?? 10),
          score_threshold: (p.score_threshold as number | null) ?? null,
          filter_json: (p.filter_json as string | null) ?? null,
          created_at: Math.floor(Date.now() / 1000),
        };
        state.searchPresets.push(preset);
        return preset;
      }
      case "delete_search_preset":
        state.searchPresets = state.searchPresets.filter(
          (p) => p.id !== String(args.id),
        );
        return true;

      // Analytics & Transfer
      case "compute_embedding_projection": {
        const vecs = (args.vectors as number[][]) ?? [];
        return {
          coords: vecs.map((_, i) => [i * 0.5, i * -0.3, i * 0.2]),
          dims: Number(args.dims ?? 2),
          method: String(args.method ?? "pca"),
          elapsed_ms: 4,
          explained_variance: [0.65, 0.25],
        };
      }
      case "import_records":
        return { imported: 2, failed: 0, errors: [] };
      case "export_records":
      case "export_search_results":
        return { exported: 3, dest_path: String(args.destPath ?? "export.jsonl") };
      case "migrate_collection":
        return { migrated: 3, skipped: 0, failed: 0, errors: [] };
      case "preview_document_chunks":
        return {
          total_files: 1,
          total_chunks: 2,
          avg_chunk_length: 120,
          chunks: [],
        };
      case "ingest_documents":
        return { files_processed: 1, chunks_ingested: 2, failed: 0, errors: [] };

      default:
        throw new Error(`Unhandled mockIPC command: ${cmd}`);
    }
  });

  return state;
}
