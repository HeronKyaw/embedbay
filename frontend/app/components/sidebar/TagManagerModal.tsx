import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { createTag, deleteTag, updateTag } from "@/ipc/groupsTags";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { SWATCH_PRESETS } from "@/types/system";

export function TagManagerModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tags = useRuntimeStore((s) => s.tags);
  const refreshGroupsAndTags = useRuntimeStore((s) => s.refreshGroupsAndTags);

  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState<string>(SWATCH_PRESETS[0].hex);
  const [busy, setBusy] = React.useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createTag(name.trim(), color);
      setName("");
      await refreshGroupsAndTags();
      toast.success("Tag created");
    } catch (err: unknown) {
      toast.error(
        "Failed to create tag",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string, tagName: string) => {
    try {
      await deleteTag(id);
      await refreshGroupsAndTags();
      toast.info(`Deleted tag "${tagName}"`);
    } catch (err: unknown) {
      toast.error(
        "Failed to delete tag",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleCycleColor = async (id: string, currentColor: string) => {
    const idx = SWATCH_PRESETS.findIndex(
      (s) => s.hex.toLowerCase() === currentColor.toLowerCase(),
    );
    const next = SWATCH_PRESETS[(idx + 1) % SWATCH_PRESETS.length].hex;
    try {
      await updateTag(id, undefined, next);
      await refreshGroupsAndTags();
    } catch (err: unknown) {
      toast.error(
        "Failed to update tag",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Manage Tags"
      description="Create reusable color-coded tags to organize local runtimes and remote connections."
      maxWidthClass="w-[460px]"
    >
      <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tag name (e.g. local, prod, openai-1536)"
            className="h-8 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-[var(--text-secondary)]">
            Swatch:
          </span>
          {SWATCH_PRESETS.map((swatch) => (
            <button
              key={swatch.id}
              type="button"
              onClick={() => setColor(swatch.hex)}
              title={swatch.label}
              aria-label={`Select ${swatch.label} color`}
              className={cn(
                "h-5 w-5 rounded-full border-2 transition-transform cursor-pointer",
                color === swatch.hex
                  ? "scale-110 border-[var(--text-primary)]"
                  : "border-transparent opacity-80 hover:opacity-100",
              )}
              style={{ backgroundColor: swatch.hex }}
            />
          ))}
        </div>
      </form>

      <div className="mt-5 space-y-1.5 border-t border-[var(--border-subtle)] pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Existing Tags ({tags.length})
        </div>
        {tags.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--text-muted)]">
            No tags created yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5"
              >
                <span
                  style={{ "--pill-color": tag.color } as React.CSSProperties}
                  className="tag-pill inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleCycleColor(tag.id, tag.color)}
                    title="Cycle Swatch Color"
                    className="h-4 w-4 rounded-full border border-[var(--border-strong)] cursor-pointer"
                    style={{ backgroundColor: tag.color }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleDelete(tag.id, tag.name)}
                    aria-label={`Delete tag ${tag.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
