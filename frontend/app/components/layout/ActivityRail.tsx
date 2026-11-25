import * as React from "react";
import { Boxes, Database, PackagePlus, Settings } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatRamMb } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { ActivitySection } from "@/types/system";

interface RailItem {
  id: ActivitySection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const RAIL_ITEMS: readonly RailItem[] = [
  { id: "explorer", label: "Explorer", icon: Database },
  { id: "runtimes", label: "Local Runtimes", icon: Boxes },
  { id: "store", label: "Engine Store", icon: PackagePlus },
  { id: "settings", label: "Settings", icon: Settings },
];

export function ActivityRail() {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const totalRamBytes = useRuntimeStore((s) => s.totalRamBytes);
  const runningCount = useRuntimeStore((s) => s.runningCount);

  return (
    <aside
      aria-label="Activity Rail"
      className="flex h-full w-12 shrink-0 flex-col items-center justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] py-2.5 select-none"
    >
      <nav className="flex flex-col items-center gap-2">
        {RAIL_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger>
                <button
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer",
                    active
                      ? "bg-[var(--bg-elevated)] text-[var(--accent-primary)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]",
                  )}
                >
                  {active && (
                    <span className="absolute -left-1.5 h-5 w-[3px] rounded-r bg-[var(--accent-primary)]" />
                  )}
                  <Icon className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Bottom Total Local DB RAM Usage Badge */}
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            onClick={() => setActiveSection("runtimes")}
            className="flex flex-col items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1 py-1.5 text-center cursor-pointer hover:border-[var(--border-strong)]"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                runningCount > 0
                  ? "bg-[var(--status-running)]"
                  : "bg-[var(--status-stopped)]",
              )}
            />
            <span className="font-mono text-[9px] font-medium leading-none text-[var(--text-secondary)]">
              {formatRamMb(totalRamBytes)}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Total Local DB RAM Usage ({runningCount} active)
        </TooltipContent>
      </Tooltip>
    </aside>
  );
}
