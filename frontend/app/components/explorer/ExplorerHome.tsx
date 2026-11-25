import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Database,
  FolderPlus,
  Globe,
  Inbox,
  Loader2,
  Pencil,
  Play,
  Plus,
  Search,
  Square,
  Tag as TagIcon,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { GroupIcon, GroupModal } from "@/components/sidebar/GroupModal";
import { TagManagerModal } from "@/components/sidebar/TagManagerModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InstanceStatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toast";
import { deleteRemoteConnection } from "@/ipc/connections";
import { deleteGroup, updateGroup } from "@/ipc/groupsTags";
import {
  startGroupInstances,
  startInstance,
  stopGroupInstances,
  stopInstance,
} from "@/ipc/instances";
import { formatBytes, formatRamMb } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type SidebarStatusFilter,
  useRuntimeStore,
} from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type { ConnectionTarget, RemoteConnection } from "@/types/explorer";
import type {
  ConnectionGroup,
  InstanceRecord,
  InstanceStatus,
} from "@/types/runtime";

const STATUS_CHIPS: readonly { id: SidebarStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "stopped", label: "Stopped" },
  { id: "remote", label: "Remote" },
];

function LocalConnectionCard({
  instance,
  onExplore,
}: {
  instance: InstanceRecord;
  onExplore: (key: string, target: ConnectionTarget, ready: boolean) => void;
}) {
  const metrics = useRuntimeStore((s) => s.metrics[instance.id]);
  const tags = useRuntimeStore((s) => s.tags);
  const openEditInstanceModal = useRuntimeStore(
    (s) => s.openEditInstanceModal,
  );
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const openLogsTab = useTabsStore((s) => s.openLogsTab);

  const [busy, setBusy] = React.useState(false);

  const status: InstanceStatus = metrics?.status ?? "stopped";
  const isRunning = status === "running";
  const isBusy = busy || status === "starting" || status === "stopping";
  const isEmbedded = status === "embedded" || instance.engine_type === "lancedb";
  const isReady = isRunning || isEmbedded;
  const key = `local:${instance.id}`;
  const target: ConnectionTarget = {
    kind: "local_instance",
    instance_id: instance.id,
  };
  const itemTags = tags.filter((t) => instance.tag_ids.includes(t.id));

  const handleToggleRun = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBusy) return;
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onExplore(key, target, isReady)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onExplore(key, target, isReady);
        }
      }}
      style={
        instance.color
          ? { borderLeftColor: instance.color, borderLeftWidth: "4px" }
          : undefined
      }
      className="group flex flex-col justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition-colors hover:border-[var(--border-strong)] cursor-pointer"
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold leading-tight text-[var(--text-primary)]">
                {instance.name}
              </h3>
              <InstanceStatusBadge status={status} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5 font-mono text-[11px] leading-none text-[var(--text-secondary)]">
              <span className="uppercase text-[var(--accent-secondary)]">
                {instance.engine_type} v{instance.engine_version}
              </span>
              {!isEmbedded && (
                <>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span>
                    {instance.host}:{instance.port}
                  </span>
                </>
              )}
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onExplore(key, target, isReady);
            }}
          >
            Explore
            <ArrowRight className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
          </Button>
        </div>

        {instance.description && (
          <p className="mt-2 line-clamp-2 text-xs text-[var(--text-muted)]">
            {instance.description}
          </p>
        )}

        {itemTags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {itemTags.map((t) => (
              <span
                key={t.id}
                style={{ "--pill-color": t.color } as React.CSSProperties}
                className="tag-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                <span>{t.name}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
        <div className="flex items-baseline gap-3 font-mono text-[11px] leading-none text-[var(--text-muted)]">
          {isRunning ? (
            <>
              <span className="text-[var(--accent-primary)]">
                RAM {formatRamMb(metrics?.ram_bytes ?? 0)}
              </span>
              <span>CPU {(metrics?.cpu_percent ?? 0).toFixed(1)}%</span>
            </>
          ) : (
            <span>{isEmbedded ? "Zero daemon" : "Daemon offline"}</span>
          )}
          <span>Disk {formatBytes(metrics?.disk_bytes ?? 0)}</span>
        </div>

        <div className="flex items-center gap-1">
          {!isEmbedded && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={(e) => void handleToggleRun(e)}
            >
              {isRunning ? (
                <>
                  <Square className="h-3 w-3 fill-current text-[var(--status-error)]" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 fill-current text-[var(--status-running)]" />
                  Start
                </>
              )}
            </Button>
          )}
          {!isEmbedded && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Open Logs"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedConnectionKey(key);
                openLogsTab(instance.id, instance.name);
              }}
            >
              <Terminal className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Edit Instance"
            onClick={(e) => {
              e.stopPropagation();
              openEditInstanceModal(instance);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function RemoteConnectionCard({
  conn,
  onExplore,
  isConnecting = false,
}: {
  conn: RemoteConnection;
  onExplore: (
    key: string,
    target: ConnectionTarget,
    ready: boolean,
  ) => void | Promise<void>;
  isConnecting?: boolean;
}) {
  const tags = useRuntimeStore((s) => s.tags);
  const selectedConnectionKey = useRuntimeStore((s) => s.selectedConnectionKey);
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const openRemoteModal = useTabsStore((s) => s.openRemoteModal);
  const refreshConnectionsAndProfiles = useTabsStore(
    (s) => s.refreshConnectionsAndProfiles,
  );
  const clearConnectionCollections = useTabsStore(
    (s) => s.clearConnectionCollections,
  );
  const closeTabsForConnection = useTabsStore((s) => s.closeTabsForConnection);
  const clearConnectionError = useTabsStore((s) => s.clearConnectionError);

  const key = `remote:${conn.id}`;
  const connectionError = useTabsStore((s) => s.connectionErrors[key] ?? null);
  const target: ConnectionTarget = {
    kind: "remote_connection",
    connection_id: conn.id,
  };
  const itemTags = tags.filter((t) => conn.tag_ids.includes(t.id));

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteRemoteConnection(conn.id);
      if (selectedConnectionKey === key) setSelectedConnectionKey(null);
      clearConnectionCollections(key);
      closeTabsForConnection(key);
      await refreshConnectionsAndProfiles();
      toast.info(`Removed "${conn.name}"`);
    } catch (err: unknown) {
      toast.error(
        "Failed to remove connection",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-busy={isConnecting}
      onClick={() => {
        if (!isConnecting) void onExplore(key, target, true);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !isConnecting) {
          e.preventDefault();
          void onExplore(key, target, true);
        }
      }}
      style={
        conn.color
          ? { borderLeftColor: conn.color, borderLeftWidth: "4px" }
          : undefined
      }
      className={cn(
        "group flex flex-col justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition-colors hover:border-[var(--border-strong)] cursor-pointer",
        isConnecting && "opacity-90",
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Globe
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: conn.color ?? "var(--accent-secondary)" }}
              />
              <h3 className="truncate text-sm font-semibold leading-tight text-[var(--text-primary)]">
                {conn.name}
              </h3>
              <Badge variant="accent">Remote</Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5 font-mono text-[11px] leading-none text-[var(--text-secondary)]">
              <span className="uppercase text-[var(--accent-secondary)]">
                {conn.engine_type}
              </span>
              <span className="text-[var(--text-muted)]">·</span>
              <span className="truncate">{conn.endpoint_url}</span>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isConnecting}
            onClick={(e) => {
              e.stopPropagation();
              if (!isConnecting) void onExplore(key, target, true);
            }}
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-primary)]" />
                Connecting...
              </>
            ) : (
              <>
                Explore
                <ArrowRight className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              </>
            )}
          </Button>
        </div>

        {conn.description && (
          <p className="mt-2 line-clamp-2 text-xs text-[var(--text-muted)]">
            {conn.description}
          </p>
        )}

        {itemTags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {itemTags.map((t) => (
              <span
                key={t.id}
                style={{ "--pill-color": t.color } as React.CSSProperties}
                className="tag-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                <span>{t.name}</span>
              </span>
            ))}
          </div>
        )}

        {connectionError && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-2.5 flex items-start gap-2 rounded-lg border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-2.5 py-2 text-[11px] text-[var(--status-error)]"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{connectionError}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearConnectionError(key);
              }}
              aria-label="Dismiss connection error"
              className="shrink-0 rounded p-0.5 opacity-75 hover:opacity-100 cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
        <span className="text-[11px] text-[var(--text-muted)]">
          External vector endpoint
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Edit Remote Connection"
            onClick={(e) => {
              e.stopPropagation();
              openRemoteModal(conn);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Delete Remote Connection"
            onClick={(e) => void handleDelete(e)}
          >
            <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ExplorerHome({
  onOpenConnection,
  connectingKey = null,
}: {
  onOpenConnection: (
    key: string,
    target: ConnectionTarget,
    ready: boolean,
  ) => void | Promise<void>;
  connectingKey?: string | null;
}) {
  const instances = useRuntimeStore((s) => s.instances);
  const groups = useRuntimeStore((s) => s.groups);
  const tags = useRuntimeStore((s) => s.tags);
  const metrics = useRuntimeStore((s) => s.metrics);
  const searchFilter = useRuntimeStore((s) => s.searchFilter);
  const setSearchFilter = useRuntimeStore((s) => s.setSearchFilter);
  const selectedTagIds = useRuntimeStore((s) => s.selectedTagIds);
  const toggleTagFilter = useRuntimeStore((s) => s.toggleTagFilter);
  const clearTagFilters = useRuntimeStore((s) => s.clearTagFilters);
  const statusFilter = useRuntimeStore((s) => s.statusFilter);
  const setStatusFilter = useRuntimeStore((s) => s.setStatusFilter);
  const openCreateInstanceModal = useRuntimeStore(
    (s) => s.openCreateInstanceModal,
  );
  const refreshGroupsAndTags = useRuntimeStore((s) => s.refreshGroupsAndTags);

  const remoteConnections = useTabsStore((s) => s.remoteConnections);
  const openRemoteModal = useTabsStore((s) => s.openRemoteModal);

  const [groupModalOpen, setGroupModalOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] =
    React.useState<ConnectionGroup | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = React.useState(false);
  const [ungroupedCollapsed, setUngroupedCollapsed] = React.useState(false);

  const query = searchFilter.trim().toLowerCase();
  const filteredInstances =
    statusFilter === "remote"
      ? []
      : instances.filter((inst) => {
          if (query) {
            const hay =
              `${inst.name} ${inst.engine_type} ${inst.port} ${inst.description ?? ""}`.toLowerCase();
            if (!hay.includes(query)) return false;
          }
          if (selectedTagIds.length > 0) {
            if (!selectedTagIds.every((tid) => inst.tag_ids.includes(tid))) {
              return false;
            }
          }
          const st = metrics[inst.id]?.status ?? "stopped";
          if (
            statusFilter === "running" &&
            st !== "running" &&
            st !== "embedded"
          ) {
            return false;
          }
          if (statusFilter === "stopped" && st === "running") {
            return false;
          }
          return true;
        });

  const filteredRemotes =
    statusFilter === "running" || statusFilter === "stopped"
      ? []
      : remoteConnections.filter((conn) => {
          if (query) {
            const hay =
              `${conn.name} ${conn.engine_type} ${conn.endpoint_url} ${conn.description ?? ""}`.toLowerCase();
            if (!hay.includes(query)) return false;
          }
          if (selectedTagIds.length > 0) {
            if (!selectedTagIds.every((tid) => conn.tag_ids.includes(tid))) {
              return false;
            }
          }
          return true;
        });

  const handleToggleCollapse = async (group: ConnectionGroup) => {
    try {
      await updateGroup(group.id, { is_collapsed: !group.is_collapsed });
      await refreshGroupsAndTags();
    } catch (err: unknown) {
      toast.error(
        "Failed to toggle group",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleDeleteGroup = async (group: ConnectionGroup) => {
    try {
      await deleteGroup(group.id);
      await refreshGroupsAndTags();
      toast.info(`Deleted group "${group.name}"`);
    } catch (err: unknown) {
      toast.error(
        "Failed to delete group",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleGroupStartAll = async (group: ConnectionGroup) => {
    try {
      const results = await startGroupInstances(group.id);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount === results.length) {
        toast.success(`Started ${okCount} instance(s) in "${group.name}"`);
      } else {
        toast.error(
          `Started ${okCount}/${results.length} in "${group.name}"`,
          results.find((r) => !r.ok)?.error ?? undefined,
        );
      }
    } catch (err: unknown) {
      toast.error(
        "Group start failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleGroupStopAll = async (group: ConnectionGroup) => {
    try {
      const results = await stopGroupInstances(group.id);
      toast.info(`Stopped ${results.length} instance(s) in "${group.name}"`);
    } catch (err: unknown) {
      toast.error(
        "Group stop failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const ungroupedLocal = filteredInstances.filter((i) => !i.group_id);
  const ungroupedRemote = filteredRemotes.filter((r) => !r.group_id);
  const ungroupedCount = ungroupedLocal.length + ungroupedRemote.length;
  const totalCount = instances.length + remoteConnections.length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <PageHeader
          icon={
            <Database className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
          }
          title="Vector Explorer"
          badges={
            <span className="inline-flex h-5 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] leading-none text-[var(--text-secondary)]">
              {totalCount}
            </span>
          }
          description="Select a local instance or remote database to browse collections, inspect vectors, and run semantic queries."
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingGroup(null);
                  setGroupModalOpen(true);
                }}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New Group
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openRemoteModal()}
              >
                <Globe className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
                Remote
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

        {/* Unified Compact Filter Toolbar + Inline Tag Strip */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 transition-colors focus-within:border-[var(--border-strong)]">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter connections by name, engine, port, endpoint..."
                className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />
              {searchFilter && (
                <button
                  type="button"
                  onClick={() => setSearchFilter("")}
                  aria-label="Clear filter"
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex h-8 items-center gap-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5">
              {STATUS_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setStatusFilter(chip.id)}
                  className={cn(
                    "inline-flex h-6 items-center rounded-md px-2.5 text-[11px] font-medium leading-none transition-colors cursor-pointer",
                    statusFilter === chip.id
                      ? "bg-[var(--bg-elevated)] text-[var(--accent-primary)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTagManagerOpen(true)}
            >
              <TagIcon className="h-3 w-3" />
              Manage Tags
            </Button>
          </div>

          {tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider leading-none text-[var(--text-muted)]">
                <TagIcon className="h-3 w-3" />
                Tags
              </span>
              {tags.map((tag) => {
                const active = selectedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTagFilter(tag.id)}
                    style={{ "--pill-color": tag.color } as React.CSSProperties}
                    className={cn(
                      "tag-pill inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium leading-none transition-all cursor-pointer",
                      active
                        ? "ring-1 ring-[var(--text-primary)] opacity-100"
                        : "opacity-75 hover:opacity-100",
                    )}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span>{tag.name}</span>
                  </button>
                );
              })}
              {selectedTagIds.length > 0 && (
                <button
                  type="button"
                  onClick={clearTagFilters}
                  className="ml-1 inline-flex items-center gap-0.5 font-mono text-[10px] leading-none text-[var(--accent-secondary)] hover:underline cursor-pointer"
                >
                  <X className="h-2.5 w-2.5" />
                  Clear ({selectedTagIds.length})
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setTagManagerOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] leading-none text-[var(--text-muted)] transition-colors hover:text-[var(--accent-primary)] cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                Create Tag
              </button>
            </div>
          )}
        </div>

        {/* Grouped & Ungrouped Connections */}
        {(groups.length > 0 || ungroupedCount > 0) && (
          <div className="space-y-6">
            {groups.map((group) => {
              const groupInstances = filteredInstances.filter(
                (i) => i.group_id === group.id,
              );
              const groupRemotes = filteredRemotes.filter(
                (r) => r.group_id === group.id,
              );
              const groupCount = groupInstances.length + groupRemotes.length;

              return (
                <section key={group.id} className="group/grp space-y-2.5">
                  <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggleCollapse(group)}
                      aria-expanded={!group.is_collapsed}
                      className="flex min-w-0 items-center gap-2 rounded-md py-1 pr-1.5 text-left cursor-pointer"
                    >
                      {group.is_collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                      )}
                      <GroupIcon iconName={group.icon} color={group.color} />
                      <span className="truncate text-xs font-semibold leading-none text-[var(--text-primary)]">
                        {group.name}
                      </span>
                      <span className="inline-flex h-4 min-w-[20px] items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 font-mono text-[10px] leading-none text-[var(--text-muted)]">
                        {groupCount}
                      </span>
                    </button>

                    <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-hover/grp:opacity-100 focus-within:opacity-100">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Start All Local in Group"
                        onClick={() => void handleGroupStartAll(group)}
                      >
                        <Play className="h-3 w-3 fill-current text-[var(--status-running)]" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Stop All Local in Group"
                        onClick={() => void handleGroupStopAll(group)}
                      >
                        <Square className="h-3 w-3 fill-current text-[var(--status-error)]" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Edit Group"
                        onClick={() => {
                          setEditingGroup(group);
                          setGroupModalOpen(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Delete Group"
                        onClick={() => void handleDeleteGroup(group)}
                      >
                        <Trash2 className="h-3 w-3 text-[var(--status-error)]" />
                      </Button>
                    </div>
                  </div>

                  {!group.is_collapsed &&
                    (groupCount === 0 ? (
                      <p className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-3 text-xs text-[var(--text-muted)]">
                        No matching connections in this group.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {groupInstances.map((inst) => (
                          <LocalConnectionCard
                            key={inst.id}
                            instance={inst}
                            onExplore={onOpenConnection}
                          />
                        ))}
                        {groupRemotes.map((conn) => (
                          <RemoteConnectionCard
                            key={conn.id}
                            conn={conn}
                            onExplore={onOpenConnection}
                            isConnecting={connectingKey === `remote:${conn.id}`}
                          />
                        ))}
                      </div>
                    ))}
                </section>
              );
            })}

            {/* Ungrouped Connections (Unified without redundant Local/Remote split) */}
            {ungroupedCount > 0 && (
              <section className="space-y-2.5">
                {groups.length > 0 && (
                  <div className="flex min-h-7 items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setUngroupedCollapsed((prev) => !prev)}
                      aria-expanded={!ungroupedCollapsed}
                      className="flex min-w-0 items-center gap-2 rounded-md py-1 pr-1.5 text-left cursor-pointer"
                    >
                      {ungroupedCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                      )}
                      <Inbox className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                      <span className="truncate text-xs font-semibold leading-none text-[var(--text-secondary)]">
                        Ungrouped
                      </span>
                      <span className="inline-flex h-4 min-w-[20px] items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 font-mono text-[10px] leading-none text-[var(--text-muted)]">
                        {ungroupedCount}
                      </span>
                    </button>
                  </div>
                )}
                {(groups.length === 0 || !ungroupedCollapsed) && (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {ungroupedLocal.map((inst) => (
                      <LocalConnectionCard
                        key={inst.id}
                        instance={inst}
                        onExplore={onOpenConnection}
                      />
                    ))}
                    {ungroupedRemote.map((conn) => (
                      <RemoteConnectionCard
                        key={conn.id}
                        conn={conn}
                        onExplore={onOpenConnection}
                        isConnecting={connectingKey === `remote:${conn.id}`}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {filteredInstances.length === 0 && filteredRemotes.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-12 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--accent-primary)]">
              <Database className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              No Matching Connections
            </h2>
            <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
              Create a local vector database instance, add a remote connection, or adjust your active filters.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openRemoteModal()}
              >
                <Globe className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
                Add Remote Connection
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => openCreateInstanceModal()}
              >
                <Plus className="h-3.5 w-3.5" />
                Create Local Instance
              </Button>
            </div>
          </div>
        )}
      </div>

      <GroupModal
        open={groupModalOpen}
        onOpenChange={setGroupModalOpen}
        editingGroup={editingGroup}
      />
      <TagManagerModal open={tagManagerOpen} onOpenChange={setTagManagerOpen} />
    </div>
  );
}
