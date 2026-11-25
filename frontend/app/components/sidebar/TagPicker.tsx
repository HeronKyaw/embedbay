import * as React from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { createTag } from "@/ipc/groupsTags";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { SWATCH_PRESETS } from "@/types/system";

export function TagPicker({
  selectedTagIds,
  onChange,
}: {
  selectedTagIds: string[];
  onChange: (next: string[]) => void;
}) {
  const tags = useRuntimeStore((s) => s.tags);
  const refreshGroupsAndTags = useRuntimeStore((s) => s.refreshGroupsAndTags);

  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState<string>(SWATCH_PRESETS[0].hex);
  const [busy, setBusy] = React.useState(false);

  const toggleTag = (id: string) => {
    onChange(
      selectedTagIds.includes(id)
        ? selectedTagIds.filter((t) => t !== id)
        : [...selectedTagIds, id],
    );
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await createTag(trimmed, color);
      await refreshGroupsAndTags();
      if (!selectedTagIds.includes(created.id)) {
        onChange([...selectedTagIds, created.id]);
      }
      setName("");
      setCreating(false);
      toast.success(`Created tag "${created.name}"`);
    } catch (err: unknown) {
      toast.error(
        "Failed to create tag",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-medium text-[var(--text-secondary)]">
          Tags
        </label>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-primary)] transition-colors hover:bg-[var(--bg-surface)] cursor-pointer"
          >
            <Plus className="h-3 w-3" />
            New Tag
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 && !creating ? (
          <span className="text-[11px] text-[var(--text-muted)]">
            No tags yet.
          </span>
        ) : (
          tags.map((t) => {
            const active = selectedTagIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTag(t.id)}
                style={{ "--pill-color": t.color } as React.CSSProperties}
                className={cn(
                  "tag-pill inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-none transition-all cursor-pointer",
                  active
                    ? "ring-1 ring-[var(--text-primary)] opacity-100"
                    : "opacity-60 hover:opacity-95",
                )}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                <span>{t.name}</span>
                {active && <Check className="h-2.5 w-2.5 shrink-0" />}
              </button>
            );
          })
        )}
      </div>

      {creating && (
        <div
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              void handleCreate();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setCreating(false);
              setName("");
            }
          }}
          className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5"
        >
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New tag name..."
              autoFocus
              className="h-7 min-w-0 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !name.trim()}
              onClick={() => void handleCreate()}
              className="h-7 px-2.5 text-[11px]"
            >
              Create
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cancel new tag"
              onClick={() => {
                setCreating(false);
                setName("");
              }}
              className="h-7 w-7"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {SWATCH_PRESETS.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                onClick={() => setColor(swatch.hex)}
                title={swatch.label}
                aria-label={`Select ${swatch.label} tag color`}
                className={cn(
                  "h-4 w-4 rounded-full border-2 transition-transform cursor-pointer",
                  color === swatch.hex
                    ? "scale-110 border-[var(--text-primary)]"
                    : "border-transparent opacity-75 hover:opacity-100",
                )}
                style={{ backgroundColor: swatch.hex }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
