import * as React from "react";
import { Database, Globe, PlugZap, Search } from "lucide-react";
import { CollectionHeader } from "@/components/explorer/CollectionHeader";
import { CollectionTree } from "@/components/explorer/CollectionTree";
import {
  CreateCollectionModal,
  UpsertRecordModal,
} from "@/components/explorer/CrudModal";
import { MetadataDrawer } from "@/components/explorer/MetadataDrawer";
import { RecordTable } from "@/components/explorer/RecordTable";
import { LogViewer } from "@/components/manager/LogViewer";
import { FilterBuilder } from "@/components/search/FilterBuilder";
import { SearchPlayground } from "@/components/search/SearchPlayground";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  browseRecords,
  deleteCollection,
  deleteRecords,
  getCollectionInfo,
  listCollections,
  upsertRecords,
} from "@/ipc/explorer";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore, type WorkspaceTab } from "@/stores/useTabsStore";
import type {
  CollectionSchema,
  CollectionSummary,
  ConnectionTarget,
  VectorRecord,
} from "@/types/explorer";

function CollectionTabPane({
  tab,
  onCollectionDeleted,
  renderVisualizerButton,
  onOpenImportExport,
}: {
  tab: WorkspaceTab;
  onCollectionDeleted: () => void;
  renderVisualizerButton?: boolean;
  onOpenImportExport?: (
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
  const [loading, setLoading] = React.useState(false);
  const [upsertOpen, setUpsertOpen] = React.useState(false);
  const [confirmDeleteCol, setConfirmDeleteCol] = React.useState(false);

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

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <CollectionHeader
          schema={schema}
          collectionName={tab.collection ?? ""}
          loading={loading}
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
                  onOpenImportExport(tab.target!, tab.collection!, schema)
              : undefined
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
  onExportSearchResults,
}: {
  renderVisualizerTab?: (tab: WorkspaceTab) => React.ReactNode;
  renderVisualizerButton?: boolean;
  onOpenImportExport?: (
    target: ConnectionTarget,
    collection: string,
    schema: CollectionSchema | null,
  ) => void;
  onExportSearchResults?: (records: VectorRecord[]) => void;
}) {
  const selectedConnectionKey = useRuntimeStore((s) => s.selectedConnectionKey);
  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const remoteConnections = useTabsStore((s) => s.remoteConnections);
  const openCollectionTab = useTabsStore((s) => s.openCollectionTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const openRemoteModal = useTabsStore((s) => s.openRemoteModal);

  const [collections, setCollections] = React.useState<CollectionSummary[]>([]);
  const [loadingCols, setLoadingCols] = React.useState(false);
  const [createColOpen, setCreateColOpen] = React.useState(false);

  const resolvedConnection = React.useMemo(() => {
    if (!selectedConnectionKey) return null;
    if (selectedConnectionKey.startsWith("local:")) {
      const id = selectedConnectionKey.slice("local:".length);
      const inst = instances.find((i) => i.id === id);
      if (!inst) return null;
      const st = metrics[inst.id]?.status ?? "stopped";
      return {
        key: selectedConnectionKey,
        name: inst.name,
        target: { kind: "local_instance", instance_id: inst.id } as ConnectionTarget,
        ready: st === "running" || st === "embedded" || inst.engine_type === "lancedb",
      };
    }
    if (selectedConnectionKey.startsWith("remote:")) {
      const id = selectedConnectionKey.slice("remote:".length);
      const conn = remoteConnections.find((r) => r.id === id);
      if (!conn) return null;
      return {
        key: selectedConnectionKey,
        name: conn.name,
        target: {
          kind: "remote_connection",
          connection_id: conn.id,
        } as ConnectionTarget,
        ready: true,
      };
    }
    return null;
  }, [selectedConnectionKey, instances, metrics, remoteConnections]);

  const loadCollections = React.useCallback(async () => {
    if (!resolvedConnection || !resolvedConnection.ready) {
      setCollections([]);
      return;
    }
    setLoadingCols(true);
    try {
      const list = await listCollections(resolvedConnection.target);
      setCollections(list);
    } catch (err: unknown) {
      setCollections([]);
      toast.error(
        `Could not list collections on ${resolvedConnection.name}`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoadingCols(false);
    }
  }, [resolvedConnection]);

  React.useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {resolvedConnection && (
        <CollectionTree
          connectionName={resolvedConnection.name}
          collections={collections}
          activeCollection={activeTab?.collection ?? null}
          loading={loadingCols}
          onSelectCollection={(col) =>
            openCollectionTab(
              resolvedConnection.key,
              resolvedConnection.target,
              col,
              resolvedConnection.name,
            )
          }
          onRefresh={() => void loadCollections()}
          onCreateCollection={() => setCreateColOpen(true)}
          onDeleteCollection={(col) => {
            void deleteCollection(resolvedConnection.target, col)
              .then(() => {
                toast.info(`Deleted collection "${col}"`);
                const matching = tabs.filter(
                  (t) =>
                    t.connectionKey === resolvedConnection.key &&
                    t.collection === col,
                );
                for (const m of matching) closeTab(m.id);
                void loadCollections();
              })
              .catch((err: unknown) =>
                toast.error(
                  "Failed to delete collection",
                  err instanceof Error ? err.message : String(err),
                ),
              );
          }}
        />
      )}

      {/* Active Tab Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeTab ? (
          activeTab.kind === "collection" ? (
            <CollectionTabPane
              key={activeTab.id}
              tab={activeTab}
              renderVisualizerButton={renderVisualizerButton}
              onOpenImportExport={onOpenImportExport}
              onCollectionDeleted={() => {
                closeTab(activeTab.id);
                void loadCollections();
              }}
            />
          ) : activeTab.kind === "search" ? (
            <SearchPlayground
              key={activeTab.id}
              tab={activeTab}
              onExportSearchResults={onExportSearchResults}
            />
          ) : activeTab.kind === "visualizer" && renderVisualizerTab ? (
            renderVisualizerTab(activeTab)
          ) : activeTab.kind === "logs" && activeTab.instanceId ? (
            <div className="p-4">
              <LogViewer instanceId={activeTab.instanceId} />
            </div>
          ) : null
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--accent-primary)]">
              {resolvedConnection ? (
                <Search className="h-5 w-5" />
              ) : (
                <Database className="h-5 w-5" />
              )}
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {resolvedConnection
                ? resolvedConnection.ready
                  ? `Connected to ${resolvedConnection.name}`
                  : `${resolvedConnection.name} is currently stopped`
                : "Select a Connection to Explore"}
            </h2>
            <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
              {resolvedConnection
                ? resolvedConnection.ready
                  ? "Pick a collection from the left tree to open a tab, inspect vectors, or launch the Search Playground."
                  : "Start this local instance from the sidebar or Local Runtimes dashboard first."
                : "Choose any running local instance or remote database connection in the left sidebar."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {!resolvedConnection && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setActiveSection("runtimes")}
                  >
                    <PlugZap className="h-3.5 w-3.5" />
                    Local Runtimes
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => openRemoteModal()}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Add Remote Connection
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <CreateCollectionModal
        open={createColOpen}
        onOpenChange={setCreateColOpen}
        target={resolvedConnection?.target ?? null}
        onCreated={(colName) => {
          void loadCollections();
          if (resolvedConnection) {
            openCollectionTab(
              resolvedConnection.key,
              resolvedConnection.target,
              colName,
              resolvedConnection.name,
            );
          }
        }}
      />
    </div>
  );
}
