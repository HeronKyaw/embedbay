import * as React from "react";
import {
  CheckCircle2,
  Download,
  HardDriveDownload,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { installEngine, uninstallEngine } from "@/ipc/engines";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { CatalogEngineView } from "@/types/runtime";

function EngineCard({ engine }: { engine: CatalogEngineView }) {
  const installProgress = useRuntimeStore((s) => s.installProgress);
  const clearInstallProgress = useRuntimeStore((s) => s.clearInstallProgress);
  const refreshCatalogAndInstalled = useRuntimeStore(
    (s) => s.refreshCatalogAndInstalled,
  );
  const openCreateInstanceModal = useRuntimeStore(
    (s) => s.openCreateInstanceModal,
  );

  const recommended =
    engine.versions.find((v) => v.recommended) ?? engine.versions[0];
  const [selectedVersion, setSelectedVersion] = React.useState(
    recommended?.version ?? "",
  );
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (
      !engine.versions.some((v) => v.version === selectedVersion) &&
      recommended
    ) {
      setSelectedVersion(recommended.version);
    }
  }, [engine.versions, recommended, selectedVersion]);

  const currentVersion =
    engine.versions.find((v) => v.version === selectedVersion) ??
    engine.versions[0];

  const progressKey = `${engine.engine_type}-${currentVersion?.version ?? ""}`;
  const progress = installProgress[progressKey];
  const isInstalling = busyKey === progressKey;

  const handleInstall = async () => {
    if (!currentVersion || isInstalling) return;
    setBusyKey(progressKey);
    try {
      await installEngine(engine.engine_type, currentVersion.version);
      await refreshCatalogAndInstalled();
      toast.success(
        `${engine.display_name} v${currentVersion.version} ready`,
        engine.embedded
          ? "Embedded zero-daemon runtime enabled."
          : "SHA-256 verified and extracted cleanly.",
      );
    } catch (err: unknown) {
      toast.error(
        `Failed to install ${engine.display_name}`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearInstallProgress(engine.engine_type, currentVersion.version);
      setBusyKey(null);
    }
  };

  const handleUninstall = async () => {
    if (!currentVersion?.installed_id || isInstalling) return;
    setBusyKey(progressKey);
    try {
      await uninstallEngine(currentVersion.installed_id);
      await refreshCatalogAndInstalled();
      toast.info(
        `Uninstalled ${engine.display_name} v${currentVersion.version}`,
      );
    } catch (err: unknown) {
      toast.error(
        `Cannot uninstall ${engine.display_name}`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 transition-colors hover:border-[var(--border-strong)]">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {engine.display_name}
              </h3>
              {engine.embedded ? (
                <Badge variant="accent">Embedded · 0 MB Idle</Badge>
              ) : (
                <Badge variant="default">Tier {engine.tier} Native</Badge>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {engine.description}
            </p>
          </div>
          {currentVersion?.installed && (
            <Badge variant="running">
              <CheckCircle2 className="h-3 w-3" />
              Installed
            </Badge>
          )}
        </div>

        {/* Version Picker & Metadata */}
        {currentVersion && (
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 text-[11px]">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Version
              </label>
              <select
                value={currentVersion.version}
                onChange={(e) => setSelectedVersion(e.target.value)}
                className="mt-0.5 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              >
                {engine.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                    {v.recommended ? " (Recommended)" : ""}
                    {v.installed ? " ✓" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col justify-between">
              <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                Download Size
              </span>
              <span className="font-mono text-xs text-[var(--text-primary)]">
                {engine.embedded
                  ? "Built-in (0 B)"
                  : formatBytes(currentVersion.size_bytes)}
              </span>
            </div>
            {!engine.embedded && currentVersion.sha256 && (
              <div className="col-span-2 flex items-center gap-1.5 border-t border-[var(--border-subtle)] pt-1.5 text-[10px] text-[var(--text-muted)]">
                <ShieldCheck className="h-3 w-3 shrink-0 text-[var(--accent-primary)]" />
                <span className="truncate font-mono">
                  SHA-256: {currentVersion.sha256}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Live Download Progress */}
        {isInstalling && progress && (
          <div className="mt-3 space-y-1.5 rounded-lg border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-[var(--text-primary)]">
                {progress.message}
              </span>
              <span className="font-mono text-[var(--accent-primary)]">
                {Math.round(progress.percent)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
              <div
                className="h-full bg-[var(--accent-primary)] transition-all duration-150"
                style={{ width: `${Math.min(100, Math.max(2, progress.percent))}%` }}
              />
            </div>
            {progress.total_bytes > 0 && (
              <div className="font-mono text-[10px] text-[var(--text-secondary)]">
                {formatBytes(progress.downloaded_bytes)} /{" "}
                {formatBytes(progress.total_bytes)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          {engine.embedded
            ? "Zero daemon"
            : `Default port :${engine.default_port}`}
        </span>
        <div className="flex items-center gap-2">
          {currentVersion?.installed ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isInstalling}
                onClick={() => void handleUninstall()}
              >
                <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
                Uninstall
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => openCreateInstanceModal(engine.engine_type)}
              >
                <Plus className="h-3.5 w-3.5" />
                Create Instance
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={isInstalling || !currentVersion}
              onClick={() => void handleInstall()}
            >
              {isInstalling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {isInstalling
                ? "Installing..."
                : engine.embedded
                  ? "Enable Runtime"
                  : "One-Click Install"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EngineCatalog({
  storageCleanupBanner,
}: {
  storageCleanupBanner?: React.ReactNode;
}) {
  const catalog = useRuntimeStore((s) => s.catalog);
  const installedEngines = useRuntimeStore((s) => s.installedEngines);
  const refreshCatalogAndInstalled = useRuntimeStore(
    (s) => s.refreshCatalogAndInstalled,
  );
  const appStatus = useAppStore((s) => s.appStatus);
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCatalogAndInstalled();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div>
          <div className="flex items-center gap-2">
            <HardDriveDownload className="h-4 w-4 text-[var(--accent-primary)]" />
            <h1 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
              Native Engine Store
            </h1>
            <Badge variant="accent">
              {appStatus?.platform.target_triple ?? "x86_64-pc-windows-msvc"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Download, SHA-256 verify, and install native vector database
            engines with zero Docker overhead. {installedEngines.length}{" "}
            runtime version(s) installed.
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={refreshing}
          onClick={() => void handleRefresh()}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh Catalog
        </Button>
      </div>

      {storageCleanupBanner}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {catalog.map((engine) => (
          <EngineCard key={engine.engine_type} engine={engine} />
        ))}
      </div>
    </div>
  );
}
