import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Compass,
  DownloadCloud,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { EmbedBayLogo } from "@/components/layout/EmbedBayLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { isTauriRuntime, openExternalUrl } from "@/ipc/system";
import { formatUserError } from "@/lib/errors";
import { useAppStore } from "@/stores/useAppStore";

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

export function AboutUpdatesPanel() {
  const appStatus = useAppStore((s) => s.appStatus);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen);
  const currentVersion = appStatus?.app_version ?? "0.1.0";

  const [checkingUpdate, setCheckingUpdate] = React.useState(false);
  const [installingUpdate, setInstallingUpdate] = React.useState(false);
  const [downloadPercent, setDownloadPercent] = React.useState<number | null>(
    null,
  );
  const [availableUpdate, setAvailableUpdate] = React.useState<Update | null>(
    null,
  );
  const [lastCheckedAt, setLastCheckedAt] = React.useState<string | null>(null);
  const [updateStatusText, setUpdateStatusText] = React.useState<string>(
    "Signed updates delivered via GitHub Releases (latest.json).",
  );
  const [updateError, setUpdateError] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (availableUpdate) {
        void availableUpdate.close().catch(() => {});
      }
    };
  }, [availableUpdate]);

  const handleCheckForUpdates = async () => {
    if (checkingUpdate || installingUpdate) return;
    setUpdateError(null);
    if (!isTauriRuntime()) {
      setUpdateStatusText(
        "Update checking requires the installed Tauri desktop runtime.",
      );
      toast.info(
        "Desktop runtime required",
        "Run EmbedBay via Tauri to check signed GitHub Releases.",
      );
      return;
    }

    setCheckingUpdate(true);
    setUpdateStatusText("Contacting release feed...");
    try {
      if (availableUpdate) {
        await availableUpdate.close().catch(() => {});
        setAvailableUpdate(null);
      }
      const next = await check({ timeout: 15000 });
      setLastCheckedAt(new Date().toLocaleTimeString());
      if (next) {
        setAvailableUpdate(next);
        setUpdateStatusText(
          `EmbedBay v${next.version} is available (installed: v${next.currentVersion}).`,
        );
        toast.success(`Update v${next.version} available`);
      } else {
        setUpdateStatusText(
          `You are running the latest version (v${currentVersion}).`,
        );
        toast.success("Up to date", "No newer EmbedBay release found.");
      }
    } catch (err: unknown) {
      const msg = formatUserError(err);
      setUpdateError(msg);
      setUpdateStatusText("Unable to fetch update manifest.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!availableUpdate || installingUpdate) return;
    setInstallingUpdate(true);
    setUpdateError(null);
    setDownloadPercent(0);
    let totalBytes = 0;
    let downloadedBytes = 0;

    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setDownloadPercent(0);
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setDownloadPercent(
              Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)),
            );
          }
        } else if (event.event === "Finished") {
          setDownloadPercent(100);
        }
      });
      toast.success("Update installed", "Restarting EmbedBay to finish update.");
    } catch (err: unknown) {
      const msg = formatUserError(err);
      setUpdateError(msg);
      toast.error("Update install failed", msg);
    } finally {
      setInstallingUpdate(false);
    }
  };

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
              disabled={checkingUpdate || installingUpdate}
              onClick={() => void handleCheckForUpdates()}
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
                disabled={installingUpdate}
                onClick={() => void handleInstallUpdate()}
              >
                {installingUpdate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="h-3.5 w-3.5" />
                )}
                {installingUpdate && downloadPercent !== null
                  ? `Installing (${downloadPercent}%)`
                  : `Install v${availableUpdate.version}`}
              </Button>
            )}
          </div>
        </div>

        {installingUpdate && downloadPercent !== null && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
              <div
                className="h-full rounded-full bg-[var(--accent-primary)] transition-all"
                style={{ width: `${downloadPercent}%` }}
              />
            </div>
          </div>
        )}

        {availableUpdate && (
          <div className="mt-3 rounded-lg border border-[var(--status-running)]/30 bg-[var(--status-running)]/10 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-[var(--status-running)]">
              <Sparkles className="h-3.5 w-3.5" />
              Release v{availableUpdate.version} ready to install
            </div>
            {availableUpdate.body && (
              <p className="mt-1 whitespace-pre-wrap text-[var(--text-secondary)]">
                {availableUpdate.body}
              </p>
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
