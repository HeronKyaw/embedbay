import * as React from "react";
import {
  Cpu,
  HardDrive,
  Info,
  Palette,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { EmbeddingProfilesPanel } from "@/components/search/EmbeddingProfilesPanel";
import { AboutUpdatesPanel } from "@/components/settings/AboutUpdatesPanel";
import { DiagnosticsPanel } from "@/components/settings/DiagnosticsPanel";
import { GeneralSettingsPanel } from "@/components/settings/GeneralSettingsPanel";
import { StoragePanel } from "@/components/settings/StoragePanel";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type { SettingsTabId } from "@/types/system";

interface SettingsCategoryMeta {
  id: SettingsTabId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SETTINGS_CATEGORIES: readonly SettingsCategoryMeta[] = [
  {
    id: "general",
    label: "General",
    description:
      "Theme appearance, workspace defaults, and OS startup behavior.",
    icon: Palette,
  },
  {
    id: "embeddings",
    label: "Embeddings",
    description:
      "Local and cloud text-to-vector models for semantic search and ingestion.",
    icon: Sparkles,
  },
  {
    id: "storage",
    label: "Storage",
    description:
      "Disk footprint across engine binaries, instance data, logs, and SQLite.",
    icon: HardDrive,
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    description:
      "System resources, local database health, credential store, and data paths.",
    icon: Cpu,
  },
  {
    id: "about",
    label: "About",
    description:
      "Application version, signed updates, and project resources.",
    icon: Info,
  },
];

export function SettingsModal() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const activeTab = useAppStore((s) => s.settingsTab);
  const setActiveTab = useAppStore((s) => s.setSettingsTab);
  const appStatus = useAppStore((s) => s.appStatus);
  const profileCount = useTabsStore((s) => s.embeddingProfiles.length);

  const dialogRef = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const activeCategory =
    SETTINGS_CATEGORIES.find((c) => c.id === activeTab) ??
    SETTINGS_CATEGORIES[0];
  const ActiveIcon = activeCategory.icon;

  return (
    <dialog
      ref={dialogRef}
      onClose={() => setOpen(false)}
      onCancel={(e) => {
        e.preventDefault();
        setOpen(false);
      }}
      onMouseDown={(e) => {
        if (e.target === dialogRef.current) {
          setOpen(false);
        }
      }}
      className="rounded-xl shadow-2xl"
    >
      {open && (
        <div className="flex h-[min(86vh,720px)] w-[min(94vw,980px)] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-primary)] shadow-2xl md:flex-row">
          {/* Left Navigation Rail */}
          <aside className="flex shrink-0 flex-col justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 md:w-[216px] md:border-r md:border-b-0">
            <div>
              <div className="mb-3 flex items-center justify-between px-2 pt-1">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-[var(--accent-primary)]" />
                  <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                    Settings
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close settings"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] md:hidden cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <nav
                role="tablist"
                aria-label="Settings Categories"
                className="flex flex-row gap-1 overflow-x-auto md:flex-col"
              >
                {SETTINGS_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const active = activeTab === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveTab(cat.id)}
                      className={cn(
                        "relative flex shrink-0 items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors cursor-pointer",
                        active
                          ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/60 hover:text-[var(--text-primary)]",
                      )}
                    >
                      {active && (
                        <span className="hidden md:block absolute left-0 h-4 w-[3px] rounded-r bg-[var(--accent-primary)]" />
                      )}
                      <span className="flex items-center gap-2.5">
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            active
                              ? "text-[var(--accent-primary)]"
                              : "text-[var(--text-muted)]",
                          )}
                        />
                        <span>{cat.label}</span>
                      </span>

                      {cat.id === "embeddings" && profileCount > 0 && (
                        <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--text-muted)]">
                          {profileCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="hidden border-t border-[var(--border-subtle)] px-2 pt-3 md:flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              <span>EmbedBay</span>
              <span className="font-mono">
                v{appStatus?.app_version ?? "0.1.0"}
              </span>
            </div>
          </aside>

          {/* Right Content Pane */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-6 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <ActiveIcon className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    {activeCategory.label}
                  </h2>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  {activeCategory.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close settings"
                className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] md:inline-flex cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {activeTab === "general" && <GeneralSettingsPanel />}
              {activeTab === "embeddings" && (
                <EmbeddingProfilesPanel variant="settings" />
              )}
              {activeTab === "storage" && <StoragePanel />}
              {activeTab === "diagnostics" && <DiagnosticsPanel />}
              {activeTab === "about" && <AboutUpdatesPanel />}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
