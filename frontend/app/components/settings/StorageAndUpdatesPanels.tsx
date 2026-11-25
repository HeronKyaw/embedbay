import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  DownloadCloud,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cleanupUnusedEngines, getStorageUsage } from "@/ipc/engines";
import { isTauriRuntime } from "@/ipc/system";
import { formatUserError } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { StorageUsageSummary } from "@/types/runtime";

export function UnusedEngineCleanupBanner() {
  const installedCount = useRuntimeStore((s) => s.installedEngines.length);
  const refreshCatalogAndInstalled = useRuntimeStore(
    (s) => s.refreshCatalogAndInstalled,
  );
  const [summary, setSummary] = React.useState<StorageUsageSummary | null>(null);
  const [cleaning, setCleaning] = React.useState(false);

  const loadUsage = React.useCallback(async () => {
    try {
      const next = await getStorageUsage();
      setSummary(next);
    } catch {
      // Non-fatal in catalog header
    }
  }, []);

  React.useEffect(() => {
    void loadUsage();
  }, [loadUsage, installedCount]);

  if (!summary || summary.unused_engine_count === 0) {
    return null;
  }

  const handleCleanup = async () => {
    if (cleaning) return;
    setCleaning(true);
    try {
      const res = await cleanupUnusedEngines();
      await Promise.all([loadUsage(), refreshCatalogAndInstalled()]);
      toast.success(
        `Removed ${res.removed_count} unused engine version(s)`,
        `Reclaimed ${formatBytes(res.freed_bytes)} on disk.`,
      );
    } catch (err: unknown) {
      toast.error(
        "Cleanup failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-4 py-3 text-xs">
      <div className="flex items-center gap-2.5 text-[var(--text-primary)]">
        <HardDrive className="h-4 w-4 shrink-0 text-[var(--status-warning)]" />
        <span>
          <strong className="font-semibold">
            {summary.unused_engine_count} unused engine version(s)
          </strong>{" "}
          are occupying{" "}
          <span className="font-mono font-semibold">
            {formatBytes(summary.unused_engine_bytes)}
          </span>{" "}
          with no referencing instances.
        </span>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={cleaning}
        onClick={() => void handleCleanup()}
      >
        {cleaning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        Clean Up Unused
      </Button>
    </div>
  );
}

export function StorageAndUpdatesPanels() {
  const installedCount = useRuntimeStore((s) => s.installedEngines.length);
  const refreshCatalogAndInstalled = useRuntimeStore(
    (s) => s.refreshCatalogAndInstalled,
  );

  const [usage, setUsage] = React.useState<StorageUsageSummary | null>(null);
  const [loadingUsage, setLoadingUsage] = React.useState(false);
  const [cleaning, setCleaning] = React.useState(false);

  const [checkingUpdate, setCheckingUpdate] = React.useState(false);
  const [installingUpdate, setInstallingUpdate] = React.useState(false);
  const [downloadPercent, setDownloadPercent] = React.useState<number | null>(
    null,
  );
  const [availableUpdate, setAvailableUpdate] = React.useState<Update | null>(
    null,
  );
  const [updateStatusText, setUpdateStatusText] = React.useState<string>(
    "Signed updates via GitHub Releases (latest.json).",
  );
  const [updateError, setUpdateError] = React.useState<string | null>(null);

  const fetchUsage = React.useCallback(async () => {
    setLoadingUsage(true);
    try {
      const next = await getStorageUsage();
      setUsage(next);
    } catch (err: unknown) {
      toast.error(
        "Failed to inspect storage",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchUsage();
  }, [fetchUsage, installedCount]);

  React.useEffect(() => {
    return () => {
      if (availableUpdate) {
        void availableUpdate.close().catch(() => {});
      }
    };
  }, [availableUpdate]);

  const handleCleanupUnused = async () => {
    if (cleaning) return;
    setCleaning(true);
    try {
      const result = await cleanupUnusedEngines();
      await Promise.all([fetchUsage(), refreshCatalogAndInstalled()]);
      if (result.removed_count > 0) {
        toast.success(
          `Cleaned up ${result.removed_count} unused engine(s)`,
          `Freed ${formatBytes(result.freed_bytes)} of disk space.`,
        );
      } else {
        toast.info("Nothing to clean up", "All installed engines are in use.");
      }
      if (result.skipped.length > 0) {
        toast.error("Some versions skipped", result.skipped.join("; "));
      }
    } catch (err: unknown) {
      toast.error(
        "Storage cleanup failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setCleaning(false);
    }
  };

  const handleCheckForUpdates = async () => {
    if (checkingUpdate || installingUpdate) return;
    setUpdateError(null);
    if (!isTauriRuntime()) {
      setUpdateStatusText(
        "Update checking requires the installed Tauri desktop runtime.",
      );
      toast.info(
        "Desktop runtime required",
        "Run EmbedBay via Tauri to check signed GitHub Releases.",
      );
      return;
    }

    setCheckingUpdate(true);
    setUpdateStatusText("Contacting release feed...");
    try {
      if (availableUpdate) {
        await availableUpdate.close().catch(() => {});
        setAvailableUpdate(null);
      }
      const next = await check({ timeout: 15000 });
      if (next) {
        setAvailableUpdate(next);
        setUpdateStatusText(
          `EmbedBay v${next.version} is available (installed: v${next.currentVersion}).`,
        );
        toast.success(`Update v${next.version} available`);
      } else {
        setUpdateStatusText("You are running the latest version (v0.1.0).");
        toast.success("Up to date", "No newer EmbedBay release found.");
      }
    } catch (err: unknown) {
      const msg = formatUserError(err);
      setUpdateError(msg);
      setUpdateStatusText("Unable to fetch update manifest.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!availableUpdate || installingUpdate) return;
    setInstallingUpdate(true);
    setUpdateError(null);
    setDownloadPercent(0);
    let totalBytes = 0;
    let downloadedBytes = 0;

    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setDownloadPercent(0);
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setDownloadPercent(
              Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)),
            );
          }
        } else if (event.event === "Finished") {
          setDownloadPercent(100);
        }
      });
      toast.success("Update installed", "Restarting EmbedBay to finish update.");
    } catch (err: unknown) {
      const msg = formatUserError(err);
      setUpdateError(msg);
      toast.error("Update install failed", msg);
    } finally {
      setInstallingUpdate(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-[var(--accent-primary)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Storage & Engine Cleanup
              </h2>
              {usage && usage.unused_engine_count > 0 && (
                <Badge variant="warning">
                  {usage.unused_engine_count} unused ·{" "}
                  {formatBytes(usage.unused_engine_bytes)} reclaimable
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Remove downloaded native engine versions that are no longer
              referenced by any local database instance.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingUsage}
              onClick={() => void fetchUsage()}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingUsage ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                cleaning || !usage || usage.unused_engine_count === 0
              }
              onClick={() => void handleCleanupUnused()}
            >
              {cleaning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Clean Up Unused Engines
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="text-[11px] text-[var(--text-secondary)]">
              Installed Engines
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-[var(--text-primary)]">
              {formatBytes(usage?.total_engine_bytes ?? 0)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="text-[11px] text-[var(--text-secondary)]">
              Reclaimable Unused
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-[var(--status-warning)]">
              {formatBytes(usage?.unused_engine_bytes ?? 0)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="text-[11px] text-[var(--text-secondary)]">
              Instance Data
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-[var(--accent-secondary)]">
              {formatBytes(usage?.total_instance_bytes ?? 0)}
            </div>
          </div>
        </div>

        {usage && usage.engines.length > 0 ? (
          <div className="mt-4 divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
            {usage.engines.map((eng) => (
              <div
                key={eng.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {eng.engine_type}
                  </span>
                  <span className="font-mono text-[var(--text-secondary)]">
                    v{eng.version}
                  </span>
                  {eng.in_use_by.length > 0 ? (
                    <Badge variant="running">
                      In Use ({eng.in_use_by.length})
                    </Badge>
                  ) : (
                    <Badge variant="warning">Unused</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {eng.in_use_by.length > 0 && (
                    <span className="max-w-xs truncate text-[11px] text-[var(--text-muted)]">
                      {eng.in_use_by.join(", ")}
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-[var(--text-primary)]">
                    {formatBytes(eng.size_bytes)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            No downloaded engine binaries registered yet.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--accent-secondary)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Application Updates
              </h2>
              <Badge variant="accent">v0.1.0</Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {updateStatusText}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={checkingUpdate || installingUpdate}
              onClick={() => void handleCheckForUpdates()}
            >
              {checkingUpdate ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Check for Updates
            </Button>

            {availableUpdate && (
              <Button
                type="button"
                size="sm"
                disabled={installingUpdate}
                onClick={() => void handleInstallUpdate()}
              >
                {installingUpdate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="h-3.5 w-3.5" />
                )}
                {installingUpdate && downloadPercent !== null
                  ? `Installing (${downloadPercent}%)`
                  : `Install v${availableUpdate.version}`}
              </Button>
            )}
          </div>
        </div>

        {availableUpdate && (
          <div className="mt-3 rounded-lg border border-[var(--status-running)]/30 bg-[var(--status-running)]/10 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--status-running)]">
              <Sparkles className="h-3.5 w-3.5" />
              Release v{availableUpdate.version} ready to install
            </div>
            {availableUpdate.body && (
              <p className="mt-1 whitespace-pre-wrap text-[var(--text-secondary)]">
                {availableUpdate.body}
              </p>
            )}
          </div>
        )}

        {updateError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 p-3 text-xs text-[var(--status-error)]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{updateError}</span>
          </div>
        )}

        {!availableUpdate && !updateError && (
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--status-running)]" />
            Upgrades preserve all vector data in %LOCALAPPDATA% and your OS
            keyring credentials.
          </div>
        )}
      </section>
    </div>
  );
}
