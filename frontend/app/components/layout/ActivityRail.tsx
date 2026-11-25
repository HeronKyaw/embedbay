import * as React from "react";
import { Boxes, Database, PackagePlus, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type { ActivitySection } from "@/types/system";

interface MenuItem {
  id: ActivitySection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const MENU_ITEMS: readonly MenuItem[] = [
  { id: "explorer", label: "Explorer", icon: Database },
  { id: "runtimes", label: "Local Runtimes", icon: Boxes },
  { id: "store", label: "Engine Store", icon: PackagePlus },
];

export function ActivityRail() {
  const activeSection = useAppStore((s) => s.activeSection);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const appStatus = useAppStore((s) => s.appStatus);
  const instancesCount = useRuntimeStore((s) => s.instances.length);
  const runningCount = useRuntimeStore((s) => s.runningCount);
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const remoteCount = useTabsStore((s) => s.remoteConnections.length);
  const setActiveTabId = useTabsStore((s) => s.setActiveTabId);

  const totalConnections = instancesCount + remoteCount;
  const isMac = appStatus?.platform.os === "macos";
  const settingsShortcut = isMac ? "⌘," : "Ctrl+,";

  const handleItemClick = (id: ActivitySection) => {
    if (id === "explorer" && activeSection === "explorer") {
      setSelectedConnectionKey(null);
      setActiveTabId(null);
      return;
    }
    setActiveSection(id);
  };

  return (
    <aside
      aria-label="Primary Navigation"
      className="flex h-full w-48 shrink-0 flex-col justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-3 select-none"
    >
      <div className="space-y-1">
        <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Workspace
        </div>
        <nav className="flex flex-col gap-1">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleItemClick(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors cursor-pointer",
                  active
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text-primary)]",
                )}
              >
                {active && (
                  <span className="absolute left-0 h-4 w-[3px] rounded-r bg-[var(--accent-primary)]" />
                )}
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active
                        ? "text-[var(--accent-primary)]"
                        : "text-[var(--text-muted)]",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </span>

                {item.id === "explorer" && totalConnections > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--text-muted)]">
                    {totalConnections}
                  </span>
                )}

                {item.id === "runtimes" && runningCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-running)]/30 bg-[var(--status-running)]/15 px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--status-running)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-running)]" />
                    {runningCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-[var(--border-subtle)] pt-2.5">
        <button
          type="button"
          onClick={toggleSettings}
          aria-pressed={settingsOpen}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors cursor-pointer",
            settingsOpen
              ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/70 hover:text-[var(--text-primary)]",
          )}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Settings
              className={cn(
                "h-4 w-4 shrink-0",
                settingsOpen
                  ? "text-[var(--accent-primary)]"
                  : "text-[var(--text-muted)]",
              )}
            />
            <span className="truncate">Settings</span>
          </span>
          <span className="font-mono text-[10px] leading-none text-[var(--text-muted)]">
            {settingsShortcut}
          </span>
        </button>
      </div>
    </aside>
  );
}
