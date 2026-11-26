import * as React from "react";
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  HardDriveDownload,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { installEngine, uninstallEngine } from "@/ipc/engines";
import {
  compareVersionStrings,
  getEngineUpdateInfo,
  type EngineUpdateInfo,
} from "@/lib/engineVersions";
import { formatBytes } from "@/lib/format";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { CatalogEngineView } from "@/types/runtime";

function EngineCard({
  engine,
  updateInfo,
}: {
  engine: CatalogEngineView;
  updateInfo: EngineUpdateInfo;
}) {
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
  const [confirmNoticeOpen, setConfirmNoticeOpen] = React.useState(false);

  const performInstall = async () => {
    if (!currentVersion || isInstalling) return;
    setConfirmNoticeOpen(false);
    setBusyKey(progressKey);
    try {
      await installEngine(engine.engine_type, currentVersion.version);
      await refreshCatalogAndInstalled();
      toast.success(
        isSelectedVersionUpdate
          ? `${engine.display_name} updated to v${currentVersion.version}`
          : `${engine.display_name} v${currentVersion.version} ready`,
        isBuiltInZeroDownload
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

  const handleInstall = () => {
    if (!currentVersion || isInstalling) return;
    if (engine.install_notice) {
      setConfirmNoticeOpen(true);
      return;
    }
    void performInstall();
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
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {engine.display_name}
              </h3>
              {engine.runtime_kind === "embedded" || engine.embedded ? (
                <Badge variant="accent">Embedded · 0 MB Idle</Badge>
              ) : engine.runtime_kind === "jvm" ? (
                <Badge
                  variant="default"
                  className="border-[var(--status-starting)]/40 bg-[var(--status-starting)]/10 text-[var(--status-starting)]"
                >
                  JVM · {engine.ram_hint ?? "~1 GB RAM"}
                </Badge>
              ) : engine.runtime_kind === "sql_portable" ? (
                <Badge variant="default">SQL Portable</Badge>
              ) : (
                <Badge variant="default">Lightweight Native</Badge>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {engine.description}
            </p>
          </div>
          {currentVersion?.installed ? (
            updateInfo.hasUpdateAvailable && updateInfo.recommendedVersion ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                <Badge variant="running">
                  <CheckCircle2 className="h-3 w-3" />
                  Installed
                </Badge>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedVersion(updateInfo.recommendedVersion!.version)
                  }
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--status-starting)]/40 bg-[var(--status-starting)]/15 px-2 py-0.5 text-[11px] font-medium leading-none text-[var(--status-starting)] transition-colors hover:bg-[var(--status-starting)]/25"
                >
                  <ArrowUpCircle className="h-3 w-3" />v
                  {updateInfo.recommendedVersion.version} available
                </button>
              </div>
            ) : (
              <Badge variant="running" className="shrink-0">
                <CheckCircle2 className="h-3 w-3" />
                Installed
              </Badge>
            )
          ) : (
            updateInfo.hasUpdateAvailable && (
              <Badge variant="warning" className="shrink-0">
                <ArrowUpCircle className="h-3 w-3" />
                Update Available
              </Badge>
            )
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
                {isBuiltInZeroDownload
                  ? "Built-in (0 B)"
                  : formatBytes(currentVersion.size_bytes)}
              </span>
            </div>
            {!isBuiltInZeroDownload && currentVersion.sha256 && (
              <div className="col-span-2 flex items-center gap-1.5 border-t border-[var(--border-subtle)] pt-1.5 text-[10px] text-[var(--text-muted)]">
                <ShieldCheck className="h-3 w-3 shrink-0 text-[var(--accent-primary)]" />
                <span className="truncate font-mono">
                  SHA-256: {currentVersion.sha256}
                </span>
              </div>
            )}
          </div>
        )}

        {updateInfo.hasUpdateAvailable &&
          updateInfo.recommendedVersion &&
          updateInfo.latestInstalledVersion &&
          !isInstalling && (
            <div className="mt-3 flex items-start justify-between gap-2 rounded-lg border border-[var(--status-starting)]/40 bg-[var(--status-starting)]/10 p-2.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              <div className="flex items-start gap-2">
                <ArrowUpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-starting)]" />
                <span>
                  <span className="font-mono text-[var(--text-primary)]">
                    v{updateInfo.latestInstalledVersion}
                  </span>{" "}
                  installed ·{" "}
                  <span className="font-mono text-[var(--status-starting)]">
                    v{updateInfo.recommendedVersion.version}
                  </span>{" "}
                  available. Installs side-by-side without affecting existing
                  instances.
                </span>
              </div>
              {currentVersion?.version !==
                updateInfo.recommendedVersion.version && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedVersion(updateInfo.recommendedVersion!.version)
                  }
                  className="shrink-0 cursor-pointer rounded border border-[var(--status-starting)]/40 bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[10px] font-medium text-[var(--status-starting)] transition-colors hover:bg-[var(--status-starting)]/15"
                >
                  Select v{updateInfo.recommendedVersion.version}
                </button>
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
              ) : isSelectedVersionUpdate ? (
                <ArrowUpCircle className="h-3.5 w-3.5" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {isInstalling
                ? isSelectedVersionUpdate
                  ? "Updating..."
                  : "Installing..."
                : isSelectedVersionUpdate
                  ? isBuiltInZeroDownload
                    ? "Update Runtime"
                    : `Update to v${currentVersion.version}`
                  : isBuiltInZeroDownload
                    ? "Enable Runtime"
                    : "One-Click Install"}
            </Button>
          )}
        </div>
      </div>

      {engine.install_notice && currentVersion && (
        <Dialog
          open={confirmNoticeOpen}
          onOpenChange={setConfirmNoticeOpen}
          title={`${isSelectedVersionUpdate ? "Before Updating" : "Before Installing"} ${engine.display_name}`}
          description={`v${currentVersion.version} · Download size ${formatBytes(currentVersion.size_bytes)}`}
          maxWidthClass="w-[460px]"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-[var(--status-starting)]/40 bg-[var(--status-starting)]/10 p-3 text-xs leading-relaxed text-[var(--text-primary)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-starting)]" />
              <div className="space-y-1.5">
                <p>{engine.install_notice}</p>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Tip: You can override JVM heap memory per instance in Config JSON (for example,{" "}
                  <code className="font-mono text-[var(--accent-primary)]">
                    {`{"heap_mb": 768}`}
                  </code>
                  ).
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmNoticeOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void performInstall()}
              >
                {isSelectedVersionUpdate ? (
                  <ArrowUpCircle className="h-3.5 w-3.5" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {isSelectedVersionUpdate
                  ? "Proceed with Update"
                  : "Proceed with Install"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const CATEGORY_FILTERS = [
  { id: "all", label: "All" },
  { id: "vector", label: "Vector" },
  { id: "hybrid_search", label: "Hybrid Search" },
  { id: "sql_vector", label: "SQL + Vector" },
  { id: "multimodel", label: "Multi-Model" },
  { id: "embedded", label: "Embedded" },
] as const;

function CatalogSection({
  title,
  count,
  dotColorClass,
  collapsed,
  onToggle,
  engines,
  updateInfoByEngine,
  installedEngines,
}: {
  title: string;
  count: number;
  dotColorClass: string;
  collapsed: boolean;
  onToggle: () => void;
  engines: CatalogEngineView[];
  updateInfoByEngine: Record<string, EngineUpdateInfo>;
  installedEngines: ReturnType<typeof useRuntimeStore.getState>["installedEngines"];
}) {
  if (engines.length === 0) return null;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="group flex w-full cursor-pointer items-center gap-2.5 text-left"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--text-primary)]" />
        )}
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotColorClass}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]">
          {title}
        </span>
        <span className="inline-flex h-4 min-w-[18px] items-center justify-center rounded bg-[var(--bg-surface)] px-1 font-mono text-[10px] font-medium leading-none tabular-nums text-[var(--text-muted)] ring-1 ring-inset ring-[var(--border-subtle)]">
          {count}
        </span>
        <span className="h-px flex-1 bg-[var(--border-subtle)]" />
      </button>

      {!collapsed && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {engines.map((engine) => (
            <EngineCard
              key={engine.engine_type}
              engine={engine}
              updateInfo={
                updateInfoByEngine[engine.engine_type] ??
                getEngineUpdateInfo(engine, installedEngines)
              }
            />
          ))}
        </div>
      )}
    </section>
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
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [installedCollapsed, setInstalledCollapsed] = React.useState(false);
  const [availableCollapsed, setAvailableCollapsed] = React.useState(false);

  const updateInfoByEngine = React.useMemo(() => {
    const map: Record<string, EngineUpdateInfo> = {};
    for (const engine of catalog) {
      map[engine.engine_type] = getEngineUpdateInfo(engine, installedEngines);
    }
    return map;
  }, [catalog, installedEngines]);

  const updatesAvailableCount = React.useMemo(
    () =>
      Object.values(updateInfoByEngine).filter((info) => info.hasUpdateAvailable)
        .length,
    [updateInfoByEngine],
  );

  React.useEffect(() => {
    if (categoryFilter === "updates" && updatesAvailableCount === 0) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, updatesAvailableCount]);

  const filteredCatalog = React.useMemo(() => {
    if (categoryFilter === "all") return catalog;
    if (categoryFilter === "updates") {
      return catalog.filter(
        (e) => updateInfoByEngine[e.engine_type]?.hasUpdateAvailable,
      );
    }
    return catalog.filter((e) => (e.category ?? "vector") === categoryFilter);
  }, [catalog, categoryFilter, updateInfoByEngine]);

  const { installedCatalog, availableCatalog } = React.useMemo(() => {
    const installedList: CatalogEngineView[] = [];
    const availableList: CatalogEngineView[] = [];
    for (const engine of filteredCatalog) {
      if (engine.versions.some((v) => v.installed)) {
        installedList.push(engine);
      } else {
        availableList.push(engine);
      }
    }
    return { installedCatalog: installedList, availableCatalog: availableList };
  }, [filteredCatalog]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCatalogAndInstalled();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <PageHeader
        icon={
          <HardDriveDownload className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
        }
        title="Native Engine Store"
        badges={
          <>
            <span className="inline-flex h-5 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] leading-none text-[var(--accent-secondary)]">
              {appStatus?.platform.target_triple ?? "x86_64-pc-windows-msvc"}
            </span>
            {updatesAvailableCount > 0 && (
              <Badge variant="warning">
                <ArrowUpCircle className="h-3 w-3" />
                {updatesAvailableCount}{" "}
                {updatesAvailableCount === 1 ? "update" : "updates"} available
              </Badge>
            )}
          </>
        }
        description={`Download, SHA-256 verify, and install native vector database engines with zero Docker overhead. ${installedEngines.length} runtime version(s) installed.`}
        actions={
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
        }
      />

      {storageCleanupBanner}

      <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1">
        {CATEGORY_FILTERS.map((cat) => {
          const count =
            cat.id === "all"
              ? catalog.length
              : catalog.filter((e) => (e.category ?? "vector") === cat.id)
                  .length;
          const active = categoryFilter === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              className={`inline-flex h-7 cursor-pointer items-center gap-2 rounded-md px-2.5 text-xs font-medium leading-none transition-colors ${
                active
                  ? "bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] ring-1 ring-inset ring-[var(--accent-primary)]/35"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span>{cat.label}</span>
              <span
                className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded px-1 font-mono text-[10px] font-medium leading-none tabular-nums ${
                  active
                    ? "bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]"
                    : "bg-[var(--bg-canvas)] text-[var(--text-muted)]"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
        {updatesAvailableCount > 0 && (
          <button
            type="button"
            onClick={() => setCategoryFilter("updates")}
            className={`inline-flex h-7 cursor-pointer items-center gap-2 rounded-md px-2.5 text-xs font-medium leading-none transition-colors ${
              categoryFilter === "updates"
                ? "bg-[var(--status-starting)]/15 text-[var(--status-starting)] ring-1 ring-inset ring-[var(--status-starting)]/35"
                : "text-[var(--status-starting)] hover:bg-[var(--status-starting)]/10"
            }`}
          >
            <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
            <span>Updates</span>
            <span
              className={`inline-flex h-4 min-w-[18px] items-center justify-center rounded px-1 font-mono text-[10px] font-medium leading-none tabular-nums ${
                categoryFilter === "updates"
                  ? "bg-[var(--status-starting)]/20 text-[var(--status-starting)]"
                  : "bg-[var(--bg-canvas)] text-[var(--status-starting)]"
              }`}
            >
              {updatesAvailableCount}
            </span>
          </button>
        )}
      </div>

      <div className="space-y-6">
        <CatalogSection
          title="Installed"
          count={installedCatalog.length}
          dotColorClass="bg-[var(--status-running)]"
          collapsed={installedCollapsed}
          onToggle={() => setInstalledCollapsed((v) => !v)}
          engines={installedCatalog}
          updateInfoByEngine={updateInfoByEngine}
          installedEngines={installedEngines}
        />
        <CatalogSection
          title="Available"
          count={availableCatalog.length}
          dotColorClass="bg-[var(--text-muted)]"
          collapsed={availableCollapsed}
          onToggle={() => setAvailableCollapsed((v) => !v)}
          engines={availableCatalog}
          updateInfoByEngine={updateInfoByEngine}
          installedEngines={installedEngines}
        />
      </div>
    </div>
  );
}
