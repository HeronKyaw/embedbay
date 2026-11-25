import * as React from "react";
import {
  CheckCircle2,
  Database,
  FolderOpen,
  HardDrive,
  Laptop,
  Power,
  Search,
  Sparkles,
  Tag,
} from "lucide-react";
import { ActivityRail } from "@/components/layout/ActivityRail";
import { AdaptiveTitlebar } from "@/components/layout/AdaptiveTitlebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getAppStatus, setAutostartEnabled } from "@/ipc/system";
import { useAppStore } from "@/stores/useAppStore";
import { SWATCH_PRESETS } from "@/types/system";

function SidebarPlaceholder() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const [searchQuery, setSearchQuery] = React.useState("");

  if (!sidebarOpen) return null;

  return (
    <aside
      aria-label="Connections Sidebar"
      className="flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      {/* Top Search Input */}
      <div className="border-b border-[var(--border-subtle)] p-2.5">
        <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter connections..."
            className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
        </div>
      </div>

      {/* Tag Filter Bar (Section 6.2 Swatch Pills Preview) */}
      <div className="border-b border-[var(--border-subtle)] px-2.5 py-2">
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <Tag className="h-3 w-3" />
            Tag Filters
          </span>
          <span className="font-mono">0 active</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SWATCH_PRESETS.slice(0, 4).map((swatch) => (
            <span
              key={swatch.id}
              style={{ "--pill-color": swatch.hex } as React.CSSProperties}
              className="tag-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: swatch.hex }}
              />
              {swatch.label.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {/* Groups & Connections Empty State */}
      <div className="flex flex-1 flex-col items-center justify-center p-5 text-center">
        <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-muted)]">
          <FolderOpen className="h-4 w-4" />
        </div>
        <p className="text-xs font-medium text-[var(--text-primary)]">
          No Instances Registered
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          Local runtimes, collapsible groups, and remote connections arrive in
          Phase 2.
        </p>
      </div>
    </aside>
  );
}

export function App() {
  const activeSection = useAppStore((s) => s.activeSection);
  const appStatus = useAppStore((s) => s.appStatus);
  const statusLoading = useAppStore((s) => s.statusLoading);
  const statusError = useAppStore((s) => s.statusError);
  const setAppStatus = useAppStore((s) => s.setAppStatus);
  const setStatusLoading = useAppStore((s) => s.setStatusLoading);
  const setStatusError = useAppStore((s) => s.setStatusError);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const [autostartBusy, setAutostartBusy] = React.useState(false);

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
    return () => {
      active = false;
    };
  }, [setAppStatus, setStatusError, setStatusLoading]);

  const handleToggleAutostart = async () => {
    if (!appStatus || autostartBusy) return;
    setAutostartBusy(true);
    try {
      const confirmed = await setAutostartEnabled(!appStatus.autostart_enabled);
      setAppStatus({ ...appStatus, autostart_enabled: confirmed });
      setStatusError(null);
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutostartBusy(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <AdaptiveTitlebar />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ActivityRail />
          <SidebarPlaceholder />

          {/* Main Tabbed Canvas */}
          <main className="flex-1 overflow-y-auto bg-[var(--bg-canvas)] p-6">
            <div className="mx-auto max-w-4xl space-y-5">
              {/* Header Banner */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                      EmbedBay Foundation
                    </h1>
                    <Badge variant="accent">Phase 1 Active</Badge>
                    <Badge variant="running">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-running)]" />
                      Tray Supervisor Ready
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Active workspace view:{" "}
                    <span className="font-mono text-[var(--accent-secondary)]">
                      {activeSection}
                    </span>
                    . Closing this window destroys the WebView while keeping the
                    background supervisor alive in the System Tray.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={toggleTheme}
                  >
                    Theme: {theme === "dark" ? "Dark" : "Light"}
                  </Button>
                  <Button
                    variant={
                      appStatus?.autostart_enabled ? "default" : "outline"
                    }
                    size="sm"
                    disabled={autostartBusy || statusLoading}
                    onClick={() => void handleToggleAutostart()}
                  >
                    <Power className="h-3.5 w-3.5" />
                    {appStatus?.autostart_enabled
                      ? "Autostart: Enabled"
                      : "Autostart: Disabled"}
                  </Button>
                </div>
              </div>

              {statusError && (
                <div className="rounded-lg border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-4 py-3 text-xs text-[var(--status-error)]">
                  IPC status check error: {statusError}
                </div>
              )}

              {/* Runtime & SQLite Diagnostics Grid */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                    <Laptop className="h-4 w-4 text-[var(--accent-primary)]" />
                    Platform Abstraction Layer
                  </div>
                  <dl className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5">
                      <dt className="text-[var(--text-secondary)]">OS / Arch</dt>
                      <dd className="font-mono text-[var(--text-primary)]">
                        {statusLoading
                          ? "loading..."
                          : `${appStatus?.platform.os ?? "-"} / ${appStatus?.platform.arch ?? "-"}`}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-[var(--text-secondary)]">
                        Target Triple
                      </dt>
                      <dd className="font-mono text-[var(--accent-secondary)]">
                        {appStatus?.platform.target_triple ?? "-"}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                    <Database className="h-4 w-4 text-[var(--accent-secondary)]" />
                    SQLite Registry (app.db)
                  </div>
                  <dl className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5">
                      <dt className="text-[var(--text-secondary)]">
                        Schema Version
                      </dt>
                      <dd className="flex items-center gap-1 font-mono text-[var(--status-running)]">
                        <CheckCircle2 className="h-3.5 w-3.5" />v
                        {appStatus?.schema_version ?? "-"}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="flex items-center gap-1 text-[var(--text-secondary)]">
                        <HardDrive className="h-3 w-3" />
                        Database Path
                      </dt>
                      <dd className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                        {appStatus?.db_path ?? "-"}
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>

              {/* Section 6.2 Curated Group & Tag Swatch Verification */}
              <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                    <Sparkles className="h-4 w-4 text-[var(--accent-ai)]" />
                    Group & Tag Color Swatches (Section 6.2)
                  </div>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    8 Presets
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SWATCH_PRESETS.map((swatch) => (
                    <span
                      key={swatch.id}
                      style={{ "--pill-color": swatch.hex } as React.CSSProperties}
                      className="tag-pill inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: swatch.hex }}
                      />
                      <span>{swatch.label}</span>
                      <span className="font-mono text-[10px] opacity-80">
                        {swatch.hex}
                      </span>
                    </span>
                  ))}
                </div>
              </section>
            </div>
          </main>
        </div>

        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}

export default App;
