import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Code2,
  Database,
  Globe,
  Layers,
  Lock,
  Play,
  Plus,
  RefreshCw,
  ScatterChart,
  Search,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { CollectionHeader } from "@/components/explorer/CollectionHeader";
import {
  CreateCollectionModal,
  UpsertRecordModal,
} from "@/components/explorer/CrudModal";
import { ExplorerFloatingSwitcher } from "@/components/explorer/ExplorerFloatingSwitcher";
import { ExplorerHome } from "@/components/explorer/ExplorerHome";
import { IndexManagerModal } from "@/components/explorer/IndexManagerModal";
import { MetadataDrawer } from "@/components/explorer/MetadataDrawer";
import { RecordTable } from "@/components/explorer/RecordTable";
import { SnippetModal } from "@/components/explorer/SnippetModal";
import { PageHeader } from "@/components/layout/PageHeader";
import { WorkspaceTabs } from "@/components/layout/WorkspaceTabs";
import { LogViewer } from "@/components/manager/LogViewer";
import { FilterBuilder } from "@/components/search/FilterBuilder";
import { SearchPlayground } from "@/components/search/SearchPlayground";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InstanceStatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toast";
import {
  browseRecords,
  deleteCollection,
  deleteRecords,
  getCollectionInfo,
  upsertRecords,
} from "@/ipc/explorer";
import { startInstance, stopInstance } from "@/ipc/instances";
import { formatRamMb } from "@/lib/format";
import { generateConnectionSnippets } from "@/lib/snippets";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore, type WorkspaceTab } from "@/stores/useTabsStore";
import type {
  CollectionSchema,
  CollectionSummary,
  ConnectionTarget,
  VectorRecord,
} from "@/types/explorer";
import type { InstanceStatus } from "@/types/runtime";

const EMPTY_COLLECTIONS: CollectionSummary[] = [];

function hasOpenModal(): boolean {
  return (
    typeof document !== "undefined" &&
    Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'))
  );
}

function isBackGuardState(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { embedbayBackGuard?: unknown }).embedbayBackGuard === true
  );
}

function pushBackGuard(): void {
  if (typeof window === "undefined" || isBackGuardState(window.history.state)) {
    return;
  }
  const baseState =
    typeof window.history.state === "object" && window.history.state !== null
      ? (window.history.state as Record<string, unknown>)
      : {};
  window.history.pushState({ ...baseState, embedbayBackGuard: true }, "");
}

