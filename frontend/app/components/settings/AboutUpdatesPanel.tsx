import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Compass,
  DownloadCloud,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { EmbedBayLogo } from "@/components/layout/EmbedBayLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { openExternalUrl } from "@/ipc/system";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/stores/useAppStore";
import { useUpdaterStore } from "@/stores/useUpdaterStore";

const PROJECT_LINKS = [
  {
    label: "GitHub Repository",
    subtitle: "Source code & architecture docs",
    url: "https://github.com/HeronKyaw/embedbay",
  },
  {
    label: "Releases & Changelog",
    subtitle: "Signed installers & version history",
    url: "https://github.com/HeronKyaw/embedbay/releases",
  },
  {
    label: "Report an Issue",
    subtitle: "Bugs, engine requests & feedback",
    url: "https://github.com/HeronKyaw/embedbay/issues",
  },
] as const;

const INLINE_TOKEN_RE =
  /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s)]+))/g;

function renderInlineMarkdown(
  text: string,
  onOpenLink: (url: string) => void,
  keyPrefix: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    const key = `${keyPrefix}-${matchIndex++}`;
    if (match[2] && match[3]) {
      const url = match[3];
      nodes.push(
        <button
          key={key}
          type="button"
          onClick={() => onOpenLink(url)}
          className="inline font-medium text-[var(--accent-primary)] underline decoration-[var(--accent-primary)]/40 underline-offset-2 transition-colors hover:text-[var(--accent-primary-hover)] cursor-pointer"
        >
          {match[2]}
        </button>,
      );
    } else if (match[4]) {
      nodes.push(
        <strong key={key} className="font-semibold text-[var(--text-primary)]">
          {match[4]}
        </strong>,
      );
    } else if (match[5]) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)]"
        >
          {match[5]}
        </code>,
      );
    } else if (match[6]) {
      const url = match[6];
      nodes.push(
        <button
          key={key}
          type="button"
          onClick={() => onOpenLink(url)}
          className="inline break-all font-medium text-[var(--accent-primary)] underline decoration-[var(--accent-primary)]/40 underline-offset-2 transition-colors hover:text-[var(--accent-primary-hover)] cursor-pointer"
        >
          {url}
        </button>,
      );
    }

    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function stripManualInstallerFooter(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return normalized;

  const cutPatterns = [
    /\n---\s*\n+#{1,3}\s*Windows Installers\b/i,
    /\n#{1,3}\s*Windows Installers\b/i,
    /\n---\s*\n+\*\*Integrity & Privacy:\*\*/i,
  ];

  let cutIndex = normalized.length;
  for (const re of cutPatterns) {
    const m = re.exec(normalized);
    if (m && m.index < cutIndex) {
      cutIndex = m.index;
    }
  }

  const trimmed = normalized.slice(0, cutIndex).trim();
  return trimmed.length > 0 ? trimmed : normalized;
}

