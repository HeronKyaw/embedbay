import { Activity, Clock, Cpu, HardDrive } from "lucide-react";
import { formatBytes, formatRamMb, formatUptime } from "@/lib/format";
import type { InstanceMetrics } from "@/types/runtime";

export function ResourceMeters({ metrics }: { metrics?: InstanceMetrics }) {
  const status = metrics?.status ?? "stopped";
  const active = status === "running";

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5">
        <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
          <Activity className="h-3 w-3 text-[var(--accent-primary)]" />
          RAM
        </div>
        <div className="mt-0.5 font-mono text-xs font-semibold text-[var(--text-primary)]">
          {active ? formatRamMb(metrics?.ram_bytes ?? 0) : "0 MB"}
        </div>
      </div>

      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5">
        <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
          <Cpu className="h-3 w-3 text-[var(--accent-secondary)]" />
          CPU
        </div>
        <div className="mt-0.5 font-mono text-xs font-semibold text-[var(--text-primary)]">
          {active ? `${(metrics?.cpu_percent ?? 0).toFixed(1)}%` : "0.0%"}
        </div>
      </div>

      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5">
        <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
          <Clock className="h-3 w-3 text-[var(--accent-ai)]" />
          Uptime
        </div>
        <div className="mt-0.5 font-mono text-xs font-semibold text-[var(--text-primary)]">
          {active ? formatUptime(metrics?.uptime_secs ?? 0) : "—"}
        </div>
      </div>

      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5">
        <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
          <HardDrive className="h-3 w-3 text-[var(--text-secondary)]" />
          Data Disk
        </div>
        <div className="mt-0.5 font-mono text-xs font-semibold text-[var(--text-primary)]">
          {formatBytes(metrics?.disk_bytes ?? 0)}
        </div>
      </div>
    </div>
  );
}
