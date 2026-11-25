import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  maxWidthClass = "w-[540px]",
  children,
}: DialogProps) {
  const ref = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => onOpenChange(false)}
      onCancel={(e) => {
        e.preventDefault();
        onOpenChange(false);
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) {
          onOpenChange(false);
        }
      }}
      className="rounded-xl shadow-2xl"
    >
      {open && (
        <div
          className={cn(
            "flex max-h-[88vh] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-primary)] shadow-2xl",
            maxWidthClass,
          )}
        >
          <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {icon}
                <h2 className="text-base font-semibold leading-tight tracking-tight text-[var(--text-primary)]">
                  {title}
                </h2>
              </div>
              {description && (
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close modal"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-5 pt-1">
            {children}
          </div>
        </div>
      )}
    </dialog>
  );
}
