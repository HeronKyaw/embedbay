import * as React from "react";
import {
  CheckCircle2,
  ClipboardCopy,
  Database,
  FolderOpen,
  HardDrive,
  Laptop,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getDiagnostics, openDataPath } from "@/ipc/system";
import { formatBytes, formatRamMb, formatUptime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DiagnosticsReport } from "@/types/system";

function clampPercent(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(100, Math.max(0, val));
}

function MeterBar({
  percent,
  colorClass,
}: {
  percent: number;
  colorClass: string;
}) {
  const pct = clampPercent(percent);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
      <div
        className={cn("h-full rounded-full transition-all", colorClass)}
        style={{ width: `${Math.max(pct > 0 ? 2 : 0, pct)}%` }}
      />
    </div>
  );
}

function buildMarkdownReport(d: DiagnosticsReport): string {
  const dbTotalBytes =
    d.database.db_bytes + d.database.wal_bytes + d.database.shm_bytes;
  const lines = [
    "# EmbedBay Diagnostic Report",
    "",
    "## Application",
    `- Version: v${d.app.version}`,
    `- Uptime: ${formatUptime(d.app.uptime_secs)}`,
    "",
    "## Host Environment",
    `- OS: ${d.host.os_version} (${d.host.arch})`,
    `- CPU: ${d.host.cpu_brand} (${d.host.cpu_cores} cores, ${d.host.cpu_percent.toFixed(1)}% load)`,
    `- Memory: ${formatRamMb(d.host.memory_used_bytes)} / ${formatRamMb(d.host.memory_total_bytes)}`,
    `- Data Disk: ${formatBytes(d.host.disk_available_bytes)} free / ${formatBytes(d.host.disk_total_bytes)}`,
    "",
    "## Health & Storage",
    `- Local Registry: ${d.database.quick_check} (${formatBytes(dbTotalBytes)})`,
    `- Credential Store: ${d.keyring.backend_name} (${d.keyring.stored_secret_refs} stored secret(s))`,
    `- Engine Catalog: ${d.manifest.engine_count} engines (updated ${d.manifest.updated_at})`,
    "",
    "## Data Locations",
    `- Data Root: ${d.paths.data_dir}`,
    `- Engine Binaries: ${d.paths.bin_dir}`,
    `- Instances: ${d.paths.instances_dir}`,
    `- Registry DB: ${d.paths.db_path}`,
  ];
  return lines.join("\n");
}

