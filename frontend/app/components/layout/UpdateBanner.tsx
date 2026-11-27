import { DownloadCloud, RotateCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useAppStore } from "@/stores/useAppStore";
import { useUpdaterStore } from "@/stores/useUpdaterStore";

function extractReleaseSummary(markdown: string | null): string | null {
  if (!markdown) return null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^#{1,3}\s+/.test(line) || /^[-*_]{3,}$/.test(line)) {
      continue;
    }
    const cleaned = line
      .replace(/^[-*]\s+/, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim();
    if (cleaned) return cleaned;
  }
  return null;
}

export function UpdateBanner() {
  const openSettings = useAppStore((s) => s.openSettings);
  const availableUpdate = useUpdaterStore((s) => s.availableUpdate);
  const releaseNotes = useUpdaterStore((s) => s.releaseNotes);
  const phase = useUpdaterStore((s) => s.phase);
  const bannerDismissedVersion = useUpdaterStore(
    (s) => s.bannerDismissedVersion,
  );
  const downloadUpdate = useUpdaterStore((s) => s.downloadUpdate);
  const installDownloadedUpdate = useUpdaterStore(
    (s) => s.installDownloadedUpdate,
  );
  const dismissBanner = useUpdaterStore((s) => s.dismissBanner);

  if (
    !availableUpdate ||
    (phase !== "available" && phase !== "ready") ||
    bannerDismissedVersion === availableUpdate.version
  ) {
    return null;
  }

  const isReady = phase === "ready";
  const summary = extractReleaseSummary(releaseNotes ?? availableUpdate.body ?? null);

  return (
    <div
      role="status"
      aria-label="Application Update Available"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--status-running)]/30 bg-[var(--status-running)]/10 px-4 py-1.5 text-xs"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--status-running)]" />
        <span className="shrink-0 font-semibold text-[var(--text-primary)]">
          {isReady
            ? `EmbedBay v${availableUpdate.version} is ready to install`
            : `EmbedBay v${availableUpdate.version} is available`}
        </span>
        {summary && (
          <span className="hidden md:inline min-w-0 truncate text-[11px] text-[var(--text-secondary)]">
            — {summary}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={() => openSettings("about")}
        >
          What&apos;s New
        </Button>

        <Button
          type="button"
          size="sm"
          className="h-6 px-2.5 text-[11px]"
          onClick={() => {
            if (isReady) {
              void installDownloadedUpdate();
            } else {
              toast.info(
                `Downloading EmbedBay v${availableUpdate.version}...`,
                "Track progress in the bottom Status Bar.",
              );
              void downloadUpdate();
            }
          }}
        >
          {isReady ? (
            <>
              <RotateCw className="h-3 w-3" />
              Install &amp; Restart
            </>
          ) : (
            <>
              <DownloadCloud className="h-3 w-3" />
              Update Now
            </>
          )}
        </Button>

        <button
          type="button"
          onClick={() => dismissBanner()}
          aria-label="Dismiss update banner"
          title="Dismiss for this session"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
