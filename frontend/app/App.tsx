import * as React from "react";
import { Database } from "lucide-react";
import { ActivityRail } from "@/components/layout/ActivityRail";
import { AdaptiveTitlebar } from "@/components/layout/AdaptiveTitlebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { CreateInstanceModal } from "@/components/manager/CreateInstanceModal";
import { EngineCatalog } from "@/components/manager/EngineCatalog";
import { ServicesDashboard } from "@/components/manager/ServicesDashboard";
import { SettingsView } from "@/components/settings/SettingsView";
import { ConnectionSidebar } from "@/components/sidebar/ConnectionSidebar";
import { Button } from "@/components/ui/button";
import { ToastViewport } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getAppStatus } from "@/ipc/system";
import { useAppStore } from "@/stores/useAppStore";
import {
  subscribeRuntimeEvents,
  useRuntimeStore,
} from "@/stores/useRuntimeStore";

function ExplorerReadyView() {
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const selectedConnectionKey = useRuntimeStore((s) => s.selectedConnectionKey);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--accent-primary)]">
        <Database className="h-5 w-5" />
      </div>
      <h2 className="text-sm font-semibold text-[var(--text-primary)]">
        Vector Explorer Ready
      </h2>
      <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
        {selectedConnectionKey
          ? `Selected connection: ${selectedConnectionKey}. Multi-tab browsing and search playground activate in Phase 3.`
          : "Select a running local instance or remote connection in the sidebar to explore collections."}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-4"
        onClick={() => setActiveSection("runtimes")}
      >
        Manage Local Runtimes
      </Button>
    </div>
  );
}

export function App() {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const statusError = useAppStore((s) => s.statusError);
  const setAppStatus = useAppStore((s) => s.setAppStatus);
  const setStatusLoading = useAppStore((s) => s.setStatusLoading);
  const setStatusError = useAppStore((s) => s.setStatusError);
  const refreshAll = useRuntimeStore((s) => s.refreshAll);

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
    const unlisten = subscribeRuntimeEvents();

    return () => {
      active = false;
      unlisten();
    };
  }, [setAppStatus, setStatusError, setStatusLoading, refreshAll]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <AdaptiveTitlebar />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ActivityRail />
          <ConnectionSidebar
            onSelectLocalInstance={() => setActiveSection("explorer")}
          />

          <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--bg-canvas)]">
            {statusError && (
              <div className="m-4 rounded-lg border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-4 py-3 text-xs text-[var(--status-error)]">
                IPC status check error: {statusError}
              </div>
            )}

            {activeSection === "runtimes" && (
              <ServicesDashboard
                onExploreInstance={() => setActiveSection("explorer")}
              />
            )}
            {activeSection === "store" && <EngineCatalog />}
            {activeSection === "explorer" && <ExplorerReadyView />}
            {activeSection === "settings" && <SettingsView />}
          </main>
        </div>

        <CreateInstanceModal />
        <CommandPalette />
        <ToastViewport />
      </div>
    </TooltipProvider>
  );
}

export default App;
