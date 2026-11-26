import * as React from "react";
import { HardDrive, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cleanupUnusedEngines, getStorageUsage } from "@/ipc/engines";
import { formatBytes } from "@/lib/format";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { StorageUsageSummary } from "@/types/runtime";

export function UnusedEngineCleanupBanner() {
  const installedCount = useRuntimeStore((s) => s.installedEngines.length);
  const instancesCount = useRuntimeStore((s) => s.instances.length);
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
  }, [loadUsage, installedCount, instancesCount]);

  if (!summary || summary.stale_unused_engine_count === 0) {
    return null;
  }

  const handleCleanup = async () => {
    if (cleaning) return;
    setCleaning(true);
    try {
      const res = await cleanupUnusedEngines(summary.unused_grace_days);
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--status-starting)]/40 bg-[var(--status-starting)]/10 px-4 py-3 text-xs">
      <div className="flex items-center gap-2.5 text-[var(--text-primary)]">
        <HardDrive className="h-4 w-4 shrink-0 text-[var(--status-starting)]" />
        <span>
          <strong className="font-semibold">
            {summary.stale_unused_engine_count} unused engine version(s)
          </strong>{" "}
          haven&apos;t been used for {summary.unused_grace_days}+ days, occupying{" "}
          <span className="font-mono font-semibold">
            {formatBytes(summary.stale_unused_engine_bytes)}
          </span>
          .
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