function CollectionTabPane({
  tab,
  engineType,
  readOnly = false,
  onCollectionDeleted,
  renderVisualizerButton,
  onOpenImportExport,
  onOpenMigrate,
}: {
  tab: WorkspaceTab;
  engineType: string;
  readOnly?: boolean;
  onCollectionDeleted: () => void;
  renderVisualizerButton?: boolean;
  onOpenImportExport?: (
    target: ConnectionTarget,
    collection: string,
    schema: CollectionSchema | null,
    readOnly: boolean,
  ) => void;
  onOpenMigrate?: (
    target: ConnectionTarget,
    collection: string,
    schema: CollectionSchema | null,
  ) => void;
}) {
  const updateTab = useTabsStore((s) => s.updateTab);
  const openSearchTab = useTabsStore((s) => s.openSearchTab);
  const openVisualizerTab = useTabsStore((s) => s.openVisualizerTab);

  const [schema, setSchema] = React.useState<CollectionSchema | null>(null);
  const [records, setRecords] = React.useState<VectorRecord[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [totalCount, setTotalCount] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(
    Boolean(tab.target && tab.collection),
  );
  const [upsertOpen, setUpsertOpen] = React.useState(false);
  const [confirmDeleteCol, setConfirmDeleteCol] = React.useState(false);
  const [indexesOpen, setIndexesOpen] = React.useState(false);

  const supportsIndexes =
    engineType.toLowerCase() === "qdrant" ||
    engineType.toLowerCase() === "pgvector";

  const loadData = React.useCallback(async () => {
    if (!tab.target || !tab.collection) return;
    setLoading(true);
    try {
      const currentCursor =
        tab.cursorHistory[tab.cursorHistory.length - 1] ?? null;
      const [info, page] = await Promise.all([
        getCollectionInfo(tab.target, tab.collection),
        browseRecords(tab.target, tab.collection, {
          limit: tab.limit,
          offset: tab.offset,
          cursor: currentCursor,
          include_vectors: tab.includeVectors,
          filter: tab.filter,
        }),
      ]);
      setSchema(info);
      setRecords(page.records);
      setNextCursor(page.next_cursor);
      setTotalCount(page.total_count ?? info.vector_count);
    } catch (err: unknown) {
      toast.error(
        `Failed to load "${tab.collection}"`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoading(false);
    }
  }, [
    tab.target,
    tab.collection,
    tab.offset,
    tab.cursorHistory,
    tab.limit,
    tab.includeVectors,
    tab.filter,
  ]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleNextPage = () => {
    if (nextCursor) {
      updateTab(tab.id, {
        cursorHistory: [...tab.cursorHistory, nextCursor],
        offset: tab.offset + tab.limit,
      });
    } else if (
      totalCount == null ||
      tab.offset + records.length < totalCount
    ) {
      updateTab(tab.id, { offset: tab.offset + tab.limit });
    }
  };

  const handlePrevPage = () => {
    if (tab.cursorHistory.length > 1) {
      updateTab(tab.id, {
        cursorHistory: tab.cursorHistory.slice(0, -1),
        offset: Math.max(0, tab.offset - tab.limit),
      });
    } else if (tab.offset > 0) {
      updateTab(tab.id, { offset: Math.max(0, tab.offset - tab.limit) });
    }
  };

  const canPrev = tab.offset > 0 || tab.cursorHistory.length > 1;
  const canNext =
    Boolean(nextCursor) ||
    (records.length >= tab.limit &&
      (totalCount == null || tab.offset + records.length < totalCount));
  const selectedIndex = tab.selectedRecord
    ? records.findIndex((r) => r.id === tab.selectedRecord?.id)
    : -1;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <CollectionHeader
          schema={schema}
          collectionName={tab.collection ?? ""}
          loading={loading}
          readOnly={readOnly}
          onRefresh={() => void loadData()}
          onUpsertRecord={() => setUpsertOpen(true)}
          onOpenSearch={() => {
            if (!tab.target || !tab.collection) return;
            openSearchTab(
              tab.connectionKey,
              tab.target,
              tab.collection,
              tab.collection,
            );
          }}
          onOpenVisualizer={
            renderVisualizerButton
              ? () => {
                  if (!tab.target || !tab.collection) return;
                  openVisualizerTab(
                    tab.connectionKey,
                    tab.target,
                    tab.collection,
                    tab.collection,
                  );
                }
              : undefined
          }
          onOpenImportExport={
            onOpenImportExport && tab.target && tab.collection
              ? () =>
                  onOpenImportExport(tab.target!, tab.collection!, schema, readOnly)
              : undefined
          }
          onOpenMigrate={
            onOpenMigrate && tab.target && tab.collection
              ? () => onOpenMigrate(tab.target!, tab.collection!, schema)
              : undefined
          }
          onOpenIndexes={
            supportsIndexes ? () => setIndexesOpen(true) : undefined
          }
          onDeleteCollection={() => setConfirmDeleteCol(true)}
        />

        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-2">
          <FilterBuilder
            value={tab.filter}
            onChange={(filter) =>
              updateTab(tab.id, {
                filter,
                offset: 0,
                cursorHistory: [null],
              })
            }
            onApply={() => void loadData()}
          />
        </div>

        <RecordTable
          records={records}
          loading={loading}
          readOnly={readOnly}
          selectedId={tab.selectedRecord?.id ?? null}
          totalCount={totalCount}
          pageInfo={`Offset ${tab.offset}`}
          canPrev={canPrev}
          canNext={canNext}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
          onSelectRecord={(rec) =>
            updateTab(tab.id, { selectedRecord: rec, drawerOpen: true })
          }
          onFindSimilar={(rec) => {
            if (!tab.target || !tab.collection) return;
            openSearchTab(
              tab.connectionKey,
              tab.target,
              tab.collection,
              tab.collection,
              rec,
            );
          }}
          onDeleteRecords={(ids) => {
            if (!tab.target || !tab.collection) return;
            void deleteRecords(tab.target, tab.collection, ids)
              .then(() => {
                toast.info(`Deleted ${ids.length} record(s)`);
                void loadData();
              })
              .catch((err: unknown) =>
                toast.error(
                  "Delete failed",
                  err instanceof Error ? err.message : String(err),
                ),
              );
          }}
        />
      </div>

      {tab.drawerOpen && (
        <MetadataDrawer
          record={tab.selectedRecord}
          readOnly={readOnly}
          positionLabel={
            selectedIndex >= 0
              ? `${selectedIndex + 1} / ${records.length}`
              : undefined
          }
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex >= 0 && selectedIndex < records.length - 1}
          onPrev={() => {
            if (selectedIndex > 0) {
              updateTab(tab.id, { selectedRecord: records[selectedIndex - 1] });
            }
          }}
          onNext={() => {
            if (selectedIndex >= 0 && selectedIndex < records.length - 1) {
              updateTab(tab.id, { selectedRecord: records[selectedIndex + 1] });
            }
          }}
          onClose={() => updateTab(tab.id, { drawerOpen: false })}
          onFindSimilar={(rec) => {
            if (!tab.target || !tab.collection) return;
            openSearchTab(
              tab.connectionKey,
              tab.target,
              tab.collection,
              tab.collection,
              rec,
            );
          }}
          onSave={async (updated) => {
            if (!tab.target || !tab.collection) return;
            await upsertRecords(tab.target, tab.collection, [updated]);
            updateTab(tab.id, { selectedRecord: updated });
            await loadData();
          }}
          onDelete={async (id) => {
            if (!tab.target || !tab.collection) return;
            await deleteRecords(tab.target, tab.collection, [id]);
            updateTab(tab.id, { drawerOpen: false, selectedRecord: null });
            await loadData();
          }}
        />
      )}

      <UpsertRecordModal
        open={upsertOpen}
        onOpenChange={setUpsertOpen}
        target={tab.target ?? null}
        collection={tab.collection ?? null}
        expectedDimensions={schema?.dimensions}
        onUpserted={() => void loadData()}
      />

      <IndexManagerModal
        open={indexesOpen}
        onOpenChange={setIndexesOpen}
        target={tab.target ?? null}
        collection={tab.collection ?? null}
        engineType={engineType}
        schema={schema}
        readOnly={readOnly}
        onChanged={() => void loadData()}
      />

      <Dialog
        open={confirmDeleteCol}
        onOpenChange={setConfirmDeleteCol}
        title="Delete Collection"
        description={`Permanently delete collection "${tab.collection ?? ""}" and all vectors inside it?`}
        maxWidthClass="w-[400px]"
      >
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmDeleteCol(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              if (!tab.target || !tab.collection) return;
              void deleteCollection(tab.target, tab.collection)
                .then(() => {
                  toast.info(`Deleted collection "${tab.collection}"`);
                  setConfirmDeleteCol(false);
                  onCollectionDeleted();
                })
                .catch((err: unknown) =>
                  toast.error(
                    "Delete failed",
                    err instanceof Error ? err.message : String(err),
                  ),
                );
            }}
          >
            Delete Collection
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function ExplorerWorkspace({
  renderVisualizerTab,
  renderVisualizerButton = false,
  onOpenImportExport,
  onOpenMigrate,
  onExportSearchResults,
}: {
  renderVisualizerTab?: (tab: WorkspaceTab) => React.ReactNode;
  renderVisualizerButton?: boolean;
  onOpenImportExport?: (
    target: ConnectionTarget,
    collection: string,
    schema: CollectionSchema | null,
    readOnly: boolean,
  ) => void;
  onOpenMigrate?: (
    target: ConnectionTarget,
    collection: string,
    schema: CollectionSchema | null,
  ) => void;
  onExportSearchResults?: (records: VectorRecord[]) => void;
}) {
  const selectedConnectionKey = useRuntimeStore((s) => s.selectedConnectionKey);
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const refreshInstances = useRuntimeStore((s) => s.refreshInstances);

  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setActiveTabId = useTabsStore((s) => s.setActiveTabId);
  const remoteConnections = useTabsStore((s) => s.remoteConnections);
  const openCollectionTab = useTabsStore((s) => s.openCollectionTab);
  const openSearchTab = useTabsStore((s) => s.openSearchTab);
  const openVisualizerTab = useTabsStore((s) => s.openVisualizerTab);
  const openLogsTab = useTabsStore((s) => s.openLogsTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const closeTabsForCollection = useTabsStore((s) => s.closeTabsForCollection);
  const refreshConnectionCollections = useTabsStore(
    (s) => s.refreshConnectionCollections,
  );
  const clearConnectionCollections = useTabsStore(
    (s) => s.clearConnectionCollections,
  );

  const [collectionFilter, setCollectionFilter] = React.useState("");
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const [createColOpen, setCreateColOpen] = React.useState(false);
  const [deleteColName, setDeleteColName] = React.useState<string | null>(null);
  const [deletingCol, setDeletingCol] = React.useState(false);
  const [connBusy, setConnBusy] = React.useState(false);
  const [connectingKey, setConnectingKey] = React.useState<string | null>(null);
  const [snippetModalOpen, setSnippetModalOpen] = React.useState(false);
  const switcherBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const probeSeqRef = React.useRef(0);
  const mountedRef = React.useRef(true);
  const skipNextAutoRefreshKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resolvedConnection = React.useMemo(() => {
    if (!selectedConnectionKey) return null;
    if (selectedConnectionKey.startsWith("local:")) {
      const id = selectedConnectionKey.slice("local:".length);
      const inst = instances.find((i) => i.id === id);
      if (!inst) return null;
      const m = metrics[inst.id];
      const st = m?.status ?? "stopped";
      const isEmbedded = st === "embedded" || inst.engine_type === "lancedb";
      return {
        key: selectedConnectionKey,
        kind: "local" as const,
        instanceId: inst.id,
        name: inst.name,
        engineType: inst.engine_type,
        engineVersion: inst.engine_version,
        host: inst.host,
        port: inst.port,
        dataDir: inst.data_dir,
        hasAuth: false,
        readOnly: false,
        endpoint: isEmbedded ? null : `${inst.host}:${inst.port}`,
        description: inst.description ?? null,
        ramBytes: m?.ram_bytes ?? null,
        cpuPercent: m?.cpu_percent ?? null,
        subtitle: isEmbedded
          ? `${inst.engine_type.toUpperCase()} · Embedded`
          : `${inst.engine_type.toUpperCase()} · ${inst.host}:${inst.port}`,
        status: st,
        isEmbedded,
        target: { kind: "local_instance", instance_id: inst.id } as ConnectionTarget,
        ready: st === "running" || isEmbedded,
      };
    }
    if (selectedConnectionKey.startsWith("remote:")) {
      const id = selectedConnectionKey.slice("remote:".length);
      const conn = remoteConnections.find((r) => r.id === id);
      if (!conn) return null;
      return {
        key: selectedConnectionKey,
        kind: "remote" as const,
        instanceId: null,
        name: conn.name,
        engineType: conn.engine_type,
        engineVersion: null as string | null,
        host: undefined as string | undefined,
        port: undefined as number | undefined,
        dataDir: undefined as string | undefined,
        hasAuth: conn.auth_type !== "none",
        readOnly: Boolean(conn.read_only),
        endpoint: conn.endpoint_url,
        description: conn.description ?? null,
        ramBytes: null as number | null,
        cpuPercent: null as number | null,
        subtitle: `${conn.engine_type.toUpperCase()} · ${conn.endpoint_url}`,
        status: "running" as InstanceStatus,
        isEmbedded: false,
        target: {
          kind: "remote_connection",
          connection_id: conn.id,
        } as ConnectionTarget,
        ready: true,
      };
    }
    return null;
  }, [selectedConnectionKey, instances, metrics, remoteConnections]);

  const rawCollections = useTabsStore((s) =>
    resolvedConnection ? s.collectionsByConnection[resolvedConnection.key] : undefined,
  );
  const loadingCols = useTabsStore((s) =>
    resolvedConnection ? Boolean(s.loadingConnections[resolvedConnection.key]) : false,
  );
  const colsError = useTabsStore((s) =>
    resolvedConnection ? (s.connectionErrors[resolvedConnection.key] ?? null) : null,
  );
  const collections = rawCollections ?? EMPTY_COLLECTIONS;

  React.useEffect(() => {
    if (!resolvedConnection) return;
    setCollectionFilter("");
    if (resolvedConnection.ready) {
      if (skipNextAutoRefreshKeyRef.current === resolvedConnection.key) {
        skipNextAutoRefreshKeyRef.current = null;
        return;
      }
      void refreshConnectionCollections(
        resolvedConnection.key,
        resolvedConnection.target,
      );
    }
  }, [
    resolvedConnection?.key,
    resolvedConnection?.ready,
    refreshConnectionCollections,
  ]);

  const handleCloseSwitcher = React.useCallback(() => {
    probeSeqRef.current += 1;
    setConnectingKey(null);
    setSwitcherOpen(false);
  }, []);

  const handleOpenConnection = async (
    key: string,
    target: ConnectionTarget,
    ready: boolean,
  ) => {
    const seq = ++probeSeqRef.current;

    if (target.kind === "remote_connection") {
      if (connectingKey === key) return;
      const connName =
        remoteConnections.find((r) => r.id === target.connection_id)?.name ??
        "Remote connection";
      setConnectingKey(key);
      const res = await refreshConnectionCollections(key, target);
      if (!mountedRef.current || probeSeqRef.current !== seq) return;
      setConnectingKey((curr) => (curr === key ? null : curr));

      if (!res.ok) {
        const reason = res.error ?? "Unable to reach endpoint.";
        toast.error(`Could not reach "${connName}"`, reason);
        return;
      }

      skipNextAutoRefreshKeyRef.current = key;
      setSelectedConnectionKey(key);
      setActiveTabId(null);
      setSwitcherOpen(false);
      return;
    }

    setConnectingKey(null);
    setSelectedConnectionKey(key);
    setActiveTabId(null);
    setSwitcherOpen(false);
    if (ready && selectedConnectionKey === key) {
      void refreshConnectionCollections(key, target);
    }
  };

  const handleToggleLocalRun = async () => {
    if (
      !resolvedConnection?.instanceId ||
      resolvedConnection.isEmbedded ||
      connBusy
    ) {
      return;
    }
    setConnBusy(true);
    try {
      if (resolvedConnection.status === "running") {
        await stopInstance(resolvedConnection.instanceId);
        clearConnectionCollections(resolvedConnection.key);
        toast.info(`Stopping ${resolvedConnection.name}`);
      } else {
        await startInstance(resolvedConnection.instanceId);
        toast.success(`Started ${resolvedConnection.name}`);
        await refreshInstances();
        void refreshConnectionCollections(
          resolvedConnection.key,
          resolvedConnection.target,
        );
      }
    } catch (err: unknown) {
      toast.error(
        `Failed to ${resolvedConnection.status === "running" ? "stop" : "start"} ${resolvedConnection.name}`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setConnBusy(false);
    }
  };

  const handleConfirmDeleteCollection = async () => {
    if (!resolvedConnection || !deleteColName || deletingCol) return;
    setDeletingCol(true);
    try {
      await deleteCollection(resolvedConnection.target, deleteColName);
      closeTabsForCollection(resolvedConnection.key, deleteColName);
      toast.info(`Deleted collection "${deleteColName}"`);
      setDeleteColName(null);
      await refreshConnectionCollections(
        resolvedConnection.key,
        resolvedConnection.target,
      );
    } catch (err: unknown) {
      toast.error(
        "Failed to delete collection",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setDeletingCol(false);
    }
  };

  const activeTab =
    tabs.find(
      (t) =>
        t.id === activeTabId &&
        (!resolvedConnection || t.connectionKey === resolvedConnection.key),
    ) ?? null;

  const isTargetReadOnly = React.useCallback(
    (target?: ConnectionTarget) => {
      if (!target || target.kind !== "remote_connection") return false;
      return Boolean(
        remoteConnections.find((r) => r.id === target.connection_id)?.read_only,
      );
    },
    [remoteConnections],
  );

  const activeTabReadOnly = isTargetReadOnly(activeTab?.target);

  const resolveTargetEngineType = React.useCallback(
    (target?: ConnectionTarget) => {
      if (!target) return "";
      if (target.kind === "local_instance") {
        return (
          instances.find((i) => i.id === target.instance_id)?.engine_type ?? ""
        );
      }
      if (target.kind === "remote_connection") {
        return (
          remoteConnections.find((r) => r.id === target.connection_id)
            ?.engine_type ?? ""
        );
      }
      return target.engine_type;
    },
    [instances, remoteConnections],
  );
  const activeTabEngineType = resolveTargetEngineType(activeTab?.target);

  const snippetName = resolvedConnection?.name ?? "";
  const snippetEngine = resolvedConnection?.engineType ?? "";
  const snippetHost = resolvedConnection?.host;
  const snippetPort = resolvedConnection?.port;
  const snippetEndpoint =
    resolvedConnection?.kind === "remote"
      ? (resolvedConnection.endpoint ?? undefined)
      : undefined;
  const snippetDataDir = resolvedConnection?.dataDir;
  const snippetHasAuth = resolvedConnection?.hasAuth ?? false;
  const hasResolvedConnection = Boolean(resolvedConnection);

  const connectionSnippets = React.useMemo(() => {
    if (!hasResolvedConnection) return [];
    return generateConnectionSnippets({
      name: snippetName,
      engineType: snippetEngine,
      host: snippetHost,
      port: snippetPort,
      endpointUrl: snippetEndpoint,
      dataDir: snippetDataDir,
      hasAuth: snippetHasAuth,
    });
  }, [
    hasResolvedConnection,
    snippetName,
    snippetEngine,
    snippetHost,
    snippetPort,
    snippetEndpoint,
    snippetDataDir,
    snippetHasAuth,
  ]);

  const canGoBack = Boolean(resolvedConnection || activeTab);

  const handleBackToConnections = React.useCallback(() => {
    probeSeqRef.current += 1;
    setConnectingKey(null);
    setSelectedConnectionKey(null);
    setActiveTabId(null);
    setSwitcherOpen(false);
  }, [setActiveTabId, setSelectedConnectionKey]);

  const handleExplorerBack = React.useCallback(() => {
    if (switcherOpen) {
      handleCloseSwitcher();
      return;
    }
    if (activeTab && resolvedConnection) {
      setActiveTabId(null);
      return;
    }
    if (resolvedConnection || activeTab) {
      handleBackToConnections();
    }
  }, [
    switcherOpen,
    handleCloseSwitcher,
    activeTab,
    resolvedConnection,
    setActiveTabId,
    handleBackToConnections,
  ]);

  const canGoBackRef = React.useRef(canGoBack);
  canGoBackRef.current = canGoBack;
  const handleExplorerBackRef = React.useRef(handleExplorerBack);
  handleExplorerBackRef.current = handleExplorerBack;
  const lastDirectBackAtRef = React.useRef(0);
  const mouseBackBlockedRef = React.useRef(false);

  React.useEffect(() => {
    if (canGoBack) {
      pushBackGuard();
    }
  }, [canGoBack, resolvedConnection?.key, activeTab?.id, switcherOpen]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const isMac = /Mac|iPhone|iPad|iPod/i.test(
      navigator.platform || navigator.userAgent,
    );
    let repushTimer: number | undefined;

    const scheduleGuardRepush = () => {
      if (repushTimer !== undefined) {
        window.clearTimeout(repushTimer);
      }
      repushTimer = window.setTimeout(() => {
        repushTimer = undefined;
        if (canGoBackRef.current) {
          pushBackGuard();
        }
      }, 0);
    };

    const triggerDirectBack = (event: Event) => {
      if (!canGoBackRef.current || hasOpenModal()) return;
      event.preventDefault();
      event.stopPropagation();
      lastDirectBackAtRef.current = performance.now();
      handleExplorerBackRef.current();
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 3 || !canGoBackRef.current) return;
      if (hasOpenModal()) {
        mouseBackBlockedRef.current = true;
        lastDirectBackAtRef.current = performance.now();
        return;
      }
      mouseBackBlockedRef.current = false;
      event.preventDefault();
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button !== 3) return;
      if (mouseBackBlockedRef.current) {
        mouseBackBlockedRef.current = false;
        return;
      }
      triggerDirectBack(event);
    };

    const handleAuxClick = (event: MouseEvent) => {
      if (event.button === 3 && canGoBackRef.current && !hasOpenModal()) {
        event.preventDefault();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "BrowserBack") {
        triggerDirectBack(event);
        return;
      }
      if (
        !isMac &&
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key === "ArrowLeft"
      ) {
        triggerDirectBack(event);
      }
    };

    const handlePopState = () => {
      if (!canGoBackRef.current) return;
      if (performance.now() - lastDirectBackAtRef.current < 150) {
        scheduleGuardRepush();
        return;
      }
      if (hasOpenModal()) {
        if (useAppStore.getState().settingsOpen) {
          useAppStore.getState().setSettingsOpen(false);
        }
        scheduleGuardRepush();
        return;
      }
      handleExplorerBackRef.current();
      scheduleGuardRepush();
    };

    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("auxclick", handleAuxClick, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("popstate", handlePopState);

    return () => {
      if (repushTimer !== undefined) {
        window.clearTimeout(repushTimer);
      }
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
      window.removeEventListener("auxclick", handleAuxClick, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  if (!resolvedConnection && !activeTab) {
    return (
      <ExplorerHome
        onOpenConnection={handleOpenConnection}
        connectingKey={connectingKey}
      />
    );
  }

  const normalizedFilter = collectionFilter.trim().toLowerCase();
  const filteredCollections = collections.filter((c) =>
    normalizedFilter ? c.name.toLowerCase().includes(normalizedFilter) : true,
  );

  const connectionHasTabs = resolvedConnection
    ? tabs.some((t) => t.connectionKey === resolvedConnection.key)
    : false;

  const collectionsLeadingSlot = resolvedConnection ? (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === null}
      onClick={() => setActiveTabId(null)}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors cursor-pointer select-none",
        activeTab === null
          ? "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]"
          : "border-transparent bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]/60 hover:text-[var(--text-primary)]",
      )}
    >
      <Layers className="h-3 w-3 text-[var(--accent-primary)]" />
      <span className="leading-none">Collections</span>
      <span className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-[var(--bg-canvas)] px-1.5 font-mono text-[10px] leading-none text-[var(--text-muted)]">
        {collections.length}
      </span>
    </button>
  ) : undefined;

  const renderSwitchTrigger = () => (
    <button
      ref={switcherBtnRef}
      type="button"
      onClick={() => {
        setSwitcherOpen((prev) => !prev);
      }}
      aria-expanded={switcherOpen}
      className={cn(
        "explorer-switcher-trigger shrink-0 inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors cursor-pointer",
        switcherOpen
          ? "border-[var(--accent-primary)]/50 bg-[var(--bg-elevated)] text-[var(--accent-primary)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]",
      )}
    >
      <Layers className="h-3 w-3" />
      <span>Switch</span>
      <ChevronDown className="h-3 w-3" />
    </button>
  );

  const renderRunToggleButton = () => {
    if (
      !resolvedConnection ||
      resolvedConnection.kind !== "local" ||
      resolvedConnection.isEmbedded ||
      !resolvedConnection.instanceId
    ) {
      return null;
    }
    const isRunning = resolvedConnection.status === "running";
    return (
      <Button
        type="button"
        variant={isRunning ? "outline" : "default"}
        size="sm"
        disabled={
          connBusy ||
          resolvedConnection.status === "starting" ||
          resolvedConnection.status === "stopping"
        }
        onClick={() => void handleToggleLocalRun()}
      >
        {isRunning ? (
          <>
            <Square className="h-3 w-3 fill-current text-[var(--status-error)]" />
            Stop
          </>
        ) : (
          <>
            <Play className="h-3 w-3 fill-current" />
            Start
          </>
        )}
      </Button>
    );
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {resolvedConnection && (
        <div className="shrink-0">
          <div className="mx-auto max-w-6xl space-y-4 px-6 pt-6 pb-4">
            {/* Lightweight Breadcrumb & Switcher Row */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 h-7 px-2"
                onClick={handleBackToConnections}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Connections
              </Button>
              <span className="text-[var(--border-strong)]">/</span>
              {renderSwitchTrigger()}
            </div>

            <PageHeader
              icon={
                resolvedConnection.kind === "remote" ? (
                  <Globe className="h-4 w-4 shrink-0 text-[var(--accent-secondary)]" />
                ) : (
                  <Database className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
                )
              }
              title={resolvedConnection.name}
              badges={
                <>
                  <InstanceStatusBadge
                    kind={resolvedConnection.kind}
                    status={resolvedConnection.status}
                  />
                  {resolvedConnection.readOnly && (
                    <Badge variant="warning" className="h-5 text-[10px]">
                      <Lock className="h-2.5 w-2.5" />
                      Read-Only
                    </Badge>
                  )}
                  {resolvedConnection.ready && (
                    <span className="inline-flex h-5 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] leading-none text-[var(--text-secondary)]">
                      {collections.length}
                    </span>
                  )}
                </>
              }
              description={
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[11px] uppercase text-[var(--accent-secondary)]">
                    {resolvedConnection.engineType}
                    {resolvedConnection.engineVersion
                      ? ` v${resolvedConnection.engineVersion}`
                      : ""}
                  </span>
                  {resolvedConnection.endpoint ? (
                    <>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="font-mono text-[11px]">
                        {resolvedConnection.endpoint}
                      </span>
                    </>
                  ) : resolvedConnection.isEmbedded ? (
                    <>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="font-mono text-[11px]">Embedded</span>
                    </>
                  ) : null}
                  {resolvedConnection.status === "running" &&
                    resolvedConnection.ramBytes != null && (
                      <>
                        <span className="text-[var(--text-muted)]">·</span>
                        <span className="font-mono text-[11px] text-[var(--accent-primary)]">
                          RAM {formatRamMb(resolvedConnection.ramBytes)}
                        </span>
                        {resolvedConnection.cpuPercent != null && (
                          <span className="font-mono text-[11px]">
                            CPU {resolvedConnection.cpuPercent.toFixed(1)}%
                          </span>
                        )}
                      </>
                    )}
                  {resolvedConnection.description && (
                    <>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span>{resolvedConnection.description}</span>
                    </>
                  )}
                </span>
              }
              actions={
                <>
                  {resolvedConnection.kind === "local" &&
                    !resolvedConnection.isEmbedded &&
                    resolvedConnection.instanceId && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            openLogsTab(
                              resolvedConnection.instanceId!,
                              resolvedConnection.name,
                            )
                          }
                        >
                          <Terminal className="h-3.5 w-3.5" />
                          Logs
                        </Button>
                        {renderRunToggleButton()}
                      </>
                    )}

                  {resolvedConnection.ready && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        title="Copy connection snippet"
                        onClick={() => setSnippetModalOpen(true)}
                      >
                        <Code2 className="h-3.5 w-3.5" />
                        Code
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Refresh Collections"
                        onClick={() =>
                          void refreshConnectionCollections(
                            resolvedConnection.key,
                            resolvedConnection.target,
                          )
                        }
                      >
                        <RefreshCw
                          className={cn(
                            "h-3.5 w-3.5",
                            loadingCols && "animate-spin",
                          )}
                        />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={resolvedConnection.readOnly}
                        title={
                          resolvedConnection.readOnly
                            ? "Disabled in Read-Only mode"
                            : "New Collection"
                        }
                        onClick={() => setCreateColOpen(true)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        New Collection
                      </Button>
                    </>
                  )}
                </>
              }
            />

            {/* Inline Open Tabs Strip (only when this connection has open tabs) */}
            {connectionHasTabs && (
              <WorkspaceTabs
                variant="inline"
                connectionKey={resolvedConnection.key}
                leadingSlot={collectionsLeadingSlot}
              />
            )}
          </div>
        </div>
      )}

      {activeTab ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden px-6 pb-6 pt-1">
            {activeTab.kind === "logs" && activeTab.instanceId ? (
              <LogViewer instanceId={activeTab.instanceId} fullHeight />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                {activeTab.kind === "collection" ? (
                  <CollectionTabPane
                    key={activeTab.id}
                    tab={activeTab}
                    engineType={activeTabEngineType}
                    readOnly={activeTabReadOnly}
                    renderVisualizerButton={renderVisualizerButton}
                    onOpenImportExport={onOpenImportExport}
                    onOpenMigrate={onOpenMigrate}
                    onCollectionDeleted={() => {
                      const deletedTarget = activeTab.target;
                      const deletedConnKey = activeTab.connectionKey;
                      closeTab(activeTab.id);
                      if (deletedTarget) {
                        void refreshConnectionCollections(
                          deletedConnKey,
                          deletedTarget,
                        );
                      }
                    }}
                  />
                ) : activeTab.kind === "search" ? (
                  <SearchPlayground
                    key={activeTab.id}
                    tab={activeTab}
                    readOnly={activeTabReadOnly}
                    onExportSearchResults={onExportSearchResults}
                  />
                ) : activeTab.kind === "visualizer" && renderVisualizerTab ? (
                  renderVisualizerTab(activeTab)
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : resolvedConnection ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl space-y-5 px-6 pb-6 pt-1">
            {!resolvedConnection.ready ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-12 text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--status-stopped)]">
                  <Square className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  {resolvedConnection.name} is currently stopped
                </h2>
                <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
                  Start this local vector database instance to inspect collections, browse records, and run searches.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={connBusy || resolvedConnection.status === "starting"}
                    onClick={() => void handleToggleLocalRun()}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    {connBusy || resolvedConnection.status === "starting"
                      ? `Starting ${resolvedConnection.name}...`
                      : `Start ${resolvedConnection.name}`}
                  </Button>
                  {resolvedConnection.instanceId && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        openLogsTab(
                          resolvedConnection.instanceId!,
                          resolvedConnection.name,
                        )
                      }
                    >
                      <Terminal className="h-3.5 w-3.5" />
                      View Logs
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 transition-colors focus-within:border-[var(--border-strong)]">
                    <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                    <input
                      type="text"
                      value={collectionFilter}
                      onChange={(e) => setCollectionFilter(e.target.value)}
                      placeholder="Filter collections by name..."
                      className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                    />
                    {collectionFilter && (
                      <button
                        type="button"
                        onClick={() => setCollectionFilter("")}
                        aria-label="Clear filter"
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {colsError && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-4 py-3 text-xs text-[var(--status-error)]">
                    <span>{colsError}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void refreshConnectionCollections(
                          resolvedConnection.key,
                          resolvedConnection.target,
                        )
                      }
                    >
                      Retry
                    </Button>
                  </div>
                )}

                {filteredCollections.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-12 text-center">
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--accent-primary)]">
                      <Layers className="h-5 w-5" />
                    </div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      {loadingCols
                        ? "Loading collections..."
                        : collectionFilter
                          ? "No matching collections"
                          : "No collections in this database yet"}
                    </h2>
                    <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
                      Create a vector collection to insert records, inspect metadata, and run similarity search.
                    </p>
                    {!loadingCols && (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-4"
                        disabled={resolvedConnection.readOnly}
                        title={
                          resolvedConnection.readOnly
                            ? "Disabled in Read-Only mode"
                            : "Create Collection"
                        }
                        onClick={() => setCreateColOpen(true)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Create Collection
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {filteredCollections.map((col) => (
                      <div
                        key={col.name}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          openCollectionTab(
                            resolvedConnection.key,
                            resolvedConnection.target,
                            col.name,
                            resolvedConnection.name,
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openCollectionTab(
                              resolvedConnection.key,
                              resolvedConnection.target,
                              col.name,
                              resolvedConnection.name,
                            );
                          }
                        }}
                        className="group flex flex-col justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition-colors hover:border-[var(--border-strong)] cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Layers className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" />
                              <h3 className="truncate text-sm font-semibold leading-tight text-[var(--text-primary)]">
                                {col.name}
                              </h3>
                              {col.dimensions !== null && (
                                <Badge
                                  variant="default"
                                  className="font-mono text-[10px]"
                                >
                                  {col.dimensions} dims
                                </Badge>
                              )}
                            </div>
                            <div className="mt-1.5 font-mono text-[11px] leading-none text-[var(--text-secondary)]">
                              {col.vector_count !== null
                                ? `${col.vector_count.toLocaleString()} vectors`
                                : "Vector count N/A"}
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openCollectionTab(
                                resolvedConnection.key,
                                resolvedConnection.target,
                                col.name,
                                resolvedConnection.name,
                              );
                            }}
                          >
                            Browse
                            <ArrowRight className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                          </Button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                openSearchTab(
                                  resolvedConnection.key,
                                  resolvedConnection.target,
                                  col.name,
                                  resolvedConnection.name,
                                );
                              }}
                            >
                              <Search className="h-3 w-3 text-[var(--accent-ai)]" />
                              Search
                            </Button>
                            {renderVisualizerButton && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openVisualizerTab(
                                    resolvedConnection.key,
                                    resolvedConnection.target,
                                    col.name,
                                    resolvedConnection.name,
                                  );
                                }}
                              >
                                <ScatterChart className="h-3 w-3 text-[var(--accent-secondary)]" />
                                2D/3D
                              </Button>
                            )}
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={resolvedConnection.readOnly}
                            title={
                              resolvedConnection.readOnly
                                ? "Disabled in Read-Only mode"
                                : `Delete ${col.name}`
                            }
                            aria-label={`Delete collection ${col.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!resolvedConnection.readOnly) {
                                setDeleteColName(col.name);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      <ExplorerFloatingSwitcher
        open={switcherOpen}
        onClose={handleCloseSwitcher}
        anchorRef={switcherBtnRef}
        connectionKey={resolvedConnection?.key ?? null}
        connectionName={resolvedConnection?.name ?? null}
        target={resolvedConnection?.target ?? null}
        ready={resolvedConnection?.ready ?? false}
        readOnly={resolvedConnection?.readOnly ?? false}
        connectingKey={connectingKey}
        onSwitchConnection={handleOpenConnection}
        onCreateCollection={() => setCreateColOpen(true)}
        onRequestDeleteCollection={(col) => setDeleteColName(col)}
        onStartCurrent={
          resolvedConnection?.kind === "local" && !resolvedConnection.isEmbedded
            ? () => void handleToggleLocalRun()
            : undefined
        }
      />

      <CreateCollectionModal
        open={createColOpen}
        onOpenChange={setCreateColOpen}
        target={resolvedConnection?.target ?? null}
        onCreated={(colName) => {
          if (!resolvedConnection) return;
          void refreshConnectionCollections(
            resolvedConnection.key,
            resolvedConnection.target,
          );
          openCollectionTab(
            resolvedConnection.key,
            resolvedConnection.target,
            colName,
            resolvedConnection.name,
          );
        }}
      />

      <Dialog
        open={Boolean(deleteColName)}
        onOpenChange={(next) => {
          if (!next && !deletingCol) setDeleteColName(null);
        }}
        title="Delete Collection"
        description={`Permanently delete collection "${deleteColName ?? ""}" from "${resolvedConnection?.name ?? ""}"?`}
        maxWidthClass="w-[400px]"
      >
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={deletingCol}
            onClick={() => setDeleteColName(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deletingCol}
            onClick={() => void handleConfirmDeleteCollection()}
          >
            {deletingCol ? "Deleting..." : "Delete Collection"}
          </Button>
        </div>
      </Dialog>
      <SnippetModal
        open={snippetModalOpen}
        onOpenChange={setSnippetModalOpen}
        title={`Connect to ${resolvedConnection?.name ?? "Database"}`}
        snippets={connectionSnippets}
      />
    </div>
  );
}
