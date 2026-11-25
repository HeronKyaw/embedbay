import * as React from "react";
import {
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Laptop,
  Moon,
  Palette,
  Power,
  Settings,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmbeddingProfilesPanel } from "@/components/search/EmbeddingProfilesPanel";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setAutostartEnabled } from "@/ipc/system";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { SWATCH_PRESETS } from "@/types/system";

type SettingsTabId = "general" | "embeddings" | "storage" | "diagnostics";

const SETTINGS_TABS: readonly {
  id: SettingsTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "general", label: "General", icon: Palette },
  { id: "embeddings", label: "Embeddings", icon: Sparkles },
  { id: "storage", label: "Storage & Updates", icon: HardDrive },
  { id: "diagnostics", label: "Diagnostics", icon: Cpu },
];

export function SettingsModal({
  extraPanels,
}: {
  extraPanels?: React.ReactNode;
}) {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const appStatus = useAppStore((s) => s.appStatus);
  const statusLoading = useAppStore((s) => s.statusLoading);
  const setAppStatus = useAppStore((s) => s.setAppStatus);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const [activeTab, setActiveTab] = React.useState<SettingsTabId>("general");
  const [autostartBusy, setAutostartBusy] = React.useState(false);
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleToggleAutostart = async () => {
    if (!appStatus || autostartBusy) return;
    setAutostartBusy(true);
    try {
      const confirmed = await setAutostartEnabled(!appStatus.autostart_enabled);
      setAppStatus({ ...appStatus, autostart_enabled: confirmed });
      toast.success(
        confirmed
          ? "EmbedBay will launch minimized to tray on OS startup"
          : "Disabled OS boot autostart",
      );
    } catch (err: unknown) {
      toast.error(
        "Failed to update autostart",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setAutostartBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={() => setOpen(false)}
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
      onMouseDown={(e) => {
        if (e.target === dialogRef.current) {
          setOpen(false);
        }
      }}
      className="rounded-xl shadow-2xl"
    >
      {open && (
        <div className="flex h-[min(84vh,680px)] w-[min(92vw,920px)] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-primary)] shadow-2xl">
          {/* Top Non-Scrolling Header + Segmented Category Tabs */}
          <div className="shrink-0 space-y-4 px-6 pt-6 pb-4">
            <PageHeader
              icon={
                <Settings className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
              }
              title="Settings"
              description="Appearance, startup behavior, embedding providers, storage cleanup, and system diagnostics."
              actions={
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close settings"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              }
            />

            <div
              role="tablist"
              aria-label="Settings Categories"
              className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5"
            >
              {SETTINGS_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium leading-none transition-colors cursor-pointer",
                      active
                        ? "bg-[var(--bg-elevated)] text-[var(--accent-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scrollable Tab Content */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {activeTab === "general" && (
              <div className="space-y-4">
                <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        Appearance & Theme
                      </h3>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        Switch between Deep Harbor Charcoal (Dark) and Light mode.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={toggleTheme}
                    >
                      {theme === "dark" ? (
                        <Sun className="h-3.5 w-3.5" />
                      ) : (
                        <Moon className="h-3.5 w-3.5" />
                      )}
                      {theme === "dark" ? "Dark Mode" : "Light Mode"}
                    </Button>
                  </div>

                  <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
                    <div className="mb-2.5 flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--text-primary)]">
                        Group & Tag Accent Swatches
                      </span>
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
                        </span>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        Startup & System Tray Supervisor
                      </h3>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        Closing the window destroys the WebView to reclaim RAM while keeping all managed databases running in the System Tray.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant={appStatus?.autostart_enabled ? "default" : "outline"}
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
                </section>
              </div>
            )}

            {activeTab === "embeddings" && <EmbeddingProfilesPanel />}

            {activeTab === "storage" && (
              <div className="space-y-5">{extraPanels}</div>
            )}

            {activeTab === "diagnostics" && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
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
                      <dt className="text-[var(--text-secondary)]">Target Triple</dt>
                      <dd className="font-mono text-[var(--accent-secondary)]">
                        {appStatus?.platform.target_triple ?? "-"}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                    <Database className="h-4 w-4 text-[var(--accent-secondary)]" />
                    SQLite Registry (app.db)
                  </div>
                  <dl className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5">
                      <dt className="text-[var(--text-secondary)]">Schema Version</dt>
                      <dd className="flex items-center gap-1 font-mono text-[var(--status-running)]">
                        <CheckCircle2 className="h-3.5 w-3.5" />v
                        {appStatus?.schema_version ?? "-"}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="flex items-center gap-1 text-[var(--text-secondary)]">
                        <HardDrive className="h-3 w-3" />
                        Data Root & Database
                      </dt>
                      <dd className="break-all font-mono text-[11px] text-[var(--text-muted)]">
                        {appStatus?.db_path ?? "-"}
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
