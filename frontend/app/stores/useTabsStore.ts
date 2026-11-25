import { create } from "zustand";
import {
  listEmbeddingProfiles,
  listRemoteConnections,
} from "@/ipc/connections";
import type {
  ConnectionTarget,
  EmbeddingProfile,
  FilterSpec,
  RemoteConnection,
  VectorRecord,
} from "@/types/explorer";

export type WorkspaceTabKind = "collection" | "search" | "visualizer" | "logs";

export interface WorkspaceTab {
  id: string;
  kind: WorkspaceTabKind;
  title: string;
  connectionKey: string;
  target?: ConnectionTarget;
  collection?: string;
  instanceId?: string;
  // Persisted per-tab state
  offset: number;
  cursorHistory: Array<string | null>;
  limit: number;
  includeVectors: boolean;
  filter: FilterSpec | null;
  selectedRecord: VectorRecord | null;
  drawerOpen: boolean;
  // Search playground state
  searchMode: "text" | "vector";
  searchText: string;
  searchProfileId: string;
  searchVectorText: string;
  searchTopK: number;
  searchScoreThreshold: number | null;
  searchResults: VectorRecord[];
  searchLatencyMs: number | null;
  searchEmbedLatencyMs: number | null;
}

interface TabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  remoteConnections: RemoteConnection[];
  embeddingProfiles: EmbeddingProfile[];
  remoteModalOpen: boolean;
  editingRemoteConnection: RemoteConnection | null;

  refreshConnectionsAndProfiles: () => Promise<void>;
  openRemoteModal: (editing?: RemoteConnection | null) => void;
  closeRemoteModal: () => void;
  openCollectionTab: (
    connectionKey: string,
    target: ConnectionTarget,
    collection: string,
    labelPrefix: string,
  ) => void;
  openSearchTab: (
    connectionKey: string,
    target: ConnectionTarget,
    collection: string,
    labelPrefix: string,
    seedRecord?: VectorRecord,
  ) => void;
  openVisualizerTab: (
    connectionKey: string,
    target: ConnectionTarget,
    collection: string,
    labelPrefix: string,
  ) => void;
  openLogsTab: (instanceId: string, name: string) => void;
  setActiveTabId: (id: string | null) => void;
  closeTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<WorkspaceTab>) => void;
}

function makeDefaultTab(
  partial: Partial<WorkspaceTab> &
    Pick<WorkspaceTab, "id" | "kind" | "title" | "connectionKey">,
): WorkspaceTab {
  return {
    offset: 0,
    cursorHistory: [null],
    limit: 50,
    includeVectors: true,
    filter: null,
    selectedRecord: null,
    drawerOpen: false,
    searchMode: "text",
    searchText: "",
    searchProfileId: "",
    searchVectorText: "",
    searchTopK: 10,
    searchScoreThreshold: null,
    searchResults: [],
    searchLatencyMs: null,
    searchEmbedLatencyMs: null,
    ...partial,
  };
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  remoteConnections: [],
  embeddingProfiles: [],
  remoteModalOpen: false,
  editingRemoteConnection: null,

  refreshConnectionsAndProfiles: async () => {
    const [remoteConnections, embeddingProfiles] = await Promise.all([
      listRemoteConnections(),
      listEmbeddingProfiles(),
    ]);
    set({ remoteConnections, embeddingProfiles });
  },

  openRemoteModal: (editing = null) =>
    set({ remoteModalOpen: true, editingRemoteConnection: editing }),

  closeRemoteModal: () =>
    set({ remoteModalOpen: false, editingRemoteConnection: null }),

  openCollectionTab: (connectionKey, target, collection, labelPrefix) => {
    const id = `col:${connectionKey}:${collection}`;
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab = makeDefaultTab({
      id,
      kind: "collection",
      title: `${labelPrefix} / ${collection}`,
      connectionKey,
      target,
      collection,
    });
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  openSearchTab: (
    connectionKey,
    target,
    collection,
    labelPrefix,
    seedRecord,
  ) => {
    const id = seedRecord
      ? `search:${connectionKey}:${collection}:sim-${Date.now()}`
      : `search:${connectionKey}:${collection}`;
    const existing = !seedRecord
      ? get().tabs.find((t) => t.id === id)
      : undefined;
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const profiles = get().embeddingProfiles;
    const vectorText =
      seedRecord?.vector && seedRecord.vector.length > 0
        ? JSON.stringify(seedRecord.vector)
        : "";
    const tab = makeDefaultTab({
      id,
      kind: "search",
      title: seedRecord
        ? `Similar: ${seedRecord.id.slice(0, 10)}`
        : `Search · ${labelPrefix}/${collection}`,
      connectionKey,
      target,
      collection,
      searchMode: seedRecord ? "vector" : "text",
      searchVectorText: vectorText,
      searchProfileId: profiles[0]?.id ?? "",
    });
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  openVisualizerTab: (connectionKey, target, collection, labelPrefix) => {
    const id = `vis:${connectionKey}:${collection}`;
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab = makeDefaultTab({
      id,
      kind: "visualizer",
      title: `3D Map · ${labelPrefix}/${collection}`,
      connectionKey,
      target,
      collection,
    });
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  openLogsTab: (instanceId, name) => {
    const id = `logs:${instanceId}`;
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab = makeDefaultTab({
      id,
      kind: "logs",
      title: `Logs · ${name}`,
      connectionKey: `local:${instanceId}`,
      instanceId,
    });
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
  },

  setActiveTabId: (activeTabId) => set({ activeTabId }),

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const nextTabs = s.tabs.filter((t) => t.id !== id);
      let nextActive = s.activeTabId;
      if (s.activeTabId === id) {
        if (nextTabs.length === 0) {
          nextActive = null;
        } else {
          nextActive = nextTabs[Math.max(0, idx - 1)].id;
        }
      }
      return { tabs: nextTabs, activeTabId: nextActive };
    }),

  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
}));
