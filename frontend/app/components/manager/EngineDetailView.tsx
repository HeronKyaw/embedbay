import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpCircle,
  Boxes,
  CheckCircle2,
  Download,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import { InstallEngineDialog } from "@/components/manager/InstallEngineDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EngineIcon } from "@/components/ui/engine-icon";
import { InstanceStatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toast";
import { uninstallEngine } from "@/ipc/engines";
import {
  compareVersionStrings,
  type EngineUpdateInfo,
} from "@/lib/engineVersions";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { CatalogEngineView } from "@/types/runtime";

export function EngineDetailView({
  engine,
  updateInfo,
  onBack,
}: {
  engine: CatalogEngineView;
  updateInfo: EngineUpdateInfo;
  onBack: () => void;
}) {
  const activeInstalls = useRuntimeStore((s) => s.activeInstalls);
  const startEngineInstall = useRuntimeStore((s) => s.startEngineInstall);
  const pauseInstall = useRuntimeStore((s) => s.pauseInstall);
  const resumeInstall = useRuntimeStore((s) => s.resumeInstall);
  const cancelInstall = useRuntimeStore((s) => s.cancelInstall);
  const refreshCatalogAndInstalled = useRuntimeStore(
    (s) => s.refreshCatalogAndInstalled,
  );
  const openCreateInstanceModal = useRuntimeStore(
    (s) => s.openCreateInstanceModal,
  );
  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const recommended =
    engine.versions.find((v) => v.recommended) ?? engine.versions[0];
  const [selectedVersion, setSelectedVersion] = React.useState(
    recommended?.version ?? "",
  );
  const [installDialogOpen, setInstallDialogOpen] = React.useState(false);

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
  const activeInstall = activeInstalls[progressKey];
  const isInstalling = Boolean(activeInstall);
  const isPaused = activeInstall?.stage === "paused";
  const isBuiltInZeroDownload =
    engine.embedded && (currentVersion?.size_bytes ?? 0) === 0;
  const isSelectedVersionUpdate = Boolean(
    currentVersion &&
      !currentVersion.installed &&
      updateInfo.latestInstalledVersion &&
      compareVersionStrings(
        currentVersion.version,
        updateInfo.latestInstalledVersion,
      ) > 0,
  );

  const matchingInstances = instances.filter(
    (i) => i.engine_type === engine.engine_type,
  );

  const performInstall = async (ver: string) => {
    if (!ver || isInstalling) return;
    const verObj = engine.versions.find((v) => v.version === ver);
    const isBuiltIn = engine.embedded && (verObj?.size_bytes ?? 0) === 0;
    const isUpd = Boolean(
      verObj &&
        !verObj.installed &&
        updateInfo.latestInstalledVersion &&
        compareVersionStrings(ver, updateInfo.latestInstalledVersion) > 0,
    );
    setSelectedVersion(ver);
    setInstallDialogOpen(false);
    await startEngineInstall({
      engineType: engine.engine_type,
      version: ver,
      displayName: engine.display_name,
      isBuiltIn,
      isUpdate: isUpd,
    });
  };

  const handleInstall = () => {
    if (!currentVersion || isInstalling) return;
    if (isBuiltInZeroDownload && engine.versions.length <= 1) {
      void performInstall(currentVersion.version);
      return;
    }
    setInstallDialogOpen(true);
  };

  const handleUninstall = async (installedId: string, version: string) => {
    try {
      await uninstallEngine(installedId);
      await refreshCatalogAndInstalled();
      toast.info(`Uninstalled ${engine.display_name} v${version}`);
    } catch (err: unknown) {
      toast.error(
        `Cannot uninstall ${engine.display_name}`,
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      {/* Top Back Bar & Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Engine Store
          </Button>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span>Engine Store</span>
            <span>/</span>
            <span className="font-semibold text-[var(--text-primary)]">
              {engine.display_name}
            </span>
          </div>
        </div>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">
          Tip: Press Mouse Back or Alt+← to return
        </span>
      </div>

      {/* Product Hero Card — two independent rows so button width changes never wrap/shift description */}
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <EngineIcon engineType={engine.engine_type} size="lg" />
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              {engine.display_name}
            </h1>
            <Badge variant={engine.embedded ? "ai" : "accent"}>
              {engine.embedded ? "Zero-Daemon Embedded" : "Local Daemon"}
            </Badge>
            {engine.ram_hint && (
              <Badge variant="default" className="font-mono">
                {engine.ram_hint}
              </Badge>
            )}
            {updateInfo.latestInstalledVersion && (
              <Badge variant="running">
                <CheckCircle2 className="h-3 w-3" />
                Installed
              </Badge>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {currentVersion?.installed ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    currentVersion.installed_id &&
                    void handleUninstall(
                      currentVersion.installed_id,
                      currentVersion.version,
                    )
                  }
                >
                  <Trash2 className="h-4 w-4 text-[var(--status-error)]" />
                  Uninstall v{currentVersion.version}
                </Button>
                <Button
                  type="button"
                  onClick={() => openCreateInstanceModal(engine.engine_type)}
                >
                  <Plus className="h-4 w-4" />
                  Create Instance
                </Button>
              </>
            ) : (
              <Button
                type="button"
                disabled={isInstalling || !currentVersion}
                onClick={handleInstall}
              >
                {isSelectedVersionUpdate ? (
                  <ArrowUpCircle className="h-4 w-4" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {isInstalling
                  ? isPaused
                    ? "Paused"
                    : "Installing..."
                  : isBuiltInZeroDownload
                    ? "Enable Runtime"
                    : isSelectedVersionUpdate
                      ? `Update to v${currentVersion?.version}`
                      : `Install v${currentVersion?.version}`}
              </Button>
            )}
          </div>
        </div>

        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          {engine.description}
        </p>

        <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-[var(--text-muted)]">
          <span>Engine ID: {engine.engine_type}</span>
          <span>
            {engine.embedded
              ? "Port: Zero daemon"
              : `Default port: :${engine.default_port}`}
          </span>
          {engine.default_grpc_port && (
            <span>gRPC port: :{engine.default_grpc_port}</span>
          )}
        </div>

        {engine.install_notice && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-[var(--status-starting)]/40 bg-[var(--status-starting)]/10 p-3 text-xs text-[var(--text-secondary)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-starting)]" />
            <span>{engine.install_notice}</span>
          </div>
        )}

        {/* Active Download Progress + Pause/Resume/Stop Controls */}
        {activeInstall && (
          <div className="mt-5 space-y-2 rounded-xl border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                <span>{activeInstall.message}</span>
                <span className="font-mono text-[var(--accent-primary)]">
                  {isPaused
                    ? "Paused"
                    : `${Math.round(activeInstall.percent)}%`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {(activeInstall.stage === "downloading" ||
                  activeInstall.stage === "paused") && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void (isPaused
                          ? resumeInstall(
                              activeInstall.engine_type,
                              activeInstall.version,
                            )
                          : pauseInstall(
                              activeInstall.engine_type,
                              activeInstall.version,
                            ))
                      }
                    >
                      {isPaused ? (
                        <>
                          <Play className="h-3.5 w-3.5" />
                          Resume
                        </>
                      ) : (
                        <>
                          <Pause className="h-3.5 w-3.5" />
                          Pause
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-[var(--status-error)]"
                      onClick={() =>
                        void cancelInstall(
                          activeInstall.engine_type,
                          activeInstall.version,
                        )
                      }
                    >
                      <Square className="h-3 w-3 fill-current" />
                      Stop
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
              <div
                className={`h-full transition-all duration-150 ${
                  isPaused
                    ? "bg-[var(--status-starting)]"
                    : "bg-[var(--accent-primary)]"
                }`}
                style={{
                  width: `${Math.min(100, Math.max(2, activeInstall.percent))}%`,
                }}
              />
            </div>
            {activeInstall.total_bytes > 0 && (
              <div className="font-mono text-[11px] text-[var(--text-secondary)]">
                {formatBytes(activeInstall.downloaded_bytes)} /{" "}
                {formatBytes(activeInstall.total_bytes)}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Available Versions Table */}
      <section className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Available Releases
        </h2>
        <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
          {engine.versions.map((ver) => {
            const isSelected = ver.version === currentVersion?.version;
            return (
              <div
                key={ver.version}
                onClick={() => setSelectedVersion(ver.version)}
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-[var(--accent-primary)]/10"
                    : "hover:bg-[var(--bg-elevated)]/60"
                }`}
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    v{ver.version}
                  </span>
                  {ver.recommended && (
                    <Badge variant="accent">Recommended</Badge>
                  )}
                  {ver.installed && <Badge variant="running">Installed</Badge>}
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    {ver.size_bytes === 0
                      ? "Built-in"
                      : formatBytes(ver.size_bytes)}
                  </span>
                  <span className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
                    {ver.archive_type}
                  </span>
                </div>
                {ver.sha256 && ver.sha256 !== "embedded" && (
                  <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--text-muted)]">
                    <ShieldCheck className="h-3 w-3 text-[var(--accent-primary)]" />
                    <span>{ver.sha256.slice(0, 16)}…</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Local Instances Using This Engine */}
      <section className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-[var(--accent-secondary)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Local Instances ({matchingInstances.length})
            </h2>
          </div>
          {matchingInstances.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActiveSection("runtimes")}
            >
              Manage in Local Runtimes
            </Button>
          )}
        </div>
        {matchingInstances.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            No local instances created for {engine.display_name} yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {matchingInstances.map((inst) => (
              <div
                key={inst.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-[var(--text-primary)]">
                    {inst.name}
                  </div>
                  <div className="font-mono text-[10px] text-[var(--text-muted)]">
                    v{inst.engine_version} ·{" "}
                    {inst.port > 0 ? `${inst.host}:${inst.port}` : "embedded"}
                  </div>
                </div>
                <InstanceStatusBadge
                  status={metrics[inst.id]?.status ?? "stopped"}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <InstallEngineDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        engine={engine}
        updateInfo={updateInfo}
        initialVersion={currentVersion?.version}
        isInstalling={isInstalling}
        onConfirmInstall={performInstall}
      />
    </div>
  );
}
