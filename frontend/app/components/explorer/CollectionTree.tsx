import { Layers, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CollectionSummary } from "@/types/explorer";

export function CollectionTree({
  connectionName,
  collections,
  activeCollection,
  loading,
  onSelectCollection,
  onRefresh,
  onCreateCollection,
  onDeleteCollection,
}: {
  connectionName: string;
  collections: CollectionSummary[];
  activeCollection: string | null;
  loading: boolean;
  onSelectCollection: (name: string) => void;
  onRefresh: () => void;
  onCreateCollection: () => void;
  onDeleteCollection: (name: string) => void;
}) {
  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
            {connectionName}
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">
            {collections.length} collection(s)
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Refresh Collections"
            onClick={onRefresh}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="New Collection"
            onClick={onCreateCollection}
          >
            <Plus className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {collections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-4 text-center">
            <p className="text-[11px] text-[var(--text-secondary)]">
              {loading ? "Loading collections..." : "No collections yet"}
            </p>
            {!loading && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2.5"
                onClick={onCreateCollection}
              >
                <Plus className="h-3 w-3" />
                Create Collection
              </Button>
            )}
          </div>
        ) : (
          collections.map((col) => {
            const active = activeCollection === col.name;
            return (
              <div
                key={col.name}
                role="button"
                tabIndex={0}
                onClick={() => onSelectCollection(col.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectCollection(col.name);
                  }
                }}
                className={cn(
                  "group flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors cursor-pointer",
                  active
                    ? "border-[var(--accent-primary)]/50 bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/60 hover:text-[var(--text-primary)]",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">
                      {col.name}
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--text-muted)]">
                      {col.vector_count !== null && (
                        <span>{col.vector_count.toLocaleString()} vecs</span>
                      )}
                      {col.dimensions !== null && (
                        <span>· {col.dimensions}d</span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteCollection(col.name);
                  }}
                  title="Delete Collection"
                  aria-label={`Delete ${col.name}`}
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--status-error)] cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
