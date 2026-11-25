import * as React from "react";
import {
  Copy,
  Download,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  clearInstanceLogs,
  subscribeInstanceLogs,
} from "@/ipc/instances";
import { formatLogTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";

export function LogViewer({
  instanceId,
  onClose,
}: {
  instanceId: string;
  onClose?: () => void;
}) {
  const instances = useRuntimeStore((s) => s.instances);
  const logs = useRuntimeStore((s) => s.logsByInstance[instanceId] ?? []);
  const setInstanceLogs = useRuntimeStore((s) => s.setInstanceLogs);

  const [streamFilter, setStreamFilter] = React.useState<string>("all");
  const [search, setSearch] = React.useState("");
  const [autoScroll, setAutoScroll] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const instance = instances.find((i) => i.id === instanceId);

  React.useEffect(() => {
    let active = true;
    void subscribeInstanceLogs(instanceId, 500)
      .then((entries) => {
        if (active) setInstanceLogs(instanceId, entries);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [instanceId, setInstanceLogs]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((entry) => {
      if (streamFilter !== "all" && entry.stream !== streamFilter) return false;
      if (q && !entry.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, streamFilter, search]);

  React.useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filtered.length, autoScroll]);

  const handleCopy = () => {
    const text = filtered
      .map(
        (l) =>
          `[${formatLogTime(l.timestamp_ms)}][${l.stream}] ${l.message}`,
      )
      .join("\n");
    void navigator.clipboard.writeText(text);
    toast.success("Copied filtered logs to clipboard");
  };

  const handleExport = () => {
    const text = filtered
      .map(
        (l) =>
          `[${formatLogTime(l.timestamp_ms)}][${l.stream}] ${l.message}`,
      )
      .join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${instance?.name ?? instanceId}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    try {
      await clearInstanceLogs(instanceId);
      setInstanceLogs(instanceId, []);
      toast.info("Cleared instance logs");
    } catch (err: unknown) {
      toast.error(
        "Failed to clear logs",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">
            Live Logs: {instance?.name ?? instanceId}
          </span>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {filtered.length} lines
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex h-7 items-center gap-1.5 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2">
            <Search className="h-3 w-3 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter output..."
              className="w-32 bg-transparent text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
            />
          </div>

          <select
            value={streamFilter}
            onChange={(e) => setStreamFilter(e.target.value)}
            className="h-7 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-1.5 text-[11px] text-[var(--text-primary)] focus:outline-none"
          >
            <option value="all">All Streams</option>
            <option value="stdout">stdout</option>
            <option value="stderr">stderr</option>
            <option value="system">system</option>
          </select>

          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              "h-7 rounded border px-2 text-[11px] font-medium cursor-pointer",
              autoScroll
                ? "border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
                : "border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-muted)]",
            )}
          >
            Auto-scroll
          </button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Copy Logs"
            onClick={handleCopy}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Download .log"
            onClick={handleExport}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Clear Logs"
            onClick={() => void handleClear()}
          >
            <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
          </Button>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Close Log Viewer"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Monospace Log Viewport */}
      <div
        ref={scrollRef}
        className="h-64 overflow-y-auto bg-[var(--bg-canvas)] p-3 font-mono text-[11px] leading-relaxed"
      >
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
            No log lines captured yet. Start the instance to stream output.
          </div>
        ) : (
          filtered.map((entry, idx) => (
            <div
              key={`${entry.timestamp_ms}-${idx}`}
              className="flex items-start gap-2 border-b border-[var(--border-subtle)]/30 py-0.5"
            >
              <span className="shrink-0 text-[var(--text-muted)]">
                {formatLogTime(entry.timestamp_ms)}
              </span>
              <span
                className={cn(
                  "w-12 shrink-0 uppercase",
                  entry.stream === "stderr"
                    ? "text-[var(--status-error)]"
                    : entry.stream === "system"
                      ? "text-[var(--accent-secondary)]"
                      : "text-[var(--accent-primary)]",
                )}
              >
                {entry.stream}
              </span>
              <span className="min-w-0 flex-1 break-all text-[var(--text-primary)]">
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
