import * as React from "react";
import { AppWindow, LogOut, Power, Sliders } from "lucide-react";
import { ThemePickerCards } from "@/components/settings/ThemePickerCards";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { setAutostartEnabled, setCloseBehavior } from "@/ipc/system";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import type {
  ActivitySection,
  CloseBehavior,
  WorkspacePreferences,
} from "@/types/system";

export function GeneralSettingsPanel() {
  const theme = useAppStore((s) => s.theme);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const appStatus = useAppStore((s) => s.appStatus);
  const statusLoading = useAppStore((s) => s.statusLoading);
  const setAppStatus = useAppStore((s) => s.setAppStatus);

  const [autostartBusy, setAutostartBusy] = React.useState(false);
  const [closeBehaviorBusy, setCloseBehaviorBusy] = React.useState(false);

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

  const handleChangeCloseBehavior = async (next: CloseBehavior) => {
    if (!appStatus || closeBehaviorBusy || appStatus.close_behavior === next) {
      return;
    }
    setCloseBehaviorBusy(true);
    try {
      const confirmed = await setCloseBehavior(next);
      setAppStatus({ ...appStatus, close_behavior: confirmed });
      toast.success(
        confirmed === "tray"
          ? "Closing the window will minimize EmbedBay to the System Tray"
          : "Closing the window will stop running databases and quit EmbedBay",
      );
    } catch (err: unknown) {
      toast.error(
        "Failed to update close behavior",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setCloseBehaviorBusy(false);
    }
  };

  const autostartEnabled = Boolean(appStatus?.autostart_enabled);
  const closeBehavior: CloseBehavior = appStatus?.close_behavior ?? "tray";

  return (
    <div className="space-y-4">
      {/* Appearance */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Appearance
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Choose Light, Dark, or Auto to match your OS color scheme.
            </p>
          </div>
          {theme === "system" && (
            <Badge variant="default" className="text-[11px]">
              Auto · {resolvedTheme === "dark" ? "Dark" : "Light"}
            </Badge>
          )}
        </div>

        <div className="mt-4">
          <ThemePickerCards />
        </div>
      </section>

      {/* Workspace & Explorer Defaults */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-[var(--accent-primary)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Workspace Defaults
          </h3>
        </div>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
          Defaults applied when launching EmbedBay, opening new tabs, or
          creating local instances.
        </p>

        <div className="mt-4 divide-y divide-[var(--border-subtle)]">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
            <div>
              <label
                htmlFor="pref-startup-section"
                className="text-xs font-medium text-[var(--text-primary)]"
              >
                Startup Workspace View
              </label>
              <p className="text-[11px] text-[var(--text-muted)]">
                Initial screen shown when EmbedBay opens.
              </p>
            </div>
            <select
              id="pref-startup-section"
              value={preferences.defaultSection}
              onChange={(e) =>
                updatePreferences({
                  defaultSection: e.target.value as ActivitySection,
                })
              }
              className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            >
              <option value="explorer">Vector Explorer</option>
              <option value="runtimes">Local Runtimes</option>
              <option value="store">Engine Store</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <label
                htmlFor="pref-page-size"
                className="text-xs font-medium text-[var(--text-primary)]"
              >
                Default Explorer Page Size
              </label>
              <p className="text-[11px] text-[var(--text-muted)]">
                Rows loaded per page in newly opened collection tabs.
              </p>
            </div>
            <select
              id="pref-page-size"
              value={preferences.defaultPageSize}
              onChange={(e) =>
                updatePreferences({
                  defaultPageSize: Number(
                    e.target.value,
                  ) as WorkspacePreferences["defaultPageSize"],
                })
              }
              className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            >
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
              <option value={200}>200 rows</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <label
                htmlFor="pref-search-topk"
                className="text-xs font-medium text-[var(--text-primary)]"
              >
                Default Search Top-K
              </label>
              <p className="text-[11px] text-[var(--text-muted)]">
                Number of nearest neighbors returned in new Search tabs.
              </p>
            </div>
            <select
              id="pref-search-topk"
              value={preferences.defaultSearchTopK}
              onChange={(e) =>
                updatePreferences({
                  defaultSearchTopK: Number(
                    e.target.value,
                  ) as WorkspacePreferences["defaultSearchTopK"],
                })
              }
              className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 py-3 last:pb-0">
            <div>
              <label
                htmlFor="pref-idle-timeout"
                className="text-xs font-medium text-[var(--text-primary)]"
              >
                Default Idle Auto-Stop (New Instances)
              </label>
              <p className="text-[11px] text-[var(--text-muted)]">
                Pre-selected inactivity timeout when creating new local
                databases.
              </p>
            </div>
            <select
              id="pref-idle-timeout"
              value={preferences.defaultIdleTimeoutMinutes}
              onChange={(e) =>
                updatePreferences({
                  defaultIdleTimeoutMinutes: Number(
                    e.target.value,
                  ) as WorkspacePreferences["defaultIdleTimeoutMinutes"],
                })
              }
              className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            >
              <option value={0}>Never (Manual stop)</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>60 minutes</option>
            </select>
          </div>
        </div>
      </section>

      {/* Startup & Window Behavior */}
      <section className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Power className="h-4 w-4 text-[var(--accent-primary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Launch on OS Startup
              </h3>
              <Badge variant={autostartEnabled ? "running" : "default"}>
                {autostartEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Starts EmbedBay minimized to the System Tray (
              <code className="font-mono text-[11px]">--minimized</code>) so
              auto-start databases come online silently.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={autostartEnabled}
            aria-label="Toggle Launch on OS Startup"
            disabled={autostartBusy || statusLoading}
            onClick={() => void handleToggleAutostart()}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
              autostartEnabled
                ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]"
                : "border-[var(--border-strong)] bg-[var(--bg-canvas)]",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full transition-transform",
                autostartEnabled
                  ? "translate-x-6 bg-slate-950"
                  : "translate-x-1 bg-[var(--text-muted)]",
              )}
            />
          </button>
        </div>

        <div className="border-t border-[var(--border-subtle)] pt-4">
          <div className="mb-2.5">
            <h4 className="text-xs font-semibold text-[var(--text-primary)]">
              When Closing Window
            </h4>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
              Choose whether clicking the window close button keeps databases
              running in the background or shuts everything down.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              disabled={closeBehaviorBusy || statusLoading}
              onClick={() => void handleChangeCloseBehavior("tray")}
              aria-pressed={closeBehavior === "tray"}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors cursor-pointer disabled:opacity-50",
                closeBehavior === "tray"
                  ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                  : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]",
              )}
            >
              <AppWindow className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  Minimize to System Tray
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                  Frees UI memory while keeping managed databases running in the
                  tray.
                </p>
              </div>
            </button>

            <button
              type="button"
              disabled={closeBehaviorBusy || statusLoading}
              onClick={() => void handleChangeCloseBehavior("quit")}
              aria-pressed={closeBehavior === "quit"}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors cursor-pointer disabled:opacity-50",
                closeBehavior === "quit"
                  ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                  : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]",
              )}
            >
              <LogOut className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-secondary)]" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  Quit EmbedBay
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                  Gracefully stops all running local databases and exits the
                  app.
                </p>
              </div>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
