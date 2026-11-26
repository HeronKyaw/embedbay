import * as React from "react";
import {
  Activity,
  CheckCircle2,
  ClipboardCopy,
  Cpu,
  Database,
  FolderOpen,
  HardDrive,
  KeyRound,
  Laptop,
  Package,
  RefreshCw,
  Server,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InstanceStatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toast";
import { getDiagnostics, openDataPath } from "@/ipc/system";
import { formatBytes, formatRamMb, formatUptime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InstanceStatus } from "@/types/runtime";
import type { DiagnosticsReport } from "@/types/system";

type DiagnosticsSubTab = "overview" | "instances" | "storage_db";

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
  const lines = [
    "# EmbedBay Diagnostic Report",
    "",
    "## Application & Runtime",
    `- Version: v${d.app.version} (${d.app.build_profile})`,
    `- Tauri: v${d.app.tauri_version}`,
    `- Process PID: ${d.app.pid}`,
    `- Uptime: ${formatUptime(d.app.uptime_secs)}`,
    `- OS Autostart: ${d.app.autostart_enabled ? "Enabled" : "Disabled"}`,
    `- Tray Mode: ${d.app.tray_mode}`,
    "",
    "## Host Environment",
    `- OS: ${d.host.os_version} (Kernel ${d.host.kernel_version})`,
    `- Target: ${d.host.target_triple} (${d.host.arch})`,
    `- CPU: ${d.host.cpu_brand} (${d.host.cpu_cores} cores, ${d.host.cpu_percent.toFixed(1)}% load)`,
    `- Memory: ${formatRamMb(d.host.memory_used_bytes)} / ${formatRamMb(d.host.memory_total_bytes)}`,
    `- Data Volume: ${formatBytes(d.host.disk_available_bytes)} free / ${formatBytes(d.host.disk_total_bytes)}`,
    "",
    "## Supervisor",
    `- Instances: ${d.supervisor.total_instances} total (${d.supervisor.running_count} running, ${d.supervisor.embedded_count} embedded, ${d.supervisor.stopped_count} stopped, ${d.supervisor.error_count} error)`,
    `- Managed RAM / CPU / Disk: ${formatRamMb(d.supervisor.total_ram_bytes)} / ${d.supervisor.total_cpu_percent.toFixed(1)}% / ${formatBytes(d.supervisor.total_disk_bytes)}`,
    `- Total Restarts: ${d.supervisor.total_restarts}`,
    ...d.supervisor.instances.map(
      (i) =>
        `  - ${i.name} (${i.engine_type} v${i.engine_version}): ${i.status} @ ${i.host}:${i.port} | PID=${i.pid ?? "-"} | RAM=${formatRamMb(i.ram_bytes)} | Restarts=${i.restart_count}${i.last_error ? ` | Error=${i.last_error}` : ""}`,
    ),
    "",
    "## SQLite Registry & Catalog",
    `- SQLite: v${d.database.sqlite_version} | Schema: v${d.database.schema_version} | quick_check: ${d.database.quick_check}`,
    `- Pragmas: journal_mode=${d.database.journal_mode}, foreign_keys=${d.database.foreign_keys}`,
    `- DB Size: app.db=${formatBytes(d.database.db_bytes)}, wal=${formatBytes(d.database.wal_bytes)}, shm=${formatBytes(d.database.shm_bytes)}`,
    `- Table Rows: engines=${d.database.table_counts.installed_engines}, instances=${d.database.table_counts.instances}, remote=${d.database.table_counts.remote_connections}, groups=${d.database.table_counts.connection_groups}, tags=${d.database.table_counts.tags}, embeddings=${d.database.table_counts.embedding_profiles}, history=${d.database.table_counts.search_history}, presets=${d.database.table_counts.search_presets}`,
    `- Manifest: schema v${d.manifest.schema_version}, updated ${d.manifest.updated_at}, ${d.manifest.engine_count} engines`,
    `- Keyring: ${d.keyring.backend_name} (${d.keyring.service_name}, ${d.keyring.stored_secret_refs} secret ref(s))`,
    "",
    "## Paths",
    `- Data Root: ${d.paths.data_dir}`,
    `- Database: ${d.paths.db_path}`,
    `- Binaries: ${d.paths.bin_dir}`,
    `- Instances: ${d.paths.instances_dir}`,
    `- Manifest: ${d.paths.manifest_path}`,
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
  const [subTab, setSubTab] = React.useState<DiagnosticsSubTab>("overview");
  const [report, setReport] = React.useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const loadDiagnostics = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getDiagnostics();
      setReport(next);
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

  const isHealthy =
    report &&
    report.database.quick_check === "ok" &&
    report.supervisor.error_count === 0;

  return (
    <div className="space-y-5">
      {/* Top Action & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          {report ? (
            <Badge variant={isHealthy ? "running" : "warning"}>
              <CheckCircle2 className="h-3 w-3" />
              {isHealthy
                ? "All Systems Healthy"
                : `${report.supervisor.error_count} Instance Error(s)`}
            </Badge>
          ) : (
            <Badge variant="default">Checking...</Badge>
          )}
          {report && (
            <span className="font-mono text-[11px] text-[var(--text-muted)]">
              v{report.app.version} · PID {report.app.pid} · Up{" "}
              {formatUptime(report.app.uptime_secs)}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadDiagnostics()}
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

      {/* Sub-navigation Tabs */}
      <div
        role="tablist"
        aria-label="Diagnostic Sections"
        className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1"
      >
        {(
          [
            {
              id: "overview" as const,
              label: "System & Runtime",
              icon: Laptop,
            },
            {
              id: "instances" as const,
              label: "Supervisor",
              icon: Server,
              badge: report ? String(report.supervisor.total_instances) : undefined,
            },
            {
              id: "storage_db" as const,
              label: "Database & Paths",
              icon: Database,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubTab(tab.id)}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md px-3.5 text-xs font-medium transition-colors cursor-pointer",
                active
                  ? "bg-[var(--bg-elevated)] text-[var(--accent-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
              {"badge" in tab && tab.badge !== undefined && (
                <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--text-muted)]">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-4 py-3 text-xs text-[var(--status-error)]">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: System & Runtime */}
      {report && subTab === "overview" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Laptop className="h-4 w-4 text-[var(--accent-secondary)]" />
                Host System & Live Utilization
              </div>
              <Badge variant="default" className="font-mono text-[11px]">
                {report.host.target_triple}
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
                    Data Volume
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
              <StatTile
                label="Kernel & Architecture"
                value={`${report.host.kernel_version} · ${report.host.arch}`}
              />
              <StatTile label="Target Triple" value={report.host.target_triple} />
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Cpu className="h-4 w-4 text-[var(--accent-primary)]" />
                Application & Runtime
              </div>
              <Badge variant="accent" className="font-mono">
                {report.app.build_profile}
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile
                label="EmbedBay Version"
                value={`v${report.app.version}`}
              />
              <StatTile
                label="Tauri Framework"
                value={`v${report.app.tauri_version}`}
              />
              <StatTile label="Process PID" value={report.app.pid} />
              <StatTile
                label="Application Uptime"
                value={formatUptime(report.app.uptime_secs)}
              />
              <StatTile
                label="OS Startup Launch"
                mono={false}
                value={report.app.autostart_enabled ? "Enabled" : "Disabled"}
              />
              <StatTile
                label="Window Close Behavior"
                mono={false}
                value={report.app.tray_mode}
              />
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: Supervisor & Instances */}
      {report && subTab === "instances" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <div className="text-[11px] text-[var(--text-secondary)]">
                Running
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-[var(--status-running)]">
                {report.supervisor.running_count}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <div className="text-[11px] text-[var(--text-secondary)]">
                Stopped / Embedded
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-[var(--text-primary)]">
                {report.supervisor.stopped_count} /{" "}
                {report.supervisor.embedded_count}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <div className="text-[11px] text-[var(--text-secondary)]">
                Managed RAM
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-[var(--accent-primary)]">
                {formatRamMb(report.supervisor.total_ram_bytes)}
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <div className="text-[11px] text-[var(--text-secondary)]">
                Total Restarts
              </div>
              <div className="mt-1 font-mono text-base font-semibold text-[var(--text-primary)]">
                {report.supervisor.total_restarts}
              </div>
            </div>
          </div>

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Activity className="h-4 w-4 text-[var(--status-running)]" />
                Supervised Instances
              </div>
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {report.supervisor.total_instances} registered
              </span>
            </div>

            {report.supervisor.instances.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                      <th className="px-3.5 py-2.5 font-medium">Instance</th>
                      <th className="px-3.5 py-2.5 font-medium">Status</th>
                      <th className="px-3.5 py-2.5 font-medium">Endpoint</th>
                      <th className="px-3.5 py-2.5 font-medium">PID</th>
                      <th className="px-3.5 py-2.5 font-medium">RAM</th>
                      <th className="px-3.5 py-2.5 font-medium">Uptime</th>
                      <th className="px-3.5 py-2.5 font-medium">Restarts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {report.supervisor.instances.map((inst) => (
                      <tr key={inst.id}>
                        <td className="px-3.5 py-2.5">
                          <div className="font-medium text-[var(--text-primary)]">
                            {inst.name}
                          </div>
                          <div className="font-mono text-[11px] text-[var(--text-muted)]">
                            {inst.engine_type} v{inst.engine_version}
                          </div>
                          {inst.last_error && (
                            <div className="mt-1 max-w-[240px] truncate font-mono text-[10px] text-[var(--status-error)]">
                              {inst.last_error}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <InstanceStatusBadge
                            status={inst.status as InstanceStatus}
                          />
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                          {inst.host}:{inst.port}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[11px] text-[var(--text-muted)]">
                          {inst.pid ?? "-"}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[11px] text-[var(--text-primary)]">
                          {inst.ram_bytes > 0
                            ? formatRamMb(inst.ram_bytes)
                            : "-"}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                          {inst.uptime_secs > 0
                            ? formatUptime(inst.uptime_secs)
                            : "-"}
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                          {inst.restart_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                No local database instances registered yet.
              </p>
            )}
          </section>
        </div>
      )}

      {/* TAB 3: Database, Catalog & Paths */}
      {report && subTab === "storage_db" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Database className="h-4 w-4 text-[var(--accent-ai)]" />
                SQLite Registry (app.db)
              </div>
              <Badge
                variant={
                  report.database.quick_check === "ok" ? "running" : "error"
                }
              >
                <CheckCircle2 className="h-3 w-3" />
                quick_check: {report.database.quick_check}
              </Badge>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile
                label="SQLite & Schema"
                value={`v${report.database.sqlite_version} · Schema v${report.database.schema_version}`}
              />
              <StatTile
                label="Journal & Foreign Keys"
                value={`${report.database.journal_mode.toUpperCase()} · FK ${report.database.foreign_keys ? "ON" : "OFF"}`}
              />
              <StatTile
                label="DB / WAL / SHM Size"
                value={`${formatBytes(report.database.db_bytes)} / ${formatBytes(report.database.wal_bytes)} / ${formatBytes(report.database.shm_bytes)}`}
              />
            </div>

            <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
              <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Table Row Counts
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {(
                  [
                    ["Engines", report.database.table_counts.installed_engines],
                    ["Instances", report.database.table_counts.instances],
                    ["Remote", report.database.table_counts.remote_connections],
                    ["Groups", report.database.table_counts.connection_groups],
                    ["Tags", report.database.table_counts.tags],
                    [
                      "Embeddings",
                      report.database.table_counts.embedding_profiles,
                    ],
                    ["History", report.database.table_counts.search_history],
                    ["Presets", report.database.table_counts.search_presets],
                  ] as const
                ).map(([label, count]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2"
                  >
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {label}
                    </div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-[var(--text-primary)]">
                      {count}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Package className="h-4 w-4 text-[var(--accent-primary)]" />
                  Engine Catalog Manifest
                </div>
                <div className="space-y-2.5">
                  <StatTile
                    label="Schema & Last Updated"
                    value={`v${report.manifest.schema_version} · ${report.manifest.updated_at}`}
                  />
                  <StatTile
                    label="Catalog Entries"
                    value={`${report.manifest.engine_count} engines`}
                  />
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <KeyRound className="h-4 w-4 text-[var(--accent-primary)]" />
                  OS Credential Store
                </div>
                <div className="space-y-2.5">
                  <StatTile
                    label="Backend & Service"
                    mono={false}
                    value={`${report.keyring.backend_name} (${report.keyring.service_name})`}
                  />
                  <StatTile
                    label="Stored Secret References"
                    value={`${report.keyring.stored_secret_refs} key(s) in keyring`}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <HardDrive className="h-4 w-4 text-[var(--text-secondary)]" />
              Storage & Configuration Paths
            </div>
            <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
              {(
                [
                  { label: "Data Root", path: report.paths.data_dir, dir: true },
                  { label: "SQLite DB", path: report.paths.db_path, dir: false },
                  { label: "Binaries", path: report.paths.bin_dir, dir: true },
                  {
                    label: "Instances",
                    path: report.paths.instances_dir,
                    dir: true,
                  },
                  {
                    label: "Manifest",
                    path: report.paths.manifest_path,
                    dir: false,
                  },
                ] as const
              ).map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                >
                  <span className="w-24 shrink-0 font-medium text-[var(--text-secondary)]">
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
        </div>
      )}
    </div>
  );
}
