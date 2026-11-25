import * as React from "react";
import {
  Database,
  Globe,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type { CollectionSummary, ConnectionTarget } from "@/types/explorer";

const EMPTY_COLLECTIONS: CollectionSummary[] = [];

function supportsCssAnchorPositioning(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("position-area: block-end span-inline-end") &&
    CSS.supports("anchor-name: --a")
  );
}

export function ExplorerFloatingSwitcher({
  open,
  onClose,
  anchorRef,
  connectionKey,
  connectionName,
  target,
  ready,
  connectingKey = null,
  onSwitchConnection,
  onCreateCollection,
  onRequestDeleteCollection,
  onStartCurrent,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  connectionKey: string | null;
  connectionName: string | null;
  target: ConnectionTarget | null;
  ready: boolean;
  connectingKey?: string | null;
  onSwitchConnection: (
    key: string,
    target: ConnectionTarget,
    ready: boolean,
  ) => void | Promise<void>;
  onCreateCollection: () => void;
  onRequestDeleteCollection: (collection: string) => void;
  onStartCurrent?: () => void;
}) {
  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const remoteConnections = useTabsStore((s) => s.remoteConnections);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const openCollectionTab = useTabsStore((s) => s.openCollectionTab);
  const refreshConnectionCollections = useTabsStore(
    (s) => s.refreshConnectionCollections,
  );

  const rawCollections = useTabsStore((s) =>
    connectionKey ? s.collectionsByConnection[connectionKey] : undefined,
  );
  const loading = useTabsStore((s) =>
    connectionKey ? Boolean(s.loadingConnections[connectionKey]) : false,
  );

  const [tab, setTab] = React.useState<"collections" | "connections">(
    connectionKey ? "collections" : "connections",
  );
  const [query, setQuery] = React.useState("");
  const [fallbackPos, setFallbackPos] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const onCloseRef = React.useRef(onClose);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!open) return;
    setTab(connectionKey ? "collections" : "connections");
    setQuery("");
  }, [open, connectionKey]);

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      const targetNode = e.target as Node;
      if (
        panelRef.current?.contains(targetNode) ||
        anchorRef.current?.contains(targetNode)
      ) {
        return;
      }
      onCloseRef.current();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, anchorRef]);

  React.useLayoutEffect(() => {
    if (!open || supportsCssAnchorPositioning()) {
      setFallbackPos(null);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const panelWidth = Math.min(340, window.innerWidth - 16);
      const gap = 6;
      const edge = 8;
      let left = rect.left;
      if (left + panelWidth > window.innerWidth - edge) {
        left = rect.right - panelWidth;
      }
      left = Math.max(edge, Math.min(left, window.innerWidth - panelWidth - edge));
      const top = Math.min(
        rect.bottom + gap,
        Math.max(edge, window.innerHeight - 120),
      );
      setFallbackPos({ top, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const observer =
      typeof ResizeObserver !== "undefined" && anchorRef.current
        ? new ResizeObserver(updatePosition)
        : null;
    if (observer && anchorRef.current) {
      observer.observe(anchorRef.current);
    }

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      observer?.disconnect();
    };
  }, [open, anchorRef]);

  if (!open) return null;

  const collections = rawCollections ?? EMPTY_COLLECTIONS;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const normalizedQuery = query.trim().toLowerCase();

  const filteredCollections = collections.filter((c) =>
    normalizedQuery ? c.name.toLowerCase().includes(normalizedQuery) : true,
  );

  const filteredLocal = instances.filter((inst) =>
    normalizedQuery
      ? `${inst.name} ${inst.engine_type} ${inst.port}`
          .toLowerCase()
          .includes(normalizedQuery)
      : true,
  );
  const filteredRemote = remoteConnections.filter((conn) =>
    normalizedQuery
      ? `${conn.name} ${conn.engine_type} ${conn.endpoint_url}`
          .toLowerCase()
          .includes(normalizedQuery)
      : true,
  );

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Quick Switcher"
      style={
        fallbackPos
          ? { top: fallbackPos.top, left: fallbackPos.left }
          : undefined
      }
      className="explorer-switcher-panel fixed z-40 flex max-h-[70vh] w-[340px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
    >
      {/* Tabs + Close */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2">
        <div className="flex items-center gap-1">
          {connectionKey && (
            <button
              type="button"
              onClick={() => {
                setTab("collections");
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                tab === "collections"
                  ? "bg-[var(--bg-elevated)] text-[var(--accent-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
              )}
            >
              Collections ({collections.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setTab("connections");
            }}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
              tab === "connections"
                ? "bg-[var(--bg-elevated)] text-[var(--accent-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            Connections ({instances.length + remoteConnections.length})
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close switcher"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            tab === "collections"
              ? "Filter collections..."
              : "Switch to connection..."
          }
          autoFocus
          className="w-full bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
        />
        {tab === "collections" && connectionKey && target && ready && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void refreshConnectionCollections(connectionKey, target)}
              title="Refresh Collections"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <RefreshCw
                className={cn("h-3 w-3", loading && "animate-spin")}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onCreateCollection();
              }}
              title="New Collection"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--accent-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* List Body */}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {tab === "collections" && connectionKey && target ? (
          !ready ? (
            <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-center">
              <p className="text-xs text-[var(--text-secondary)]">
                {connectionName ?? "Instance"} is currently stopped.
              </p>
              {onStartCurrent && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartCurrent();
                  }}
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-[var(--status-running)]/40 bg-[var(--status-running)]/15 px-2.5 py-1 text-xs font-medium text-[var(--status-running)] hover:bg-[var(--status-running)]/25 cursor-pointer"
                >
                  <Play className="h-3 w-3 fill-current" />
                  Start Instance
                </button>
              )}
            </div>
          ) : filteredCollections.length === 0 ? (
            <div className="py-6 text-center text-xs text-[var(--text-muted)]">
              {loading ? "Loading collections..." : "No matching collections."}
            </div>
          ) : (
            filteredCollections.map((col) => {
              const active =
                activeTab?.connectionKey === connectionKey &&
                activeTab?.collection === col.name;
              return (
                <div
                  key={col.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    openCollectionTab(
                      connectionKey,
                      target,
                      col.name,
                      connectionName ?? "Connection",
                    );
                    onClose();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openCollectionTab(
                        connectionKey,
                        target,
                        col.name,
                        connectionName ?? "Connection",
                      );
                      onClose();
                    }
                  }}
                  className={cn(
                    "group flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors cursor-pointer",
                    active
                      ? "bg-[var(--accent-primary)]/15 text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Layers className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" />
                    <span className="truncate text-xs font-medium">
                      {col.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {(col.vector_count !== null || col.dimensions !== null) && (
                      <span className="font-mono text-[10px] leading-none text-[var(--text-muted)]">
                        {col.vector_count !== null
                          ? col.vector_count.toLocaleString()
                          : ""}
                        {col.vector_count !== null && col.dimensions !== null
                          ? "·"
                          : ""}
                        {col.dimensions !== null ? `${col.dimensions}d` : ""}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                        onRequestDeleteCollection(col.name);
                      }}
                      title={`Delete ${col.name}`}
                      className="inline-flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 text-[var(--text-muted)] hover:bg-[var(--status-error)]/15 hover:text-[var(--status-error)] cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )
        ) : (
          <div className="space-y-2">
            {filteredLocal.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Local Instances
                </div>
                {filteredLocal.map((inst) => {
                  const key = `local:${inst.id}`;
                  const st = metrics[inst.id]?.status ?? "stopped";
                  const instReady =
                    st === "running" ||
                    st === "embedded" ||
                    inst.engine_type === "lancedb";
                  const selected = connectionKey === key;
                  return (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => {
                        void onSwitchConnection(
                          key,
                          { kind: "local_instance", instance_id: inst.id },
                          instReady,
                        );
                        onClose();
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                        selected
                          ? "bg-[var(--accent-primary)]/15 text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            st === "running"
                              ? "bg-[var(--status-running)]"
                              : st === "embedded"
                                ? "bg-[var(--accent-secondary)]"
                                : "bg-[var(--status-stopped)]",
                          )}
                        />
                        <span className="truncate font-medium">{inst.name}</span>
                      </span>
                      <span className="font-mono text-[10px] leading-none uppercase text-[var(--text-muted)]">
                        {inst.engine_type}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {filteredRemote.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Remote Connections
                </div>
                {filteredRemote.map((conn) => {
                  const key = `remote:${conn.id}`;
                  const selected = connectionKey === key;
                  const isConnecting = connectingKey === key;
                  return (
                    <button
                      key={conn.id}
                      type="button"
                      disabled={isConnecting}
                      onClick={() => {
                        void onSwitchConnection(
                          key,
                          { kind: "remote_connection", connection_id: conn.id },
                          true,
                        );
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer disabled:opacity-70",
                        selected
                          ? "bg-[var(--accent-primary)]/15 text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {isConnecting ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--accent-primary)]" />
                        ) : (
                          <Globe className="h-3 w-3 shrink-0 text-[var(--accent-secondary)]" />
                        )}
                        <span className="truncate font-medium">{conn.name}</span>
                      </span>
                      <span className="font-mono text-[10px] leading-none uppercase text-[var(--text-muted)]">
                        {isConnecting ? "connecting..." : conn.engine_type}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {filteredLocal.length === 0 && filteredRemote.length === 0 && (
              <div className="flex flex-col items-center py-6 text-center text-xs text-[var(--text-muted)]">
                <Database className="mb-1.5 h-4 w-4" />
                No matching connections.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
