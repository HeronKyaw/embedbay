import { Database, Logs, ScatterChart, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useTabsStore, type WorkspaceTabKind } from "@/stores/useTabsStore";

function TabIcon({ kind }: { kind: WorkspaceTabKind }) {
  switch (kind) {
    case "collection":
      return <Database className="h-3 w-3 text-[var(--accent-primary)]" />;
    case "search":
      return <Search className="h-3 w-3 text-[var(--accent-ai)]" />;
    case "visualizer":
      return <ScatterChart className="h-3 w-3 text-[var(--accent-secondary)]" />;
    case "logs":
      return <Logs className="h-3 w-3 text-[var(--status-starting)]" />;
  }
}

export function WorkspaceTabs() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setActiveTabId = useTabsStore((s) => s.setActiveTabId);
  const closeTab = useTabsStore((s) => s.closeTab);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Workspace Tabs"
      className="flex h-8 w-full shrink-0 items-end gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => {
              setActiveTabId(tab.id);
              setActiveSection("explorer");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveTabId(tab.id);
                setActiveSection("explorer");
              }
            }}
            className={cn(
              "group flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[11px] font-medium transition-colors cursor-pointer select-none",
              active
                ? "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                : "border-transparent bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]/60 hover:text-[var(--text-secondary)]",
            )}
          >
            <TabIcon kind={tab.kind} />
            <span className="truncate">{tab.title}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              aria-label={`Close ${tab.title}`}
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded opacity-60 hover:bg-[var(--bg-elevated)] hover:opacity-100 cursor-pointer"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
