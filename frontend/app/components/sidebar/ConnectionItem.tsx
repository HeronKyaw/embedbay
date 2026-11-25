import {
  Pencil,
  Play,
  Square,
  Terminal,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { startInstance, stopInstance } from "@/ipc/instances";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { InstanceRecord, InstanceStatus, Tag } from "@/types/runtime";

function statusDotClass(status: InstanceStatus): string {
  switch (status) {
    case "running":
      return "bg-[var(--status-running)]";
    case "starting":
    case "stopping":
      return "bg-[var(--status-starting)] animate-pulse";
    case "error":
      return "bg-[var(--status-error)]";
    case "embedded":
      return "bg-[var(--accent-secondary)]";
    default:
      return "bg-[var(--status-stopped)]";
  }
}

export function ConnectionItem({
  instance,
  tags,
  onSelect,
}: {
  instance: InstanceRecord;
  tags: Tag[];
  onSelect?: () => void;
}) {
  const metrics = useRuntimeStore((s) => s.metrics[instance.id]);
  const selectedConnectionKey = useRuntimeStore((s) => s.selectedConnectionKey);
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const setActiveLogInstanceId = useRuntimeStore(
    (s) => s.setActiveLogInstanceId,
  );
  const openEditInstanceModal = useRuntimeStore(
    (s) => s.openEditInstanceModal,
  );
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const status: InstanceStatus = metrics?.status ?? "stopped";
  const isRunning = status === "running";
  const isBusy = status === "starting" || status === "stopping";
  const isEmbedded = status === "embedded" || instance.engine_type === "lancedb";
  const key = `local:${instance.id}`;
  const selected = selectedConnectionKey === key;

  const itemTags = tags.filter((t) => instance.tag_ids.includes(t.id));

  const handleToggleRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (isRunning) {
        await stopInstance(instance.id);
        toast.info(`Stopping ${instance.name}`);
      } else {
        await startInstance(instance.id);
        toast.success(`Started ${instance.name}`);
      }
    } catch (err: unknown) {
      toast.error(
        `Failed to ${isRunning ? "stop" : "start"} ${instance.name}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        setSelectedConnectionKey(key);
        onSelect?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSelectedConnectionKey(key);
          onSelect?.();
        }
      }}
      style={
        instance.color
          ? { borderLeftColor: instance.color, borderLeftWidth: "3px" }
          : undefined
      }
      className={cn(
        "group relative flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors cursor-pointer select-none",
        selected
          ? "border-[var(--accent-primary)]/60 bg-[var(--bg-elevated)]"
          : "border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]/70",
      )}
    >
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", statusDotClass(status))}
        title={`Status: ${status}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-[var(--text-primary)]">
            {instance.name}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className="uppercase">{instance.engine_type}</span>
          {!isEmbedded && (
            <span className="font-mono">:{instance.port}</span>
          )}
          {itemTags.length > 0 && (
            <span className="flex items-center gap-0.5">
              {itemTags.slice(0, 3).map((t) => (
                <span
                  key={t.id}
                  title={t.name}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
              ))}
            </span>
          )}
        </div>
      </div>

      {/* Inline Hover Controls */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {!isEmbedded && (
          <button
            type="button"
            disabled={isBusy}
            onClick={(e) => void handleToggleRun(e)}
            title={isRunning ? "Stop Instance" : "Start Instance"}
            aria-label={isRunning ? `Stop ${instance.name}` : `Start ${instance.name}`}
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded cursor-pointer",
              isRunning
                ? "text-[var(--status-error)] hover:bg-[var(--status-error)]/15"
                : "text-[var(--status-running)] hover:bg-[var(--status-running)]/15",
            )}
          >
            {isRunning ? (
              <Square className="h-3 w-3 fill-current" />
            ) : (
              <Play className="h-3 w-3 fill-current" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setActiveLogInstanceId(instance.id);
            setActiveSection("runtimes");
          }}
          title="View Logs"
          aria-label={`View logs for ${instance.name}`}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <Terminal className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openEditInstanceModal(instance);
          }}
          title="Edit Instance"
          aria-label={`Edit ${instance.name}`}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
