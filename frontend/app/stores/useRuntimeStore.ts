import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { listEngineCatalog, listInstalledEngines } from "@/ipc/engines";
import { listGroups, listTags } from "@/ipc/groupsTags";
import { getAllInstanceMetrics, listInstances } from "@/ipc/instances";
import { isTauriRuntime } from "@/ipc/system";
import type {
  CatalogEngineView,
  ConnectionGroup,
  InstalledEngine,
  InstallProgressEvent,
  InstanceLogEvent,
  InstanceMetrics,
  InstanceRecord,
  InstanceStatusChangedEvent,
  LogEntry,
  SystemMetricsSummary,
  Tag,
} from "@/types/runtime";

export type SidebarStatusFilter = "all" | "running" | "stopped" | "remote";

interface RuntimeState {
  catalog: CatalogEngineView[];
  installedEngines: InstalledEngine[];
  instances: InstanceRecord[];
  groups: ConnectionGroup[];
  tags: Tag[];
  metrics: Record<string, InstanceMetrics>;
  totalRamBytes: number;
  runningCount: number;
  installProgress: Record<string, InstallProgressEvent>;
  logsByInstance: Record<string, LogEntry[]>;
  selectedConnectionKey: string | null; // e.g. "local:<id>" or "remote:<id>"
  activeLogInstanceId: string | null;
  searchFilter: string;
  selectedTagIds: string[];
  statusFilter: SidebarStatusFilter;
  loading: boolean;
  createModalOpen: boolean;
  editingInstance: InstanceRecord | null;
  createModalDefaultEngine: string | null;

  refreshAll: () => Promise<void>;
  refreshCatalogAndInstalled: () => Promise<void>;
  refreshInstances: () => Promise<void>;
  refreshGroupsAndTags: () => Promise<void>;
  setSelectedConnectionKey: (key: string | null) => void;
  setActiveLogInstanceId: (id: string | null) => void;
  setSearchFilter: (q: string) => void;
  toggleTagFilter: (tagId: string) => void;
  clearTagFilters: () => void;
  setStatusFilter: (filter: SidebarStatusFilter) => void;
  openCreateInstanceModal: (defaultEngine?: string) => void;
  openEditInstanceModal: (instance: InstanceRecord) => void;
  closeInstanceModal: () => void;
  setInstanceLogs: (instanceId: string, entries: LogEntry[]) => void;
  appendInstanceLog: (instanceId: string, entry: LogEntry) => void;
  applyMetricsSummary: (summary: SystemMetricsSummary) => void;
  applyStatusChanged: (evt: InstanceStatusChangedEvent) => void;
  setInstallProgress: (evt: InstallProgressEvent) => void;
  clearInstallProgress: (engineType: string, version: string) => void;
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  catalog: [],
  installedEngines: [],
  instances: [],
  groups: [],
  tags: [],
  metrics: {},
  totalRamBytes: 0,
  runningCount: 0,
  installProgress: {},
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

  refreshAll: async () => {
    set({ loading: true });
    try {
      const [catalog, installedEngines, instances, groups, tags, summary] =
        await Promise.all([
          listEngineCatalog(),
          listInstalledEngines(),
          listInstances(),
          listGroups(),
          listTags(),
          getAllInstanceMetrics(),
        ]);
      set({
        catalog,
        installedEngines,
        instances,
        groups,
        tags,
        metrics: summary.instances,
        totalRamBytes: summary.total_ram_bytes,
        runningCount: summary.running_count,
      });
    } finally {
      set({ loading: false });
    }
  },

  refreshCatalogAndInstalled: async () => {
    const [catalog, installedEngines] = await Promise.all([
      listEngineCatalog(),
      listInstalledEngines(),
    ]);
    set({ catalog, installedEngines });
  },

  refreshInstances: async () => {
    const [instances, summary] = await Promise.all([
      listInstances(),
      getAllInstanceMetrics(),
    ]);
    set({
      instances,
      metrics: summary.instances,
      totalRamBytes: summary.total_ram_bytes,
      runningCount: summary.running_count,
    });
  },

  refreshGroupsAndTags: async () => {
    const [groups, tags] = await Promise.all([listGroups(), listTags()]);
    set({ groups, tags });
  },

