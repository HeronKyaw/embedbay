import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      loop
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg bg-[var(--bg-elevated)] text-[var(--text-primary)]",
        className,
      )}
      {...props}
    />
  );
}

export interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function CommandDialog({
  open,
  onOpenChange,
  children,
}: CommandDialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[14vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl">
        <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--text-muted)]">
          {children}
          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-[10px] text-[var(--text-muted)]">
            <span>↑↓ Navigate · ↵ Select · Esc Close</span>
            <span className="font-mono">Ctrl+K</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5">
      <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      <CommandPrimitive.Input
        ref={inputRef}
        autoFocus
        className={cn(
          "flex h-11 w-full bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn("max-h-[320px] overflow-y-auto p-1.5", className)}
      {...props}
    />
  );
}

export function CommandEmpty(
  props: React.ComponentProps<typeof CommandPrimitive.Empty>,
) {
  return (
    <CommandPrimitive.Empty
      className="py-8 text-center text-xs text-[var(--text-muted)]"
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn("overflow-hidden py-1 text-[var(--text-primary)]", className)}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn("my-1 h-px bg-[var(--border-subtle)]", className)}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-[var(--text-secondary)] outline-none transition-colors data-[selected=true]:bg-[var(--accent-primary)]/15 data-[selected=true]:text-[var(--text-primary)] data-[selected=true]:ring-1 data-[selected=true]:ring-[var(--accent-primary)]/35 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function CommandShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "ml-auto font-mono text-[10px] tracking-wider text-[var(--text-muted)]",
        className,
      )}
      {...props}
    />
  );
}
