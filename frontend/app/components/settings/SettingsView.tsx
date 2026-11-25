import * as React from "react";
import {
  CheckCircle2,
  Database,
  HardDrive,
  Laptop,
  Moon,
  Power,
  Sun,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setAutostartEnabled } from "@/ipc/system";
import { useAppStore } from "@/stores/useAppStore";
import { SWATCH_PRESETS } from "@/types/system";

export function SettingsView({
  extraPanels,
}: {
  extraPanels?: React.ReactNode;
}) {
  const appStatus = useAppStore((s) => s.appStatus);
  const statusLoading = useAppStore((s) => s.statusLoading);
  const setAppStatus = useAppStore((s) => s.setAppStatus);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const [autostartBusy, setAutostartBusy] = React.useState(false);

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
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              Workspace Settings & Diagnostics
            </h1>
            <Badge variant="running">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-running)]" />
              Tray Supervisor Active
            </Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Closing the window destroys the WebView to reclaim RAM while keeping
            all managed databases running in the System Tray.
          </p>
        </div>

        <div className="flex items-center gap-2">
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
      </div>

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
              <dt className="text-[var(--text-secondary)]">Target Triple</dt>
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
              <dd className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                {appStatus?.db_path ?? "-"}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {extraPanels}

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            EmbedBay Theme Swatches
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
      </section>
    </div>
  );
}
