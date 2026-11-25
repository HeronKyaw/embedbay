import { create } from "zustand";
import {
  listEmbeddingProfiles,
  listRemoteConnections,
} from "@/ipc/connections";
import { listCollections } from "@/ipc/explorer";
import { formatUserError } from "@/lib/errors";
import type {
  CollectionSummary,
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
  // Unified Explorer tree state
  expandedConnections: Record<string, boolean>;
  collectionsByConnection: Record<string, CollectionSummary[]>;
  loadingConnections: Record<string, boolean>;
  connectionErrors: Record<string, string | null>;

  refreshConnectionsAndProfiles: () => Promise<void>;
  openRemoteModal: (editing?: RemoteConnection | null) => void;
  closeRemoteModal: () => void;
  refreshConnectionCollections: (
    connectionKey: string,
    target: ConnectionTarget,
  ) => Promise<{ ok: boolean; error?: string }>;
  clearConnectionError: (connectionKey: string) => void;
  toggleConnectionExpanded: (
    connectionKey: string,
    target: ConnectionTarget,
    ready: boolean,
  ) => Promise<void>;
  expandConnection: (
    connectionKey: string,
    target: ConnectionTarget,
    ready: boolean,
  ) => Promise<void>;
  clearConnectionCollections: (connectionKey: string) => void;
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
  closeTabsForConnection: (connectionKey: string) => void;
  closeTabsForCollection: (connectionKey: string, collection: string) => void;
  updateTab: (id: string, patch: Partial<WorkspaceTab>) => void;
}

function removeTabsMatching(
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  predicate: (tab: WorkspaceTab) => boolean,
): { tabs: WorkspaceTab[]; activeTabId: string | null } {
  const activeTab = activeTabId
    ? (tabs.find((t) => t.id === activeTabId) ?? null)
    : null;
  const sameConnBefore = activeTab
    ? tabs.filter((t) => t.connectionKey === activeTab.connectionKey)
    : [];
  const activeSameConnIndex = activeTab
    ? sameConnBefore.findIndex((t) => t.id === activeTab.id)
    : -1;

  const nextTabs = tabs.filter((t) => !predicate(t));
  let nextActive = activeTabId;

  if (activeTab && !nextTabs.some((t) => t.id === activeTab.id)) {
    const sameConnAfter = nextTabs.filter(
      (t) => t.connectionKey === activeTab.connectionKey,
    );
    if (sameConnAfter.length === 0) {
      nextActive = null;
    } else {
      nextActive =
        sameConnAfter[
          Math.min(
            sameConnAfter.length - 1,
            Math.max(0, activeSameConnIndex - 1),
          )
        ].id;
    }
  }

  return { tabs: nextTabs, activeTabId: nextActive };
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
  expandedConnections: {},
  collectionsByConnection: {},
  loadingConnections: {},
  connectionErrors: {},

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

  refreshConnectionCollections: async (connectionKey, target) => {
    set((s) => ({
      loadingConnections: { ...s.loadingConnections, [connectionKey]: true },
      connectionErrors: { ...s.connectionErrors, [connectionKey]: null },
    }));
    try {
      const list = await listCollections(target);
      set((s) => ({
        collectionsByConnection: {
          ...s.collectionsByConnection,
          [connectionKey]: list,
        },
        loadingConnections: { ...s.loadingConnections, [connectionKey]: false },
        connectionErrors: { ...s.connectionErrors, [connectionKey]: null },
      }));
      return { ok: true };
    } catch (err: unknown) {
      const message = formatUserError(err);
      set((s) => ({
        loadingConnections: { ...s.loadingConnections, [connectionKey]: false },
        connectionErrors: { ...s.connectionErrors, [connectionKey]: message },
      }));
      return { ok: false, error: message };
    }
  },

  clearConnectionError: (connectionKey) =>
    set((s) => {
      if (!(connectionKey in s.connectionErrors)) return s;
      const errorsCopy = { ...s.connectionErrors };
      delete errorsCopy[connectionKey];
      return { connectionErrors: errorsCopy };
    }),

  toggleConnectionExpanded: async (connectionKey, target, ready) => {
    const nextExpanded = !get().expandedConnections[connectionKey];
    set((s) => ({
      expandedConnections: {
        ...s.expandedConnections,
        [connectionKey]: nextExpanded,
      },
    }));
    if (nextExpanded && ready) {
      await get().refreshConnectionCollections(connectionKey, target);
    }
  },

  expandConnection: async (connectionKey, target, ready) => {
    set((s) => ({
      expandedConnections: {
        ...s.expandedConnections,
        [connectionKey]: true,
      },
    }));
    if (ready) {
      await get().refreshConnectionCollections(connectionKey, target);
    }
  },

  clearConnectionCollections: (connectionKey) =>
    set((s) => {
      const collectionsCopy = { ...s.collectionsByConnection };
      const errorsCopy = { ...s.connectionErrors };
      const loadingCopy = { ...s.loadingConnections };
      delete collectionsCopy[connectionKey];
      delete errorsCopy[connectionKey];
      delete loadingCopy[connectionKey];
      return {
        collectionsByConnection: collectionsCopy,
        connectionErrors: errorsCopy,
        loadingConnections: loadingCopy,
      };
    }),

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
    set((s) => removeTabsMatching(s.tabs, s.activeTabId, (t) => t.id === id)),

  closeTabsForConnection: (connectionKey) =>
    set((s) =>
      removeTabsMatching(
        s.tabs,
        s.activeTabId,
        (t) => t.connectionKey === connectionKey,
      ),
    ),

  closeTabsForCollection: (connectionKey, collection) =>
    set((s) =>
      removeTabsMatching(
        s.tabs,
        s.activeTabId,
        (t) => t.connectionKey === connectionKey && t.collection === collection,
      ),
    ),

  updateTab: (id, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
}));
