import * as React from "react";
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
import { ConnectionSidebar } from "@/components/sidebar/ConnectionSidebar";
import { ToastViewport } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getAppStatus } from "@/ipc/system";
import { useAppStore } from "@/stores/useAppStore";
import {
  subscribeRuntimeEvents,
  useRuntimeStore,
} from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";

export function App() {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const statusError = useAppStore((s) => s.statusError);
  const setAppStatus = useAppStore((s) => s.setAppStatus);
  const setStatusLoading = useAppStore((s) => s.setStatusLoading);
  const setStatusError = useAppStore((s) => s.setStatusError);
  const refreshAll = useRuntimeStore((s) => s.refreshAll);
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const refreshConnectionsAndProfiles = useTabsStore(
    (s) => s.refreshConnectionsAndProfiles,
  );

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

            {activeSection === "explorer" && <ExplorerWorkspace />}

            {activeSection !== "explorer" && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {activeSection === "runtimes" && (
                  <ServicesDashboard
                    onExploreInstance={(instanceId) => {
                      setSelectedConnectionKey(`local:${instanceId}`);
                      setActiveSection("explorer");
                    }}
                  />
                )}
                {activeSection === "store" && <EngineCatalog />}
                {activeSection === "settings" && <SettingsView />}
              </div>
            )}
          </main>
        </div>

        <CreateInstanceModal />
        <RemoteConnectionModal />
        <CommandPalette />
        <ToastViewport />
      </div>
    </TooltipProvider>
  );
}

export default App;
