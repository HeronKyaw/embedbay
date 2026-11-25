import { Badge } from "@/components/ui/badge";
import type { InstanceStatus } from "@/types/runtime";

export function InstanceStatusBadge({
  status,
  kind = "local",
  embeddedLabel = "Embedded",
}: {
  status: InstanceStatus;
  kind?: "local" | "remote";
  embeddedLabel?: string;
}) {
  if (kind === "remote") {
    return <Badge variant="accent">Remote</Badge>;
  }
  switch (status) {
    case "running":
      return (
        <Badge variant="running">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-running)]" />
          Running
        </Badge>
      );
    case "starting":
    case "stopping":
      return (
        <Badge variant="warning">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-starting)] animate-pulse" />
          {status === "starting" ? "Starting" : "Stopping"}
        </Badge>
      );
    case "error":
      return (
        <Badge variant="error">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-error)]" />
          Error
        </Badge>
      );
    case "embedded":
      return (
        <Badge variant="accent">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-secondary)]" />
          {embeddedLabel}
        </Badge>
      );
    default:
      return (
        <Badge variant="default">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-stopped)]" />
          Stopped
        </Badge>
      );
  }
}