function StatTile({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div
        className={cn(
          "mt-1 text-xs font-medium text-[var(--text-primary)] break-words",
          mono && "font-mono",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function DiagnosticsPanel() {
  const [report, setReport] = React.useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadDiagnostics = React.useCallback(async (manual = false) => {
    setLoading(true);
    setError(null);
    const minSpin = manual
      ? new Promise((resolve) => window.setTimeout(resolve, 400))
      : Promise.resolve();
    try {
      const [next] = await Promise.all([getDiagnostics(), minSpin]);
      setReport(next);
      if (manual) {
        toast.success("Diagnostics refreshed");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

  const handleCopyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(buildMarkdownReport(report));
      toast.success(
        "Diagnostic report copied",
        "Sanitized Markdown summary copied (no secrets included).",
      );
    } catch {
      toast.error("Failed to copy diagnostic report");
    }
  };

  const handleCopyPath = async (label: string, path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success(`Copied ${label} path`);
    } catch {
      toast.error("Copy failed");
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

  const hostRamPct =
    report && report.host.memory_total_bytes > 0
      ? (report.host.memory_used_bytes / report.host.memory_total_bytes) * 100
      : 0;
  const hostDiskUsed = report
    ? Math.max(
        0,
        report.host.disk_total_bytes - report.host.disk_available_bytes,
      )
    : 0;
  const hostDiskPct =
    report && report.host.disk_total_bytes > 0
      ? (hostDiskUsed / report.host.disk_total_bytes) * 100
      : 0;

  const isHealthy = Boolean(report && report.database.quick_check === "ok");
  const dbTotalBytes = report
    ? report.database.db_bytes +
      report.database.wal_bytes +
      report.database.shm_bytes
    : 0;

  return (
    <div className="space-y-4">
      {/* Top Action & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          {report ? (
            <Badge variant={isHealthy ? "running" : "error"}>
              {isHealthy ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <ShieldAlert className="h-3 w-3" />
              )}
              {isHealthy ? "All Systems Healthy" : "Database Integrity Issue"}
            </Badge>
          ) : (
            <Badge variant="default">Checking...</Badge>
          )}
          {report && (
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              v{report.app.version} · Up {formatUptime(report.app.uptime_secs)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadDiagnostics(true)}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!report}
            onClick={() => void handleCopyReport()}
          >
            <ClipboardCopy className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
            Copy Report
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleOpenFolder()}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Data Dir
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-4 py-3 text-xs text-[var(--status-error)]">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {report && (
        <>
          {/* System Resources */}
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Laptop className="h-4 w-4 text-[var(--accent-secondary)]" />
                System Resources
              </div>
              <Badge variant="default" className="font-mono text-[11px]">
                {report.host.os_name} · {report.host.arch}
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">CPU Load</span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {report.host.cpu_percent.toFixed(1)}%
                  </span>
                </div>
                <MeterBar
                  percent={report.host.cpu_percent}
                  colorClass="bg-[var(--accent-secondary)]"
                />
                <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                  {report.host.cpu_cores} logical cores
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">
                    System Memory
                  </span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {Math.round(hostRamPct)}%
                  </span>
                </div>
                <MeterBar
                  percent={hostRamPct}
                  colorClass="bg-[var(--accent-ai)]"
                />
                <div className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">
                  {formatRamMb(report.host.memory_used_bytes)} /{" "}
                  {formatRamMb(report.host.memory_total_bytes)}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">
                    Data Disk
                  </span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {Math.round(hostDiskPct)}% used
                  </span>
                </div>
                <MeterBar
                  percent={hostDiskPct}
                  colorClass="bg-[var(--accent-primary)]"
                />
                <div className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">
                  {formatBytes(report.host.disk_available_bytes)} free /{" "}
                  {formatBytes(report.host.disk_total_bytes)}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <StatTile
                label="Operating System"
                mono={false}
                value={report.host.os_version}
              />
              <StatTile
                label="Processor"
                mono={false}
                value={report.host.cpu_brand}
              />
            </div>
          </section>

          {/* Health & Security */}
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <ShieldCheck className="h-4 w-4 text-[var(--accent-primary)]" />
              Health & Security
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <Database className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
                    Local Registry (app.db)
                  </span>
                  <Badge
                    variant={
                      report.database.quick_check === "ok" ? "running" : "error"
                    }
                  >
                    {report.database.quick_check === "ok"
                      ? "Healthy"
                      : report.database.quick_check}
                  </Badge>
                </div>
                <div className="mt-2 font-mono text-xs font-medium text-[var(--text-primary)]">
                  {formatBytes(dbTotalBytes)}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-3">
                <div className="text-[11px] text-[var(--text-muted)]">
                  Credential Store
                </div>
                <div className="mt-1.5 text-xs font-medium text-[var(--text-primary)]">
                  {report.keyring.backend_name}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                  {report.keyring.stored_secret_refs} stored secret(s)
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-3">
                <div className="text-[11px] text-[var(--text-muted)]">
                  Engine Catalog
                </div>
                <div className="mt-1.5 font-mono text-xs font-medium text-[var(--text-primary)]">
                  {report.manifest.engine_count} engines
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                  Updated {report.manifest.updated_at}
                </div>
              </div>
            </div>
          </section>

          {/* Data Locations */}
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <HardDrive className="h-4 w-4 text-[var(--text-secondary)]" />
              Data Locations
            </div>
            <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
              {(
                [
                  { label: "Data Root", path: report.paths.data_dir, dir: true },
                  {
                    label: "Engine Binaries",
                    path: report.paths.bin_dir,
                    dir: true,
                  },
                  {
                    label: "Instances",
                    path: report.paths.instances_dir,
                    dir: true,
                  },
                  {
                    label: "Registry DB",
                    path: report.paths.db_path,
                    dir: false,
                  },
                ] as const
              ).map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                >
                  <span className="w-28 shrink-0 font-medium text-[var(--text-secondary)]">
                    {item.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
                    {item.path}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={`Copy ${item.label}`}
                      aria-label={`Copy ${item.label} path`}
                      onClick={() =>
                        void handleCopyPath(item.label, item.path)
                      }
                    >
                      <ClipboardCopy className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                    </Button>
                    {item.dir && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={`Open ${item.label}`}
                        aria-label={`Open ${item.label} folder`}
                        onClick={() => void handleOpenFolder(item.path)}
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
