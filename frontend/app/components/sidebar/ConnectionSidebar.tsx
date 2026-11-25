import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Globe,
  Pencil,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { ConnectionItem } from "@/components/sidebar/ConnectionItem";
import { GroupIcon, GroupModal } from "@/components/sidebar/GroupModal";
import { TagFilterBar } from "@/components/sidebar/TagFilterBar";
import { toast } from "@/components/ui/toast";
import { deleteRemoteConnection } from "@/ipc/connections";
import { deleteGroup, updateGroup } from "@/ipc/groupsTags";
import { startGroupInstances, stopGroupInstances } from "@/ipc/instances";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import {
  type SidebarStatusFilter,
  useRuntimeStore,
} from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type { RemoteConnection } from "@/types/explorer";
import type { ConnectionGroup, Tag } from "@/types/runtime";

const STATUS_CHIPS: readonly { id: SidebarStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "stopped", label: "Stopped" },
  { id: "remote", label: "Remote" },
];

function RemoteConnectionRow({
  conn,
  tags,
  onSelect,
}: {
  conn: RemoteConnection;
  tags: Tag[];
  onSelect?: () => void;
}) {
  const selectedConnectionKey = useRuntimeStore((s) => s.selectedConnectionKey);
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const openRemoteModal = useTabsStore((s) => s.openRemoteModal);
  const refreshConnectionsAndProfiles = useTabsStore(
    (s) => s.refreshConnectionsAndProfiles,
  );

  const key = `remote:${conn.id}`;
  const selected = selectedConnectionKey === key;
  const itemTags = tags.filter((t) => conn.tag_ids.includes(t.id));

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteRemoteConnection(conn.id);
      if (selected) setSelectedConnectionKey(null);
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
        conn.color
          ? { borderLeftColor: conn.color, borderLeftWidth: "3px" }
          : undefined
      }
      className={cn(
        "group relative flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors cursor-pointer select-none",
        selected
          ? "border-[var(--accent-primary)]/60 bg-[var(--bg-elevated)]"
          : "border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]/70",
      )}
    >
      <Globe
        className="h-3 w-3 shrink-0"
        style={{ color: conn.color ?? "var(--accent-secondary)" }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-xs font-medium text-[var(--text-primary)]">
            {conn.name}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className="uppercase">{conn.engine_type}</span>
          <span>· remote</span>
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

      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openRemoteModal(conn);
          }}
          title="Edit Remote Connection"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => void handleDelete(e)}
          title="Delete Remote Connection"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--status-error)]/15 hover:text-[var(--status-error)] cursor-pointer"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function ConnectionSidebar({
  onSelectConnection,
}: {
  onSelectConnection?: () => void;
}) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const instances = useRuntimeStore((s) => s.instances);
  const groups = useRuntimeStore((s) => s.groups);
  const tags = useRuntimeStore((s) => s.tags);
  const metrics = useRuntimeStore((s) => s.metrics);
  const searchFilter = useRuntimeStore((s) => s.searchFilter);
  const setSearchFilter = useRuntimeStore((s) => s.setSearchFilter);
  const selectedTagIds = useRuntimeStore((s) => s.selectedTagIds);
  const statusFilter = useRuntimeStore((s) => s.statusFilter);
  const setStatusFilter = useRuntimeStore((s) => s.setStatusFilter);
  const openCreateInstanceModal = useRuntimeStore(
    (s) => s.openCreateInstanceModal,
  );
  const refreshGroupsAndTags = useRuntimeStore((s) => s.refreshGroupsAndTags);

  const remoteConnections = useTabsStore((s) => s.remoteConnections);
  const openRemoteModal = useTabsStore((s) => s.openRemoteModal);

  const [width, setWidth] = React.useState(260);
  const [groupModalOpen, setGroupModalOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] =
    React.useState<ConnectionGroup | null>(null);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(
        400,
        Math.max(220, startWidth + moveEvent.clientX - startX),
      );
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (!sidebarOpen) return null;

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

  return (
    <aside
      aria-label="Connections Sidebar"
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      {/* Top Search & Status Filter */}
      <div className="space-y-2 border-b border-[var(--border-subtle)] p-2.5">
        <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter connections..."
            className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setStatusFilter(chip.id)}
              className={cn(
                "flex-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer",
                statusFilter === chip.id
                  ? "border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
                  : "border-transparent text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tag Filter Pills */}
      <TagFilterBar />

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <span>Connections</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setEditingGroup(null);
              setGroupModalOpen(true);
            }}
            title="New Group"
            aria-label="New Group"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => openRemoteModal()}
            title="Add Remote Connection"
            aria-label="Add Remote Connection"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--accent-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            <Globe className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => openCreateInstanceModal()}
            title="New Local Instance"
            aria-label="New Local Instance"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--accent-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Collapsible Groups & Connections Tree */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {groups.map((group) => {
          const groupInstances = filteredInstances.filter(
            (i) => i.group_id === group.id,
          );
          const groupRemotes = filteredRemotes.filter(
            (r) => r.group_id === group.id,
          );
          const totalInGroup = groupInstances.length + groupRemotes.length;
          return (
            <div
              key={group.id}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60"
            >
              <div className="group/hdr flex items-center gap-1.5 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => void handleToggleCollapse(group)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer"
                >
                  {group.is_collapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                  )}
                  <GroupIcon iconName={group.icon} color={group.color} />
                  <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">
                    {group.name}
                  </span>
                  <span className="ml-1 font-mono text-[10px] text-[var(--text-muted)]">
                    {totalInGroup}
                  </span>
                </button>

                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/hdr:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => void handleGroupStartAll(group)}
                    title="Start All Local in Group"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--status-running)] hover:bg-[var(--status-running)]/15 cursor-pointer"
                  >
                    <Play className="h-2.5 w-2.5 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleGroupStopAll(group)}
                    title="Stop All Local in Group"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--status-error)] hover:bg-[var(--status-error)]/15 cursor-pointer"
                  >
                    <Square className="h-2.5 w-2.5 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingGroup(group);
                      setGroupModalOpen(true);
                    }}
                    title="Edit Group"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteGroup(group)}
                    title="Delete Group"
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--status-error)]/15 hover:text-[var(--status-error)] cursor-pointer"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>

              {!group.is_collapsed && (
                <div className="space-y-0.5 border-t border-[var(--border-subtle)] p-1">
                  {totalInGroup === 0 ? (
                    <div className="px-2 py-1.5 text-[10px] text-[var(--text-muted)]">
                      No matching connections in group
                    </div>
                  ) : (
                    <>
                      {groupInstances.map((inst) => (
                        <ConnectionItem
                          key={inst.id}
                          instance={inst}
                          tags={tags}
                          onSelect={onSelectConnection}
                        />
                      ))}
                      {groupRemotes.map((conn) => (
                        <RemoteConnectionRow
                          key={conn.id}
                          conn={conn}
                          tags={tags}
                          onSelect={onSelectConnection}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {ungroupedLocal.length > 0 && (
          <div className="space-y-0.5">
            <div className="px-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Local Instances
            </div>
            {ungroupedLocal.map((inst) => (
              <ConnectionItem
                key={inst.id}
                instance={inst}
                tags={tags}
                onSelect={onSelectConnection}
              />
            ))}
          </div>
        )}

        {ungroupedRemote.length > 0 && (
          <div className="space-y-0.5">
            <div className="px-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Remote Connections
            </div>
            {ungroupedRemote.map((conn) => (
              <RemoteConnectionRow
                key={conn.id}
                conn={conn}
                tags={tags}
                onSelect={onSelectConnection}
              />
            ))}
          </div>
        )}

        {filteredInstances.length === 0 && filteredRemotes.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-center">
            <p className="text-[11px] font-medium text-[var(--text-secondary)]">
              No connections found
            </p>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              Create a local instance or add a remote vector DB connection.
            </p>
          </div>
        )}
      </div>

      {/* Drag Resize Handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={handleResizeStart}
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-[var(--accent-primary)]/50"
      />

      <GroupModal
        open={groupModalOpen}
        onOpenChange={setGroupModalOpen}
        editingGroup={editingGroup}
      />
    </aside>
  );
}
