import * as React from "react";
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  Globe,
  HardDrive,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { stopAllInstances } from "@/ipc/instances";
import { formatBytes, formatRamMb } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";

function utilizationBarClass(percent: number): string {
  if (percent >= 85) return "bg-[var(--status-error)]";
  if (percent >= 60) return "bg-[var(--status-starting)]";
  return "bg-[var(--accent-secondary)]";
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function MicroMeter({ percent }: { percent: number }) {
  const clamped = clampPercent(percent);
  return (
    <span className="inline-block h-1.5 w-8 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
      <span
        className={cn(
          "block h-full rounded-full transition-all duration-300",
          utilizationBarClass(clamped),
        )}
        style={{ width: `${Math.max(clamped > 0 ? 4 : 0, clamped)}%` }}
      />
    </span>
  );
}

function DetailBar({
  percent,
  colorClass,
}: {
  percent: number;
  colorClass?: string;
}) {
  const clamped = clampPercent(percent);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300",
          colorClass ?? utilizationBarClass(clamped),
        )}
        style={{ width: `${Math.max(clamped > 0 ? 2 : 0, clamped)}%` }}
      />
    </div>
  );
}

export function StatusBar() {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const totalRamBytes = useRuntimeStore((s) => s.totalRamBytes);
  const totalCpuPercent = useRuntimeStore((s) => s.totalCpuPercent);
  const totalDiskBytes = useRuntimeStore((s) => s.totalDiskBytes);
  const runningCount = useRuntimeStore((s) => s.runningCount);
  const hostMetrics = useRuntimeStore((s) => s.hostMetrics);
  const selectedConnectionKey = useRuntimeStore((s) => s.selectedConnectionKey);
  const refreshInstances = useRuntimeStore((s) => s.refreshInstances);

  const remoteConnections = useTabsStore((s) => s.remoteConnections);

  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [stoppingAll, setStoppingAll] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!popoverOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPopoverOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [popoverOpen]);

  const metricValues = Object.values(metrics);
  const errorCount = metricValues.filter((m) => m.status === "error").length;
  const startingCount = metricValues.filter(
    (m) => m.status === "starting",
  ).length;
  const stoppingCount = metricValues.filter(
    (m) => m.status === "stopping",
  ).length;
  const transitioningCount = startingCount + stoppingCount;

  const statusIndicator = React.useMemo(() => {
    if (errorCount > 0) {
      return {
        dotClass: "bg-[var(--status-error)]",
        textClass: "text-[var(--status-error)]",
        label:
          runningCount > 0
            ? `${runningCount} Running · ${errorCount} Error`
            : `${errorCount} Error`,
      };
    }
    if (transitioningCount > 0) {
      return {
        dotClass: "bg-[var(--status-starting)] animate-pulse",
        textClass: "text-[var(--status-starting)]",
        label: startingCount > 0 ? "Starting..." : "Stopping...",
      };
    }
    if (runningCount > 0) {
      return {
        dotClass: "bg-[var(--status-running)]",
        textClass: "text-[var(--text-primary)]",
        label: `Engine running · ${runningCount} active`,
      };
    }
    return {
      dotClass: "bg-[var(--status-stopped)]",
      textClass: "text-[var(--text-secondary)]",
      label: "Engine idle · 0 running",
    };
  }, [errorCount, runningCount, startingCount, transitioningCount]);

  const activeConnectionContext = React.useMemo(() => {
    if (activeSection !== "explorer" || !selectedConnectionKey) return null;
    if (selectedConnectionKey.startsWith("local:")) {
      const id = selectedConnectionKey.slice("local:".length);
      const inst = instances.find((i) => i.id === id);
      if (!inst) return null;
      const st = metrics[inst.id]?.status ?? "stopped";
      return {
        name: inst.name,
        kind: "local" as const,
        running:
          st === "running" ||
          st === "embedded" ||
          inst.engine_type === "lancedb",
      };
    }
    if (selectedConnectionKey.startsWith("remote:")) {
      const id = selectedConnectionKey.slice("remote:".length);
      const conn = remoteConnections.find((r) => r.id === id);
      if (!conn) return null;
      return {
        name: conn.name,
        kind: "remote" as const,
        running: true,
      };
    }
    return null;
  }, [
    activeSection,
    selectedConnectionKey,
    instances,
    metrics,
    remoteConnections,
  ]);

  const runningInstances = React.useMemo(() => {
    return instances
      .filter((inst) => metrics[inst.id]?.status === "running")
      .map((inst) => ({
        inst,
        m: metrics[inst.id],
      }))
      .sort((a, b) => (b.m?.ram_bytes ?? 0) - (a.m?.ram_bytes ?? 0));
  }, [instances, metrics]);

  const hostCpuPercent = clampPercent(hostMetrics.cpu_percent);
  const hostRamPercent =
    hostMetrics.memory_total_bytes > 0
      ? clampPercent(
          (hostMetrics.memory_used_bytes / hostMetrics.memory_total_bytes) *
            100,
        )
      : 0;
  const hostDiskUsedBytes = Math.max(
    0,
    hostMetrics.disk_total_bytes - hostMetrics.disk_available_bytes,
  );
  const hostDiskPercent =
    hostMetrics.disk_total_bytes > 0
      ? clampPercent((hostDiskUsedBytes / hostMetrics.disk_total_bytes) * 100)
      : 0;

  const handleStopAll = async () => {
    if (stoppingAll) return;
    setStoppingAll(true);
    try {
      const results = await stopAllInstances();
      toast.info(`Stopped ${results.length} running service(s)`);
      await refreshInstances();
    } catch (err: unknown) {
      toast.error(
        "Stop all failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setStoppingAll(false);
    }
  };

  return (
    <footer
      ref={containerRef}
      aria-label="System Status Bar"
      className="relative flex h-7 w-full shrink-0 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-[11px] select-none"
    >
      {/* Left: Engine / Supervisor Status + Active Explorer Context */}
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => setActiveSection("runtimes")}
          title="Open Local Runtimes Dashboard"
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-elevated)] cursor-pointer"
        >
          <span
            className={cn("h-2 w-2 rounded-full", statusIndicator.dotClass)}
          />
          <span className={cn("font-medium", statusIndicator.textClass)}>
            {statusIndicator.label}
          </span>
        </button>

        {activeConnectionContext && (
          <>
            <span className="h-3.5 w-px bg-[var(--border-subtle)]" />
            <div
              className="hidden sm:inline-flex min-w-0 items-center gap-1.5 text-[var(--text-secondary)]"
              title={`Active connection: ${activeConnectionContext.name}`}
            >
              {activeConnectionContext.kind === "remote" ? (
                <Globe className="h-3 w-3 shrink-0 text-[var(--accent-secondary)]" />
              ) : (
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    activeConnectionContext.running
                      ? "bg-[var(--status-running)]"
                      : "bg-[var(--status-stopped)]",
                  )}
                />
              )}
              <span className="max-w-[180px] truncate font-medium text-[var(--text-primary)]">
                {activeConnectionContext.name}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Right: Docker-Style Host & Managed DB Resource Cluster */}
      <button
        type="button"
        onClick={() => setPopoverOpen((prev) => !prev)}
        aria-expanded={popoverOpen}
        aria-label="System and Database Resource Telemetry"
        title="Click for Host & Managed DB Resource Breakdown"
        className={cn(
          "inline-flex items-center gap-3 rounded px-2 py-0.5 font-mono text-[10px] transition-colors cursor-pointer",
          popoverOpen
            ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]",
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          <Cpu className="h-3 w-3 text-[var(--accent-secondary)]" />
          <span>CPU {hostCpuPercent.toFixed(1)}%</span>
          <MicroMeter percent={hostCpuPercent} />
        </span>

        <span className="h-3 w-px bg-[var(--border-subtle)]" />

        <span
          className={cn(
            "inline-flex items-center gap-1",
            totalRamBytes > 0 && "text-[var(--accent-primary)]",
          )}
        >
          <Database className="h-3 w-3" />
          <span>DB {formatRamMb(totalRamBytes)}</span>
        </span>

        <span className="h-3 w-px bg-[var(--border-subtle)]" />

        <span className="inline-flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-[var(--accent-ai)]" />
          <span>
            RAM {formatRamMb(hostMetrics.memory_used_bytes)} /{" "}
            {formatRamMb(hostMetrics.memory_total_bytes)}
          </span>
          <MicroMeter percent={hostRamPercent} />
        </span>

        <span className="hidden md:inline-flex items-center gap-1.5">
          <span className="h-3 w-px bg-[var(--border-subtle)]" />
          <HardDrive className="h-3 w-3 text-[var(--text-muted)]" />
          <span>Disk {formatBytes(totalDiskBytes)}</span>
        </span>

        {popoverOpen ? (
          <ChevronDown className="h-3 w-3 text-[var(--text-muted)]" />
        ) : (
          <ChevronUp className="h-3 w-3 text-[var(--text-muted)]" />
        )}
      </button>

      {/* Resource Breakdown Popover */}
      {popoverOpen && (
        <div
          role="dialog"
          aria-label="Resource Usage Details"
          className="absolute right-3 bottom-8 z-50 w-[340px] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3.5 shadow-2xl select-text"
        >
          {/* Host System Section */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Host System
              </span>
              {hostMetrics.cpu_cores > 0 && (
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {hostMetrics.cpu_cores} logical cores
                </span>
              )}
            </div>

            <div className="space-y-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5">
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                    <Cpu className="h-3 w-3 text-[var(--accent-secondary)]" />
                    CPU Utilization
                  </span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {hostCpuPercent.toFixed(1)}%
                  </span>
                </div>
                <DetailBar percent={hostCpuPercent} />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                    <Activity className="h-3 w-3 text-[var(--accent-ai)]" />
                    System RAM
                  </span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {formatRamMb(hostMetrics.memory_used_bytes)} /{" "}
                    {formatRamMb(hostMetrics.memory_total_bytes)} (
                    {Math.round(hostRamPercent)}%)
                  </span>
                </div>
                <DetailBar
                  percent={hostRamPercent}
                  colorClass="bg-[var(--accent-ai)]"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                    <HardDrive className="h-3 w-3 text-[var(--text-muted)]" />
                    Data Drive
                  </span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    {formatBytes(hostMetrics.disk_available_bytes)} free /{" "}
                    {formatBytes(hostMetrics.disk_total_bytes)}
                  </span>
                </div>
                <DetailBar
                  percent={hostDiskPercent}
                  colorClass="bg-[var(--text-secondary)]"
                />
              </div>
            </div>
          </div>

          {/* Managed Vector DBs Section */}
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Managed Vector DBs
              </span>
              <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                {runningCount} running
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5">
                <div className="text-[10px] text-[var(--text-muted)]">
                  DB CPU
                </div>
                <div className="font-mono text-xs font-semibold text-[var(--accent-secondary)]">
                  {clampPercent(totalCpuPercent).toFixed(1)}%
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5">
                <div className="text-[10px] text-[var(--text-muted)]">
                  DB RAM
                </div>
                <div className="font-mono text-xs font-semibold text-[var(--accent-primary)]">
                  {formatRamMb(totalRamBytes)}
                </div>
              </div>
              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5">
                <div className="text-[10px] text-[var(--text-muted)]">
                  DB Disk
                </div>
                <div className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                  {formatBytes(totalDiskBytes)}
                </div>
              </div>
            </div>

            {runningInstances.length > 0 ? (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1.5">
                {runningInstances.map(({ inst, m }) => (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => {
                      setPopoverOpen(false);
                      setActiveSection("runtimes");
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors hover:bg-[var(--bg-elevated)] cursor-pointer"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-running)]" />
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate font-medium text-[var(--text-primary)]">
                          {inst.name}
                        </span>
                        <span className="shrink-0 font-mono text-[9px] leading-none uppercase text-[var(--text-muted)]">
                          {inst.engine_type}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-[var(--text-secondary)]">
                      <span>{(m?.cpu_percent ?? 0).toFixed(1)}%</span>
                      <span className="text-[var(--accent-primary)]">
                        {formatRamMb(m?.ram_bytes ?? 0)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-center text-[11px] text-[var(--text-muted)]">
                No local database daemons running
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setPopoverOpen(false);
                setActiveSection("runtimes");
              }}
            >
              <Boxes className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              Local Runtimes
            </Button>

            {runningCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={stoppingAll}
                onClick={() => void handleStopAll()}
              >
                <Square className="h-3 w-3 fill-current text-[var(--status-error)]" />
                {stoppingAll ? "Stopping..." : "Stop All"}
              </Button>
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
