import * as React from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ImportExportModal } from "@/components/explorer/ImportExportModal";
import { ExplorerWorkspace } from "@/components/explorer/ExplorerWorkspace";
import { RemoteConnectionModal } from "@/components/explorer/RemoteConnectionModal";
import { ActivityRail } from "@/components/layout/ActivityRail";
import { AdaptiveTitlebar } from "@/components/layout/AdaptiveTitlebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { WorkspaceTabs } from "@/components/layout/WorkspaceTabs";
import { CreateInstanceModal } from "@/components/manager/CreateInstanceModal";
import { EngineCatalog } from "@/components/manager/EngineCatalog";
import { ServicesDashboard } from "@/components/manager/ServicesDashboard";
import { SettingsView } from "@/components/settings/SettingsView";
import {
  StorageAndUpdatesPanels,
  UnusedEngineCleanupBanner,
} from "@/components/settings/StorageAndUpdatesPanels";
import { ConnectionSidebar } from "@/components/sidebar/ConnectionSidebar";
import { ToastViewport, toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EmbeddingScatterPlot } from "@/components/visualizer/EmbeddingScatterPlot";
import { backupInstance, restoreInstance } from "@/ipc/instances";
import { getAppStatus, isTauriRuntime } from "@/ipc/system";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/stores/useAppStore";
import {
  subscribeRuntimeEvents,
  useRuntimeStore,
} from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type { ConnectionTarget, VectorRecord } from "@/types/explorer";
import type { InstanceRecord } from "@/types/runtime";

export function App() {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const statusError = useAppStore((s) => s.statusError);
  const setAppStatus = useAppStore((s) => s.setAppStatus);
  const setStatusLoading = useAppStore((s) => s.setStatusLoading);
  const setStatusError = useAppStore((s) => s.setStatusError);
  const refreshAll = useRuntimeStore((s) => s.refreshAll);
  const refreshInstances = useRuntimeStore((s) => s.refreshInstances);
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const refreshConnectionsAndProfiles = useTabsStore(
    (s) => s.refreshConnectionsAndProfiles,
  );

  const [transferModalOpen, setTransferModalOpen] = React.useState(false);
  const [transferTarget, setTransferTarget] =
    React.useState<ConnectionTarget | null>(null);
  const [transferCollection, setTransferCollection] = React.useState<
    string | null
  >(null);
  const [transferSearchRecords, setTransferSearchRecords] = React.useState<
    VectorRecord[] | null
  >(null);

  React.useEffect(() => {
    let active = true;
    setStatusLoading(true);
    getAppStatus()
      .then((status) => {
        if (!active) return;
        setAppStatus(status);
        setStatusError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setStatusError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setStatusLoading(false);
      });

    void refreshAll();
    void refreshConnectionsAndProfiles();
    const unlisten = subscribeRuntimeEvents();

    return () => {
      active = false;
      unlisten();
    };
  }, [
    setAppStatus,
    setStatusError,
    setStatusLoading,
    refreshAll,
    refreshConnectionsAndProfiles,
  ]);

  const handlePickDirectory = async (): Promise<string | null> => {
    if (!isTauriRuntime()) return null;
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      return typeof picked === "string" ? picked : null;
    } catch {
      return null;
    }
  };

  const handleBackupInstance = async (inst: InstanceRecord) => {
    if (!isTauriRuntime()) return;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const dest = await saveDialog({
        defaultPath: `${inst.name.replace(/\s+/g, "_")}-${stamp}.zip`,
        filters: [{ name: "EmbedBay Backup Archive", extensions: ["zip"] }],
      });
      if (!dest) return;
      toast.info(`Backing up "${inst.name}"...`, "Pausing service safely first.");
      const res = await backupInstance(inst.id, dest);
      toast.success(
        `Backup complete (${formatBytes(res.size_bytes)})`,
        res.zip_path,
      );
      await refreshInstances();
    } catch (err: unknown) {
      toast.error(
        "Backup failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleRestoreInstance = async (inst: InstanceRecord) => {
    if (!isTauriRuntime()) return;
    try {
      const src = await openDialog({
        multiple: false,
        filters: [{ name: "EmbedBay Backup Archive", extensions: ["zip"] }],
      });
      if (typeof src !== "string") return;
      toast.info(`Restoring "${inst.name}"...`, "Replacing data directory safely.");
      await restoreInstance(inst.id, src);
      toast.success(`Restored snapshot for "${inst.name}"`);
      await refreshInstances();
    } catch (err: unknown) {
      toast.error(
        "Restore failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <AdaptiveTitlebar />
        <WorkspaceTabs />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ActivityRail />
          <ConnectionSidebar
            onSelectConnection={() => setActiveSection("explorer")}
          />

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
            {statusError && (
              <div className="m-4 rounded-lg border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-4 py-3 text-xs text-[var(--status-error)]">
                IPC status check error: {statusError}
              </div>
            )}

            {activeSection === "explorer" && (
              <ExplorerWorkspace
                renderVisualizerButton
                renderVisualizerTab={(tab) => (
                  <EmbeddingScatterPlot key={tab.id} tab={tab} />
                )}
                onOpenImportExport={(target, collection) => {
                  setTransferTarget(target);
                  setTransferCollection(collection);
                  setTransferSearchRecords(null);
                  setTransferModalOpen(true);
                }}
                onExportSearchResults={(records) => {
                  setTransferTarget(null);
                  setTransferCollection("search-results");
                  setTransferSearchRecords(records);
                  setTransferModalOpen(true);
                }}
              />
            )}

            {activeSection !== "explorer" && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {activeSection === "runtimes" && (
                  <ServicesDashboard
                    onExploreInstance={(instanceId) => {
                      setSelectedConnectionKey(`local:${instanceId}`);
                      setActiveSection("explorer");
                    }}
                    onBackupInstance={(inst) => void handleBackupInstance(inst)}
                    onRestoreInstance={(inst) => void handleRestoreInstance(inst)}
                  />
                )}
                {activeSection === "store" && (
                  <EngineCatalog
                    storageCleanupBanner={<UnusedEngineCleanupBanner />}
                  />
                )}
                {activeSection === "settings" && (
                  <SettingsView extraPanels={<StorageAndUpdatesPanels />} />
                )}
              </div>
            )}
          </main>
        </div>

        <CreateInstanceModal onPickDirectory={handlePickDirectory} />
        <RemoteConnectionModal />
        <ImportExportModal
          open={transferModalOpen}
          onOpenChange={setTransferModalOpen}
          target={transferTarget}
          collection={transferCollection}
          searchRecords={transferSearchRecords}
        />
        <CommandPalette />
        <ToastViewport />
      </div>
    </TooltipProvider>
  );
}

export default App;
