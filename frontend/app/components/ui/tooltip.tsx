import * as React from "react";
import { cn } from "@/lib/utils";

interface TooltipContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  id: string;
}

const TooltipContext = React.createContext<TooltipContextValue | null>(null);

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();

  return (
    <TooltipContext.Provider value={{ open, setOpen, id }}>
      <div
        className="relative inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </div>
    </TooltipContext.Provider>
  );
}

export function TooltipTrigger({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = React.useContext(TooltipContext);
  return (
    <div
      aria-describedby={ctx?.open ? ctx.id : undefined}
      className={cn("inline-flex", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function TooltipContent({
  children,
  side = "right",
  className,
}: {
  children: React.ReactNode;
  side?: "right" | "bottom" | "top" | "left";
  className?: string;
}) {
  const ctx = React.useContext(TooltipContext);
  if (!ctx?.open) return null;

  const sideClasses: Record<"right" | "bottom" | "top" | "left", string> = {
    right: "left-full top-1/2 ml-2 -translate-y-1/2",
    left: "right-full top-1/2 mr-2 -translate-y-1/2",
    top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  };

  return (
    <div
      id={ctx.id}
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] shadow-lg",
        sideClasses[side],
        className,
      )}
    >
      {children}
    </div>
  );
}
