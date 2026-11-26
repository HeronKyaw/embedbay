import * as React from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Boxes,
  Code2,
  Database,
  Moon,
  Pencil,
  Play,
  Plus,
  Power,
  RotateCw,
  Skull,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SnippetModal } from "@/components/explorer/SnippetModal";
import { LogViewer } from "@/components/manager/LogViewer";
import { ResourceMeters } from "@/components/manager/ResourceMeters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InstanceStatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toast";
import {
  deleteInstance,
  forceKillInstance,
  restartInstance,
  startInstance,
  stopAllInstances,
  stopIdleInstances,
  stopInstance,
  updateInstance,
} from "@/ipc/instances";
import { formatBytes, formatRamMb } from "@/lib/format";
import { generateConnectionSnippets } from "@/lib/snippets";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { InstanceRecord, InstanceStatus } from "@/types/runtime";

export function ServicesDashboard({
  onExploreInstance,
  onBackupInstance,
  onRestoreInstance,
}: {
  onExploreInstance?: (instanceId: string) => void;
  onBackupInstance?: (instance: InstanceRecord) => void;
  onRestoreInstance?: (instance: InstanceRecord) => void;
}) {
  const instances = useRuntimeStore((s) => s.instances);
  const groups = useRuntimeStore((s) => s.groups);
  const tags = useRuntimeStore((s) => s.tags);
  const metrics = useRuntimeStore((s) => s.metrics);
  const totalRamBytes = useRuntimeStore((s) => s.totalRamBytes);
  const runningCount = useRuntimeStore((s) => s.runningCount);
  const activeLogInstanceId = useRuntimeStore((s) => s.activeLogInstanceId);
  const setActiveLogInstanceId = useRuntimeStore(
    (s) => s.setActiveLogInstanceId,
  );
  const openCreateInstanceModal = useRuntimeStore(
    (s) => s.openCreateInstanceModal,
  );
  const openEditInstanceModal = useRuntimeStore(
    (s) => s.openEditInstanceModal,
  );
  const refreshInstances = useRuntimeStore((s) => s.refreshInstances);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<InstanceRecord | null>(null);
  const [deleteDataFlag, setDeleteDataFlag] = React.useState(false);
  const [snippetInstance, setSnippetInstance] =
    React.useState<InstanceRecord | null>(null);

  const snippetInstanceSnippets = React.useMemo(
    () =>
      snippetInstance
        ? generateConnectionSnippets({
            name: snippetInstance.name,
            engineType: snippetInstance.engine_type,
            host: snippetInstance.host,
            port: snippetInstance.port,
            dataDir: snippetInstance.data_dir,
            hasAuth: false,
          })
        : [],
    [snippetInstance],
  );

  const totalDiskBytes = Object.values(metrics).reduce(
    (acc, m) => acc + (m.disk_bytes ?? 0),
    0,
  );

  const runAction = async (
    id: string,
    action: () => Promise<unknown>,
    successMsg: string,
  ) => {
    setBusyId(id);
    try {
      await action();
      toast.success(successMsg);
      await refreshInstances();
    } catch (err: unknown) {
      toast.error(
        "Operation failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await runAction(
      target.id,
      () => deleteInstance(target.id, deleteDataFlag),
      `Deleted instance "${target.name}"`,
    );
    if (activeLogInstanceId === target.id) {
      setActiveLogInstanceId(null);
    }
    setDeleteDataFlag(false);
  };

  const handleStopAll = async () => {
    try {
      const results = await stopAllInstances();
      toast.info(`Stopped ${results.length} running service(s)`);
      await refreshInstances();
    } catch (err: unknown) {
      toast.error(
        "Stop all failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleStopIdle = async () => {
    try {
      const results = await stopIdleInstances(5);
      toast.info(
        results.length > 0
          ? `Stopped ${results.length} idle service(s)`
          : "No idle services exceeded threshold",
      );
      await refreshInstances();
    } catch (err: unknown) {
      toast.error(
        "Stop idle failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <PageHeader
        icon={<Boxes className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />}
        title="Local Runtimes & Services"
        badges={
          <>
            <Badge
              variant={runningCount > 0 ? "running" : "default"}
              className="h-5"
            >
              {runningCount} Running
            </Badge>
            <span className="inline-flex h-5 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] leading-none text-[var(--text-secondary)]">
              RAM {formatRamMb(totalRamBytes)}
            </span>
            <span className="inline-flex h-5 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] leading-none text-[var(--text-secondary)]">
              Disk {formatBytes(totalDiskBytes)}
            </span>
          </>
        }
        description="Native vector DB instances supervised without Docker or flashing console windows."
        actions={
          <>
            {runningCount > 0 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleStopIdle()}
                >
                  <Moon className="h-3.5 w-3.5" />
                  Stop Idle Services
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleStopAll()}
                >
                  <Square className="h-3.5 w-3.5 text-[var(--status-error)]" />
                  Stop All
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setActiveSection("store")}
            >
              Engine Store
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => openCreateInstanceModal()}
            >
              <Plus className="h-3.5 w-3.5" />
              New Instance
            </Button>
          </>
        }
      />

      {/* Instances List */}
      {instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-12 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--accent-primary)]">
            <Boxes className="h-5 w-5" />
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            No Local Vector DB Instances Yet
          </h2>
          <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
            Download Qdrant, Chroma, or PostgreSQL+pgvector in the Engine Store
            (or enable embedded LanceDB), then create isolated local instances.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setActiveSection("store")}
            >
              Browse Engine Store
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => openCreateInstanceModal()}
            >
              <Plus className="h-3.5 w-3.5" />
              Create Instance
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {instances.map((inst) => {
            const m = metrics[inst.id];
            const status: InstanceStatus = m?.status ?? "stopped";
            const isRunning = status === "running";
            const isStartingOrStopping =
              status === "starting" || status === "stopping";
            const isEmbedded =
              status === "embedded" || inst.engine_type === "lancedb";
            const isBusy = busyId === inst.id;
            const group = groups.find((g) => g.id === inst.group_id);
            const itemTags = tags.filter((t) => inst.tag_ids.includes(t.id));

            return (
              <div
                key={inst.id}
                style={
                  inst.color
                    ? { borderLeftColor: inst.color, borderLeftWidth: "4px" }
                    : undefined
                }
                className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {inst.name}
                      </h3>
                      <InstanceStatusBadge
                        status={status}
                        embeddedLabel="Embedded (0 MB)"
                      />
                      {group && (
                        <Badge variant="default" className="text-[10px]">
                          {group.name}
                        </Badge>
                      )}
                      {inst.idle_timeout_minutes > 0 && !isEmbedded && (
                        <Badge variant="ai" className="text-[10px]">
                          Idle: {inst.idle_timeout_minutes}m
                        </Badge>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                      <span className="font-mono uppercase text-[var(--accent-secondary)]">
                        {inst.engine_type} v{inst.engine_version}
                      </span>
                      {!isEmbedded && (
                        <span className="font-mono">
                          {inst.host}:{inst.port}
                          {inst.grpc_port ? ` (gRPC :${inst.grpc_port})` : ""}
                        </span>
                      )}
                      {m?.pid && (
                        <span className="font-mono text-[var(--text-muted)]">
                          PID {m.pid}
                        </span>
                      )}
                    </div>
                    {inst.description && (
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        {inst.description}
                      </p>
                    )}
                  </div>

                  {/* Boot Toggle */}
                  {!isEmbedded && (
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(
                          inst.id,
                          () =>
                            updateInstance(inst.id, {
                              auto_start: !inst.auto_start,
                            }),
                          `${inst.auto_start ? "Disabled" : "Enabled"} boot auto-start for ${inst.name}`,
                        )
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium cursor-pointer",
                        inst.auto_start
                          ? "border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
                          : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                      )}
                      title="Toggle OS Boot Auto-Start"
                    >
                      <Power className="h-3 w-3" />
                      {inst.auto_start ? "Auto-Start" : "Manual"}
                    </button>
                  )}
                </div>

                {/* Tags */}
                {itemTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {itemTags.map((t) => (
                      <span
                        key={t.id}
                        style={{ "--pill-color": t.color } as React.CSSProperties}
                        className="tag-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: t.color }}
                        />
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Error Alert */}
                {m?.last_error && (
                  <div className="rounded-md border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-2.5 py-1.5 text-[11px] text-[var(--status-error)]">
                    {m.last_error}
                  </div>
                )}

                <ResourceMeters metrics={m} />

                {/* Action Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!isEmbedded && (
                      <>
                        {isRunning ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() =>
                              void runAction(
                                inst.id,
                                () => stopInstance(inst.id),
                                `Stopped ${inst.name}`,
                              )
                            }
                          >
                            <Square className="h-3 w-3 fill-current text-[var(--status-error)]" />
                            Stop
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            disabled={isBusy || isStartingOrStopping}
                            onClick={() =>
                              void runAction(
                                inst.id,
                                () => startInstance(inst.id),
                                `Started ${inst.name}`,
                              )
                            }
                          >
                            <Play className="h-3 w-3 fill-current" />
                            Start
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={isBusy || !isRunning}
                          onClick={() =>
                            void runAction(
                              inst.id,
                              () => restartInstance(inst.id),
                              `Restarted ${inst.name}`,
                            )
                          }
                        >
                          <RotateCw className="h-3 w-3" />
                          Restart
                        </Button>
                        {(isRunning || isStartingOrStopping) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Force Kill Process"
                            onClick={() =>
                              void runAction(
                                inst.id,
                                () => forceKillInstance(inst.id),
                                `Force-killed ${inst.name}`,
                              )
                            }
                          >
                            <Skull className="h-3.5 w-3.5 text-[var(--status-error)]" />
                          </Button>
                        )}
                      </>
                    )}

                    {(isRunning || isEmbedded) && onExploreInstance && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onExploreInstance(inst.id)}
                      >
                        <Database className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                        Explore
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Copy Connection Snippet"
                      onClick={() => setSnippetInstance(inst)}
                    >
                      <Code2 className="h-3.5 w-3.5" />
                    </Button>
                    {!isEmbedded && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="View Logs"
                        onClick={() =>
                          setActiveLogInstanceId(
                            activeLogInstanceId === inst.id ? null : inst.id,
                          )
                        }
                      >
                        <Terminal
                          className={cn(
                            "h-3.5 w-3.5",
                            activeLogInstanceId === inst.id &&
                              "text-[var(--accent-primary)]",
                          )}
                        />
                      </Button>
                    )}
                    {onBackupInstance && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Backup Instance (.zip)"
                        onClick={() => onBackupInstance(inst)}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {onRestoreInstance && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Restore Instance Snapshot (.zip)"
                        onClick={() => onRestoreInstance(inst)}
                      >
                        <ArchiveRestore className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Edit / Rename Instance"
                      onClick={() => openEditInstanceModal(inst)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Delete Instance"
                      onClick={() => {
                        setDeleteDataFlag(false);
                        setDeleteTarget(inst);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Embedded Live Log Viewer */}
      {activeLogInstanceId && (
        <LogViewer
          instanceId={activeLogInstanceId}
          onClose={() => setActiveLogInstanceId(null)}
        />
      )}

      {/* Confirm Delete Modal */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        icon={<Trash2 className="h-4 w-4 shrink-0 text-[var(--status-error)]" />}
        title="Delete Instance"
        description="Remove this local vector database instance from EmbedBay."
        maxWidthClass="w-[480px]"
      >
        {deleteTarget &&
          (() => {
            const targetMetrics = metrics[deleteTarget.id];
            const targetStatus: InstanceStatus =
              targetMetrics?.status ?? "stopped";
            const targetEmbedded =
              targetStatus === "embedded" ||
              deleteTarget.engine_type === "lancedb";

            return (
              <div className="space-y-4">
                {/* Instance Summary Card */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {deleteTarget.name}
                    </span>
                    <InstanceStatusBadge
                      status={targetStatus}
                      embeddedLabel="Embedded"
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-[var(--text-secondary)]">
                    <span className="uppercase text-[var(--accent-secondary)]">
                      {deleteTarget.engine_type} v{deleteTarget.engine_version}
                    </span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span>
                      {targetEmbedded
                        ? "Embedded"
                        : `${deleteTarget.host}:${deleteTarget.port}`}
                    </span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span>
                      Disk {formatBytes(targetMetrics?.disk_bytes ?? 0)}
                    </span>
                  </div>
                  {targetStatus === "running" && (
                    <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-[var(--status-starting)]/30 bg-[var(--status-starting)]/10 px-2.5 py-1.5 text-[11px] text-[var(--status-starting)]">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Running process will be stopped before removal.
                      </span>
                    </div>
                  )}
                </div>

                {/* Disk Data Deletion Option Card */}
                <div
                  className={cn(
                    "rounded-xl border p-3.5 transition-colors",
                    deleteDataFlag
                      ? "border-[var(--status-error)]/40 bg-[var(--status-error)]/10"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)]",
                  )}
                >
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deleteDataFlag}
                      onChange={(e) => setDeleteDataFlag(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--status-error)]"
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="text-xs font-medium text-[var(--text-primary)]">
                        Also permanently delete vector data & logs on disk
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        {deleteDataFlag
                          ? "All vector collections, indexes, and log files in this directory will be permanently erased."
                          : "Unchecked: instance config is removed, while your vector data directory remains preserved on disk."}
                      </p>
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--text-muted)] break-all">
                        {deleteTarget.data_dir}
                      </div>
                    </div>
                  </label>
                </div>

                {/* Action Footer */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleConfirmDelete()}
                  >
                    {deleteDataFlag ? "Delete Instance & Data" : "Delete Instance"}
                  </Button>
                </div>
              </div>
            );
          })()}
      </Dialog>

      <SnippetModal
        open={Boolean(snippetInstance)}
        onOpenChange={(next) => {
          if (!next) setSnippetInstance(null);
        }}
        title={`Connect to ${snippetInstance?.name ?? "Instance"}`}
        snippets={snippetInstanceSnippets}
      />
    </div>
  );
}
