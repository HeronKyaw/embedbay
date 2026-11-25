import * as React from "react";

export function PageHeader({
  icon,
  title,
  badges,
  description,
  actions,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  badges?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          {icon}
          <h1 className="text-lg font-semibold leading-none tracking-tight text-[var(--text-primary)]">
            {title}
          </h1>
          {badges}
        </div>
        {description && (
          <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
            {description}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
