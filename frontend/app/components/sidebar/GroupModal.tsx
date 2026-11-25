import * as React from "react";
import {
  Briefcase,
  Cpu,
  Database,
  FlaskConical,
  Folder,
  Globe,
  Layers,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { createGroup, updateGroup } from "@/ipc/groupsTags";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { ConnectionGroup } from "@/types/runtime";
import { SWATCH_PRESETS } from "@/types/system";

const GROUP_ICONS = [
  { id: "Folder", Icon: Folder },
  { id: "Briefcase", Icon: Briefcase },
  { id: "FlaskConical", Icon: FlaskConical },
  { id: "Database", Icon: Database },
  { id: "Server", Icon: Server },
  { id: "Layers", Icon: Layers },
  { id: "Cpu", Icon: Cpu },
  { id: "Globe", Icon: Globe },
] as const;

export function GroupIcon({
  iconName,
  color,
  className,
}: {
  iconName: string | null | undefined;
  color?: string | null;
  className?: string;
}) {
  const found = GROUP_ICONS.find((g) => g.id === iconName) ?? GROUP_ICONS[0];
  const Icon = found.Icon;
  return (
    <Icon
      className={cn("h-3.5 w-3.5 shrink-0", className)}
      style={color ? { color } : undefined}
    />
  );
}

export function GroupModal({
  open,
  onOpenChange,
  editingGroup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingGroup: ConnectionGroup | null;
}) {
  const refreshGroupsAndTags = useRuntimeStore((s) => s.refreshGroupsAndTags);

  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState<string>(SWATCH_PRESETS[0].hex);
  const [icon, setIcon] = React.useState<string>("Folder");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (editingGroup) {
      setName(editingGroup.name);
      setColor(editingGroup.color ?? SWATCH_PRESETS[0].hex);
      setIcon(editingGroup.icon ?? "Folder");
    } else {
      setName("");
      setColor(SWATCH_PRESETS[0].hex);
      setIcon("Folder");
    }
  }, [open, editingGroup]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (editingGroup) {
        await updateGroup(editingGroup.id, {
          name: name.trim(),
          color,
          icon,
        });
        toast.success(`Updated group "${name.trim()}"`);
      } else {
        await createGroup({ name: name.trim(), color, icon });
        toast.success(`Created group "${name.trim()}"`);
      }
      await refreshGroupsAndTags();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(
        "Failed to save group",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editingGroup ? "Edit Group" : "Create Connection Group"}
      description="Group local instances and remote connections for bulk Start/Stop actions."
      maxWidthClass="w-[440px]"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Group Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Work RAG, Personal Experiments"
            autoFocus
            className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text-secondary)]">
            Accent Color
          </label>
          <div className="flex flex-wrap gap-2">
            {SWATCH_PRESETS.map((swatch) => (
              <button
                key={swatch.id}
                type="button"
                onClick={() => setColor(swatch.hex)}
                title={swatch.label}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition-transform cursor-pointer",
                  color === swatch.hex
                    ? "scale-110 border-[var(--text-primary)]"
                    : "border-transparent opacity-80 hover:opacity-100",
                )}
                style={{ backgroundColor: swatch.hex }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[var(--text-secondary)]">
            Group Icon
          </label>
          <div className="grid grid-cols-8 gap-1.5">
            {GROUP_ICONS.map(({ id, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setIcon(id)}
                className={cn(
                  "flex h-8 items-center justify-center rounded-md border transition-colors cursor-pointer",
                  icon === id
                    ? "border-[var(--accent-primary)] bg-[var(--bg-surface)] text-[var(--accent-primary)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            {editingGroup ? "Save Changes" : "Create Group"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