  setSelectedConnectionKey: (selectedConnectionKey) =>
    set({ selectedConnectionKey }),
  setActiveLogInstanceId: (activeLogInstanceId) => set({ activeLogInstanceId }),
  setSearchFilter: (searchFilter) => set({ searchFilter }),
  toggleTagFilter: (tagId) =>
    set((s) => ({
      selectedTagIds: s.selectedTagIds.includes(tagId)
        ? s.selectedTagIds.filter((id) => id !== tagId)
        : [...s.selectedTagIds, tagId],
    })),
  clearTagFilters: () => set({ selectedTagIds: [] }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),

  openCreateInstanceModal: (defaultEngine) =>
    set({
      createModalOpen: true,
      editingInstance: null,
      createModalDefaultEngine: defaultEngine ?? null,
    }),

  openEditInstanceModal: (instance) =>
    set({
      createModalOpen: true,
      editingInstance: instance,
      createModalDefaultEngine: null,
    }),

  closeInstanceModal: () =>
    set({
      createModalOpen: false,
      editingInstance: null,
      createModalDefaultEngine: null,
    }),

  setInstanceLogs: (instanceId, entries) =>
    set((s) => ({
      logsByInstance: {
        ...s.logsByInstance,
        [instanceId]: entries.slice(-1000),
      },
    })),

  appendInstanceLog: (instanceId, entry) =>
    set((s) => {
      const existing = s.logsByInstance[instanceId] ?? [];
      const next = [...existing, entry];
      if (next.length > 1000) {
        next.splice(0, next.length - 1000);
      }
      return {
        logsByInstance: {
          ...s.logsByInstance,
          [instanceId]: next,
        },
      };
    }),

  applyMetricsSummary: (summary) =>
    set({
      metrics: summary.instances,
      totalRamBytes: summary.total_ram_bytes,
      runningCount: summary.running_count,
    }),

  applyStatusChanged: (evt) => {
    set((s) => {
      const prev = s.metrics[evt.instance_id] ?? {
        instance_id: evt.instance_id,
        status: evt.status,
        pid: evt.pid,
        ram_bytes: 0,
        cpu_percent: 0,
        uptime_secs: 0,
        disk_bytes: 0,
        restart_count: 0,
        last_error: evt.last_error,
        last_activity_at: Math.floor(Date.now() / 1000),
      };
      const updated = {
        ...s.metrics,
        [evt.instance_id]: {
          ...prev,
          status: evt.status,
          pid: evt.pid,
          last_error: evt.last_error,
        },
      };
      const values = Object.values(updated);
      return {
        metrics: updated,
        runningCount: values.filter((m) => m.status === "running").length,
        totalRamBytes: values.reduce((acc, m) => acc + m.ram_bytes, 0),
      };
    });
    if (evt.status === "running" || evt.status === "stopped" || evt.status === "error") {
      void get().refreshInstances();
    }
  },

  setInstallProgress: (evt) =>
    set((s) => ({
      installProgress: {
        ...s.installProgress,
        [`${evt.engine_type}-${evt.version}`]: evt,
      },
    })),

  clearInstallProgress: (engineType, version) =>
    set((s) => {
      const copy = { ...s.installProgress };
      delete copy[`${engineType}-${version}`];
      return { installProgress: copy };
    }),
}));

export function subscribeRuntimeEvents(): () => void {
  if (!isTauriRuntime()) return () => {};

  const unlisteners: Array<() => void> = [];
  let disposed = false;

  void listen<InstallProgressEvent>("install-progress", (e) => {
    useRuntimeStore.getState().setInstallProgress(e.payload);
  }).then((fn) => {
    if (disposed) fn();
    else unlisteners.push(fn);
  });

  void listen<SystemMetricsSummary>("instance-metrics", (e) => {
    useRuntimeStore.getState().applyMetricsSummary(e.payload);
  }).then((fn) => {
    if (disposed) fn();
    else unlisteners.push(fn);
  });

  void listen<InstanceStatusChangedEvent>("instance-status-changed", (e) => {
    useRuntimeStore.getState().applyStatusChanged(e.payload);
  }).then((fn) => {
    if (disposed) fn();
    else unlisteners.push(fn);
  });

  void listen<InstanceLogEvent>("instance-log", (e) => {
    useRuntimeStore
      .getState()
      .appendInstanceLog(e.payload.instance_id, e.payload.entry);
  }).then((fn) => {
    if (disposed) fn();
    else unlisteners.push(fn);
  });

  return () => {
    disposed = true;
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}
