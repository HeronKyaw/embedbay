import * as React from "react";
import { create } from "zustand";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { formatUserError } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type ToastKind = "success" | "error" | "info";

export interface ToastMessage {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastState {
  toasts: ToastMessage[];
  push: (toast: Omit<ToastMessage, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...toast, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4500);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "success", title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({
      kind: "error",
      title,
      description: description ? formatUserError(description) : undefined,
    }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "info", title, description }),
};

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const latestId = toasts[toasts.length - 1]?.id ?? null;

  React.useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    if (toasts.length > 0) {
      // Re-promote to the top of the browser Top Layer so toasts sit above open <dialog> modals.
      try {
        el.hidePopover();
      } catch {
        // Ignore if not currently open
      }
      try {
        el.showPopover();
      } catch {
        // Ignore if Popover API is unavailable
      }
    } else {
      try {
        el.hidePopover();
      } catch {
        // Ignore if already hidden
      }
    }
  }, [toasts.length, latestId]);

  return (
    <div
      ref={popoverRef}
      popover="manual"
      aria-live="polite"
      className="pointer-events-none fixed inset-auto right-4 bottom-4 z-[100] m-0 flex w-80 flex-col gap-2 overflow-visible border-0 bg-transparent p-0"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-[var(--bg-elevated)] p-3 text-xs shadow-xl",
            item.kind === "error"
              ? "border-[var(--status-error)]/50"
              : item.kind === "success"
                ? "border-[var(--status-running)]/50"
                : "border-[var(--border-strong)]",
          )}
        >
          {item.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-running)]" />
          ) : item.kind === "error" ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-secondary)]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[var(--text-primary)]">
              {item.title}
            </div>
            {item.description && (
              <div className="mt-0.5 line-clamp-3 break-words text-[11px] text-[var(--text-secondary)]">
                {item.description}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            aria-label="Dismiss notification"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
