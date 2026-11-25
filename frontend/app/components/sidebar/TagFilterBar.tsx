import * as React from "react";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import { TagManagerModal } from "@/components/sidebar/TagManagerModal";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";

export function TagFilterBar() {
  const tags = useRuntimeStore((s) => s.tags);
  const selectedTagIds = useRuntimeStore((s) => s.selectedTagIds);
  const toggleTagFilter = useRuntimeStore((s) => s.toggleTagFilter);
  const clearTagFilters = useRuntimeStore((s) => s.clearTagFilters);
  const [managerOpen, setManagerOpen] = React.useState(false);

  return (
    <div className="border-b border-[var(--border-subtle)] px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <span className="flex items-center gap-1">
          <TagIcon className="h-3 w-3" />
          Tags
        </span>
        <div className="flex items-center gap-1.5">
          {selectedTagIds.length > 0 && (
            <button
              type="button"
              onClick={clearTagFilters}
              className="inline-flex items-center gap-0.5 font-mono text-[10px] text-[var(--accent-secondary)] hover:underline cursor-pointer"
            >
              <X className="h-2.5 w-2.5" />
              {selectedTagIds.length} active
            </button>
          )}
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            title="Manage Tags"
            aria-label="Manage Tags"
            className="inline-flex h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      {tags.length === 0 ? (
        <button
          type="button"
          onClick={() => setManagerOpen(true)}
          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-primary)] cursor-pointer"
        >
          + Add tags to filter connections
        </button>
      ) : (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => {
            const active = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTagFilter(tag.id)}
                style={{ "--pill-color": tag.color } as React.CSSProperties}
                className={cn(
                  "tag-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all cursor-pointer",
                  active
                    ? "ring-1 ring-[var(--text-primary)] opacity-100"
                    : "opacity-75 hover:opacity-100",
                )}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

      <TagManagerModal open={managerOpen} onOpenChange={setManagerOpen} />
    </div>
  );
}
