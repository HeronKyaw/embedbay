import * as React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Copy,
  Minus,
  Moon,
  Search,
  Square,
  Sun,
  X,
} from "lucide-react";
import { EmbedBayLogo } from "@/components/layout/EmbedBayLogo";
import { isTauriRuntime } from "@/ipc/system";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import type { ActivitySection } from "@/types/system";

const SECTION_TAB_LABELS: Record<ActivitySection, string> = {
  explorer: "Vector Explorer",
  runtimes: "Local Runtimes",
  store: "Engine Store",
};

export function AdaptiveTitlebar() {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const activeSection = useAppStore((s) => s.activeSection);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const appStatus = useAppStore((s) => s.appStatus);

  const [isMaximized, setIsMaximized] = React.useState(false);

  const isMac = appStatus?.platform.os === "macos";
  const shortcutLabel = isMac ? "⌘K" : "Ctrl+K";

  React.useEffect(() => {
    if (!isTauriRuntime()) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    void win.isMaximized().then(setIsMaximized).catch(() => {});
    void win
      .onResized(() => {
        void win.isMaximized().then(setIsMaximized).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, []);

  const handleMinimize = () => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().minimize();
  };

  const handleToggleMaximize = () => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().toggleMaximize();
  };

  const handleClose = () => {
    if (!isTauriRuntime()) return;
    void getCurrentWindow().close();
  };

  return (
    <header
      className={cn(
        "flex h-9 w-full shrink-0 select-none items-center border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs",
        isMac && "pl-[74px]",
      )}
    >
      {/* Left: Brand + Active Section Label */}
      <div
        data-tauri-drag-region
        className="flex h-full items-center gap-2 px-3"
      >
        <EmbedBayLogo size={16} />
        <span className="inline-flex items-baseline gap-1.5 leading-none">
          <span className="font-semibold tracking-tight text-[var(--text-primary)]">
            EmbedBay
          </span>
          <span className="text-[var(--border-strong)]">/</span>
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            {SECTION_TAB_LABELS[activeSection]}
          </span>
        </span>
      </div>

      {/* Center Drag Spacer + Ctrl+K Quick Search Trigger */}
      <div
        data-tauri-drag-region
        className="flex h-full flex-1 items-center justify-center px-3"
      >
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="flex h-6 w-full max-w-[300px] items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)] cursor-pointer"
        >
          <Search className="h-3 w-3 shrink-0" />
          <span className="truncate">Search commands, instances, tags...</span>
          <kbd className="ml-auto rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--text-secondary)]">
            {shortcutLabel}
          </kbd>
        </button>
      </div>

      {/* Right: Theme Switcher + Native-style Window Controls */}
      <div className="flex h-full items-center">
        <button
          type="button"
          onClick={toggleTheme}
          title={
            theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
          }
          aria-label={
            theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
          }
          className="mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </button>

        {!isMac && (
          <div className="flex h-full items-center border-l border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={handleMinimize}
              title="Minimize"
              aria-label="Minimize window"
              className="inline-flex h-full w-10 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleToggleMaximize}
              title={isMaximized ? "Restore" : "Maximize"}
              aria-label={isMaximized ? "Restore window" : "Maximize window"}
              className="inline-flex h-full w-10 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {isMaximized ? (
                <Copy className="h-3 w-3" />
              ) : (
                <Square className="h-3 w-3" />
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              title="Close to System Tray"
              aria-label="Close window to System Tray"
              className="inline-flex h-full w-10 items-center justify-center text-[var(--text-secondary)] transition-colors hover:bg-[var(--status-error)] hover:text-white cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
