import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
        accent:
          "border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]",
        ai: "border-[var(--accent-ai)]/40 bg-[var(--accent-ai)]/15 text-[var(--accent-ai)]",
        running:
          "border-[var(--status-running)]/40 bg-[var(--status-running)]/15 text-[var(--status-running)]",
        warning:
          "border-[var(--status-starting)]/40 bg-[var(--status-starting)]/15 text-[var(--status-starting)]",
        error:
          "border-[var(--status-error)]/40 bg-[var(--status-error)]/15 text-[var(--status-error)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
