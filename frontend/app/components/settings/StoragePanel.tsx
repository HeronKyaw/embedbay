import * as React from "react";
import {
  Copy,
  Database,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  cleanupUnusedEngines,
  compactDatabase,
  getStorageUsage,
} from "@/ipc/engines";
import { openDataPath } from "@/ipc/system";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { StorageUsageSummary } from "@/types/runtime";

export function StoragePanel() {
  const appStatus = useAppStore((s) => s.appStatus);
  const installedCount = useRuntimeStore((s) => s.installedEngines.length);
  const instancesCount = useRuntimeStore((s) => s.instances.length);
  const refreshCatalogAndInstalled = useRuntimeStore(
    (s) => s.refreshCatalogAndInstalled,
  );

  const [usage, setUsage] = React.useState<StorageUsageSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [cleaning, setCleaning] = React.useState(false);
  const [compacting, setCompacting] = React.useState(false);

  const fetchUsage = React.useCallback(async () => {
    setLoading(true);
    try {
      const next = await getStorageUsage();
      setUsage(next);
    } catch (err: unknown) {
      toast.error(
        "Failed to inspect storage",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchUsage();
  }, [fetchUsage, installedCount, instancesCount]);

  const handleCopyPath = async (path: string) => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      toast.success("Copied path to clipboard");
    } catch {
      toast.error("Failed to copy path");
    }
  };

  const handleOpenFolder = async (path?: string) => {
    try {
      await openDataPath(path);
    } catch (err: unknown) {
      toast.error(
        "Unable to open folder",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

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

  const handleCompactDb = async () => {
    if (compacting) return;
    setCompacting(true);
    try {
      const res = await compactDatabase();
      await fetchUsage();
      toast.success(
        "SQLite database compacted",
        res.freed_bytes > 0
          ? `Reclaimed ${formatBytes(res.freed_bytes)} (${formatBytes(res.after_bytes)} total).`
          : `Database optimized (${formatBytes(res.after_bytes)} total).`,
      );
    } catch (err: unknown) {
      toast.error(
        "Database compaction failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setCompacting(false);
    }
  };

  const dataRoot = usage?.data_root || appStatus?.data_dir || "-";
  const totalEngineBytes = usage?.total_engine_bytes ?? 0;
  const unusedEngineBytes = usage?.unused_engine_bytes ?? 0;
  const activeEngineBytes = Math.max(0, totalEngineBytes - unusedEngineBytes);
  const instanceBytes = usage?.total_instance_bytes ?? 0;
  const dbAndLogsBytes = (usage?.db_bytes ?? 0) + (usage?.logs_bytes ?? 0);
  const grandTotal =
    activeEngineBytes + unusedEngineBytes + instanceBytes + (usage?.db_bytes ?? 0);

  const pct = (part: number) =>
    grandTotal > 0 ? Math.max(part > 0 ? 2 : 0, (part / grandTotal) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Data Directory Location */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Local Data Root
            </h3>
            <p className="mt-1 truncate font-mono text-xs text-[var(--text-secondary)]">
              {dataRoot}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleCopyPath(dataRoot)}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleOpenFolder()}
            >
              <FolderOpen className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              Open Folder
            </Button>
          </div>
        </div>
      </section>

      {/* Disk Footprint Overview */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-[var(--accent-primary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Disk Footprint
              </h3>
              <Badge variant="default" className="font-mono">
                {formatBytes(grandTotal)} total
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Breakdown across installed binaries, instance vector data, logs,
              and SQLite registry.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void fetchUsage()}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>

        {/* Segmented Storage Bar */}
        <div className="mt-4">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
            {grandTotal > 0 ? (
              <>
                <div
                  className="h-full bg-[var(--accent-primary)] transition-all"
                  style={{ width: `${pct(activeEngineBytes)}%` }}
                  title={`Active Engines: ${formatBytes(activeEngineBytes)}`}
                />
                <div
                  className="h-full bg-[var(--status-starting)] transition-all"
                  style={{ width: `${pct(unusedEngineBytes)}%` }}
                  title={`Unused Engines: ${formatBytes(unusedEngineBytes)}`}
                />
                <div
                  className="h-full bg-[var(--accent-secondary)] transition-all"
                  style={{ width: `${pct(instanceBytes)}%` }}
                  title={`Instance Data: ${formatBytes(instanceBytes)}`}
                />
                <div
                  className="h-full bg-[var(--accent-ai)] transition-all"
                  style={{ width: `${pct(usage?.db_bytes ?? 0)}%` }}
                  title={`SQLite DB: ${formatBytes(usage?.db_bytes ?? 0)}`}
                />
              </>
            ) : (
              <div className="h-full w-full bg-[var(--border-subtle)]/40" />
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
              Active Engines
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-[var(--text-primary)]">
              {formatBytes(activeEngineBytes)}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[var(--status-starting)]" />
              Reclaimable Unused
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-[var(--status-starting)]">
              {formatBytes(unusedEngineBytes)}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[var(--accent-secondary)]" />
              Instance Data
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-[var(--accent-secondary)]">
              {formatBytes(instanceBytes)}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[var(--accent-ai)]" />
              DB & Logs
            </div>
            <div className="mt-1 font-mono text-sm font-semibold text-[var(--accent-ai)]">
              {formatBytes(dbAndLogsBytes)}
            </div>
          </div>
        </div>
      </section>

      {/* Installed Engine Binaries & Cleanup */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Installed Engine Versions
              </h3>
              {usage && usage.unused_engine_count > 0 && (
                <Badge variant="warning">
                  {usage.unused_engine_count} unused ·{" "}
                  {formatBytes(usage.unused_engine_bytes)}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Remove native binaries no longer referenced by any local instance.
            </p>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={cleaning || !usage || usage.unused_engine_count === 0}
            onClick={() => void handleCleanupUnused()}
          >
            {cleaning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Clean Up Unused
          </Button>
        </div>

        {usage && usage.engines.length > 0 ? (
          <div className="mt-3 divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
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
                    <Badge variant="warning">
                      {eng.unused_days !== null && eng.unused_days > 0
                        ? `Unused · ${eng.unused_days}d`
                        : "Unused"}
                    </Badge>
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

      {/* Per-Instance Data Footprint */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Instance Data Directories
            </h3>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Vector storage, WAL files, snapshots, and logs per local instance.
            </p>
          </div>
          <Badge variant="default">
            {usage?.instances.length ?? 0} instances
          </Badge>
        </div>

        {usage && usage.instances.length > 0 ? (
          <div className="mt-3 divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
            {usage.instances.map((inst) => (
              <div
                key={inst.instance_id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-[var(--text-primary)]">
                      {inst.name}
                    </span>
                    <Badge variant="default" className="text-[10px] uppercase">
                      {inst.engine_type}
                    </Badge>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {inst.data_dir}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[11px] text-[var(--text-primary)]">
                    {formatBytes(inst.size_bytes)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Open instance data folder"
                    aria-label={`Open folder for ${inst.name}`}
                    onClick={() => void handleOpenFolder(inst.data_dir)}
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            No local database instances created yet.
          </p>
        )}
      </section>

      {/* Database Maintenance */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-[var(--accent-ai)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Metadata Database Maintenance
              </h3>
              <Badge variant="default" className="font-mono">
                app.db · {formatBytes(usage?.db_bytes ?? 0)}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Truncates the SQLite WAL journal and runs{" "}
              <code className="font-mono text-[11px]">VACUUM</code> to reclaim
              unused pages in <code className="font-mono text-[11px]">app.db</code>.
            </p>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={compacting}
            onClick={() => void handleCompactDb()}
          >
            {compacting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Database className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
            )}
            Compact Database
          </Button>
        </div>
      </section>
    </div>
  );
}