export function ReleaseNotesContent({
  markdown,
  onOpenLink,
}: {
  markdown: string;
  onOpenLink: (url: string) => void;
}) {
  const lines = stripManualInstallerFooter(markdown).split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i++;
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push(
        <hr
          key={`hr-${blockKey++}`}
          className="my-2.5 border-t border-[var(--border-subtle)]"
        />,
      );
      i++;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const title = headingMatch[2].trim();
      blocks.push(
        <h4
          key={`h-${blockKey++}`}
          className="pt-1 text-xs font-semibold tracking-tight text-[var(--text-primary)] first:pt-0"
        >
          {renderInlineMarkdown(title, onOpenLink, `h-${blockKey}`)}
        </h4>,
      );
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      const listKey = blockKey++;
      blocks.push(
        <ul key={`ul-${listKey}`} className="space-y-1.5 pl-1">
          {items.map((item, idx) => (
            <li
              key={`li-${listKey}-${idx}`}
              className="flex items-start gap-2 text-xs leading-relaxed text-[var(--text-secondary)]"
            >
              <span
                aria-hidden="true"
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]"
              />
              <span className="min-w-0">
                {renderInlineMarkdown(item, onOpenLink, `li-${listKey}-${idx}`)}
              </span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^[-*_]{3,}$/.test(lines[i].trim()) &&
      !/^#{1,3}\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim())
    ) {
      paragraphLines.push(lines[i].trim());
      i++;
    }
    const pKey = blockKey++;
    blocks.push(
      <p
        key={`p-${pKey}`}
        className="text-xs leading-relaxed text-[var(--text-secondary)]"
      >
        {renderInlineMarkdown(paragraphLines.join(" "), onOpenLink, `p-${pKey}`)}
      </p>,
    );
  }

  return <div className="space-y-2">{blocks}</div>;
}

export function AboutUpdatesPanel() {
  const appStatus = useAppStore((s) => s.appStatus);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen);
  const currentVersion = appStatus?.app_version ?? "0.1.0";

  const availableUpdate = useUpdaterStore((s) => s.availableUpdate);
  const releaseNotes = useUpdaterStore((s) => s.releaseNotes);
  const phase = useUpdaterStore((s) => s.phase);
  const downloadPercent = useUpdaterStore((s) => s.downloadPercent);
  const downloadedBytes = useUpdaterStore((s) => s.downloadedBytes);
  const totalBytes = useUpdaterStore((s) => s.totalBytes);
  const lastCheckedAt = useUpdaterStore((s) => s.lastCheckedAt);
  const updateStatusText = useUpdaterStore((s) => s.statusText);
  const updateError = useUpdaterStore((s) => s.error);
  const checkForUpdates = useUpdaterStore((s) => s.checkForUpdates);
  const downloadUpdate = useUpdaterStore((s) => s.downloadUpdate);
  const installDownloadedUpdate = useUpdaterStore(
    (s) => s.installDownloadedUpdate,
  );

  React.useEffect(() => {
    if (lastCheckedAt === null && phase === "idle") {
      void checkForUpdates(currentVersion, { silent: true });
    }
  }, [lastCheckedAt, phase, checkForUpdates, currentVersion]);

  const effectiveNotes = releaseNotes ?? availableUpdate?.body ?? null;

  const checkingUpdate = phase === "checking";
  const downloadingUpdate = phase === "downloading";
  const readyToInstall = phase === "ready";
  const installingUpdate = phase === "installing";
  const busy = checkingUpdate || downloadingUpdate || installingUpdate;

  const handleOpenLink = async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (err: unknown) {
      toast.error(
        "Unable to open link",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* App Identity Hero */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <EmbedBayLogo size={48} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                  EmbedBay
                </h3>
                <Badge variant="accent" className="font-mono">
                  v{currentVersion}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Local Vector Database Manager, Explorer & Semantic Workbench
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="default" className="font-mono text-[10px]">
                  {appStatus?.platform.target_triple ?? "desktop"}
                </Badge>
                <Badge variant="default" className="text-[10px]">
                  Tauri v2 · Rust · React 19
                </Badge>
                <Badge variant="default" className="font-mono text-[10px]">
                  Schema v{appStatus?.schema_version ?? 4}
                </Badge>
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setSettingsOpen(false);
              setOnboardingOpen(true);
            }}
          >
            <Compass className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
            Welcome Guide
          </Button>
        </div>
      </section>

      {/* Software Updates */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--accent-secondary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Software Updates
              </h3>
              {lastCheckedAt && (
                <span className="text-[11px] text-[var(--text-muted)]">
                  · Checked {lastCheckedAt}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {updateStatusText}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void checkForUpdates(currentVersion)}
            >
              {checkingUpdate ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Check for Updates
            </Button>

            {availableUpdate && (
              <Button
                type="button"
                size="sm"
                disabled={downloadingUpdate || installingUpdate}
                onClick={() =>
                  void (readyToInstall
                    ? installDownloadedUpdate()
                    : downloadUpdate())
                }
              >
                {downloadingUpdate || installingUpdate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : readyToInstall ? (
                  <RotateCw className="h-3.5 w-3.5" />
                ) : (
                  <DownloadCloud className="h-3.5 w-3.5" />
                )}
                {downloadingUpdate
                  ? downloadPercent !== null
                    ? `Downloading (${downloadPercent}%)`
                    : "Downloading..."
                  : installingUpdate
                    ? "Installing..."
                    : readyToInstall
                      ? "Install & Restart"
                      : `Update to v${availableUpdate.version}`}
              </Button>
            )}
          </div>
        </div>

        {downloadingUpdate && (
          <div className="mt-3 space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
              <div
                className="h-full rounded-full bg-[var(--accent-primary)] transition-all"
                style={{ width: `${Math.max(4, downloadPercent ?? 10)}%` }}
              />
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] text-[var(--text-muted)]">
              <span>Downloading in background (safe to close Settings)</span>
              <span>
                {totalBytes > 0
                  ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                  : downloadPercent !== null
                    ? `${downloadPercent}%`
                    : "..."}
              </span>
            </div>
          </div>
        )}

        {availableUpdate && (
          <div className="mt-3 rounded-lg border border-[var(--status-running)]/30 bg-[var(--status-running)]/10 p-3.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--status-running)]">
                <Sparkles className="h-3.5 w-3.5" />
                {readyToInstall
                  ? `EmbedBay v${availableUpdate.version} downloaded — ready to install`
                  : downloadingUpdate
                    ? `Downloading EmbedBay v${availableUpdate.version}...`
                    : `Release v${availableUpdate.version} available`}
              </div>
              <button
                type="button"
                onClick={() =>
                  void handleOpenLink(
                    `https://github.com/HeronKyaw/embedbay/releases/tag/v${availableUpdate.version}`,
                  )
                }
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] cursor-pointer"
              >
                Release page
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
            {effectiveNotes && (
              <div className="mt-2.5 max-h-56 overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/80 p-3">
                <ReleaseNotesContent
                  markdown={effectiveNotes}
                  onOpenLink={(url) => void handleOpenLink(url)}
                />
              </div>
            )}
          </div>
        )}

        {updateError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/10 p-3 text-xs text-[var(--status-error)]">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{updateError}</span>
          </div>
        )}

        {!availableUpdate && !updateError && (
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <CheckCircle2 className="h-3.5 w-3.5 text-[var(--status-running)]" />
            Upgrades preserve all vector data in %LOCALAPPDATA% and your OS
            keyring credentials.
          </div>
        )}
      </section>

      {/* Project & Support Links */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Resources & Feedback
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {PROJECT_LINKS.map((link) => (
            <button
              key={link.url}
              type="button"
              onClick={() => void handleOpenLink(link.url)}
              className="flex items-start justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  {link.label}
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                  {link.subtitle}
                </p>
              </div>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
