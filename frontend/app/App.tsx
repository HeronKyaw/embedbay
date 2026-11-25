import * as React from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { ImportExportModal } from "@/components/explorer/ImportExportModal";
import { ExplorerWorkspace } from "@/components/explorer/ExplorerWorkspace";
import { RemoteConnectionModal } from "@/components/explorer/RemoteConnectionModal";
import { ActivityRail } from "@/components/layout/ActivityRail";
import { AdaptiveTitlebar } from "@/components/layout/AdaptiveTitlebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { StatusBar } from "@/components/layout/StatusBar";
import { CreateInstanceModal } from "@/components/manager/CreateInstanceModal";
import { EngineCatalog } from "@/components/manager/EngineCatalog";
import { ServicesDashboard } from "@/components/manager/ServicesDashboard";
import { SettingsModal } from "@/components/settings/SettingsView";
import {
  StorageAndUpdatesPanels,
  UnusedEngineCleanupBanner,
} from "@/components/settings/StorageAndUpdatesPanels";
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
  const toggleSettings = useAppStore((s) => s.toggleSettings);
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
  const refreshConnectionCollections = useTabsStore(
    (s) => s.refreshConnectionCollections,
  );
  const setActiveTabId = useTabsStore((s) => s.setActiveTabId);

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
    let removeSplashTimer: number | undefined;

    const dismissSplash = () => {
      const splash = document.getElementById("embedbay-splash");
      if (!splash) return;
      splash.classList.add("splash-hidden");
      removeSplashTimer = window.setTimeout(() => {
        splash.remove();
      }, 250);
    };

    setStatusLoading(true);
    const statusPromise = getAppStatus()
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

    const bootstrapPromise = Promise.allSettled([
      statusPromise,
      refreshAll(),
      refreshConnectionsAndProfiles(),
    ]);
    const timeoutPromise = new Promise<void>((resolve) => {
      window.setTimeout(resolve, 1200);
    });

    void Promise.race([bootstrapPromise, timeoutPromise]).then(() => {
      if (active) dismissSplash();
    });

    const unlisten = subscribeRuntimeEvents();

    return () => {
      active = false;
      if (removeSplashTimer !== undefined) {
        window.clearTimeout(removeSplashTimer);
      }
      unlisten();
    };
  }, [
    setAppStatus,
    setStatusError,
    setStatusLoading,
    refreshAll,
    refreshConnectionsAndProfiles,
  ]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        toggleSettings();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSettings]);

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

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ActivityRail />

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
                      const key = `local:${instanceId}`;
                      setSelectedConnectionKey(key);
                      setActiveTabId(null);
                      setActiveSection("explorer");
                      void refreshConnectionCollections(key, {
                        kind: "local_instance",
                        instance_id: instanceId,
                      });
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
              </div>
            )}
          </main>
        </div>

        <StatusBar />

        <SettingsModal extraPanels={<StorageAndUpdatesPanels />} />
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
