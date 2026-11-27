import * as React from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  HardDriveDownload,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EngineDetailView } from "@/components/manager/EngineDetailView";
import { InstallEngineDialog } from "@/components/manager/InstallEngineDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EngineIcon } from "@/components/ui/engine-icon";
import { toast } from "@/components/ui/toast";
import { uninstallEngine } from "@/ipc/engines";
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
  onSelectEngine,
}: {
  engine: CatalogEngineView;
  updateInfo: EngineUpdateInfo;
  onSelectEngine: (engineType: string) => void;
}) {
  const activeInstalls = useRuntimeStore((s) => s.activeInstalls);
  const startEngineInstall = useRuntimeStore((s) => s.startEngineInstall);
  const pauseInstall = useRuntimeStore((s) => s.pauseInstall);
  const resumeInstall = useRuntimeStore((s) => s.resumeInstall);
  const cancelInstall = useRuntimeStore((s) => s.cancelInstall);
  const openCreateInstanceModal = useRuntimeStore(
    (s) => s.openCreateInstanceModal,
  );
  const refreshCatalogAndInstalled = useRuntimeStore(
    (s) => s.refreshCatalogAndInstalled,
  );

  const recommended =
    engine.versions.find((v) => v.recommended) ?? engine.versions[0];
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [uninstallOpen, setUninstallOpen] = React.useState(false);
  const [uninstallingId, setUninstallingId] = React.useState<string | null>(null);

  const installedVersions = React.useMemo(
    () => engine.versions.filter((v) => v.installed && v.installed_id),
    [engine.versions],
  );

  // Show active download for any version of this engine
  const activeInstall = React.useMemo(
    () =>
      Object.values(activeInstalls).find(
        (evt) => evt.engine_type === engine.engine_type,
      ) ?? null,
    [activeInstalls, engine.engine_type],
  );
  const isInstalling = Boolean(activeInstall);
  const isPaused = activeInstall?.stage === "paused";
  const isInstalled = engine.versions.some((v) => v.installed);
  const isBuiltInZeroDownload =
    engine.embedded && (recommended?.size_bytes ?? 0) === 0;

  const startVersionInstall = async (ver: string) => {
    if (!ver || isInstalling) return;
    const verObj = engine.versions.find((v) => v.version === ver);
    const isBuiltIn = engine.embedded && (verObj?.size_bytes ?? 0) === 0;
    const isUpd = Boolean(
      verObj &&
        !verObj.installed &&
        updateInfo.latestInstalledVersion &&
        compareVersionStrings(ver, updateInfo.latestInstalledVersion) > 0,
    );
    setPickerOpen(false);
    await startEngineInstall({
      engineType: engine.engine_type,
      version: ver,
      displayName: engine.display_name,
      isBuiltIn,
      isUpdate: isUpd,
    });
  };

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInstalling || !recommended) return;
    if (isBuiltInZeroDownload && engine.versions.length <= 1) {
      void startVersionInstall(recommended.version);
      return;
    }
    setPickerOpen(true);
  };

  const handleUninstallVersion = async (installedId: string, version: string) => {
    if (uninstallingId) return;
    setUninstallingId(installedId);
    try {
      await uninstallEngine(installedId);
      await refreshCatalogAndInstalled();
      toast.info(`Uninstalled ${engine.display_name} v${version}`);
      if (installedVersions.length <= 1) {
        setUninstallOpen(false);
      }
    } catch (err: unknown) {
      toast.error(
        `Cannot uninstall ${engine.display_name}`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setUninstallingId(null);
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectEngine(engine.engine_type)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelectEngine(engine.engine_type);
          }
        }}
        className="group flex cursor-pointer flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      >
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <EngineIcon engineType={engine.engine_type} size="md" />
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] transition-colors group-hover:text-[var(--accent-primary)]">
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
            </div>

            {isInstalled ? (
              updateInfo.hasUpdateAvailable && updateInfo.recommendedVersion ? (
                <Badge variant="warning" className="shrink-0">
                  <ArrowUpCircle className="h-3 w-3" />v
                  {updateInfo.recommendedVersion.version} available
                </Badge>
              ) : (
                <Badge variant="running" className="shrink-0">
                  <CheckCircle2 className="h-3 w-3" />
                  Installed
                </Badge>
              )
            ) : (
              recommended && (
                <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                  v{recommended.version}
                </span>
              )
            )}
          </div>

          <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-[var(--text-secondary)]">
            {engine.description}
          </p>

          {/* Live Download Progress */}
          {isInstalling && activeInstall && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-3 space-y-2 rounded-lg border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 p-2.5"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-[var(--text-primary)]">
                  {activeInstall.message}
                </span>
                <span className="font-mono text-[var(--accent-primary)]">
                  {isPaused
                    ? "Paused"
                    : `${Math.round(activeInstall.percent)}%`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
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
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                  {activeInstall.total_bytes > 0
                    ? `${formatBytes(activeInstall.downloaded_bytes)} / ${formatBytes(activeInstall.total_bytes)}`
                    : "Preparing..."}
                </span>
                {(activeInstall.stage === "downloading" ||
                  activeInstall.stage === "paused") && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        void (isPaused
                          ? resumeInstall(
                              engine.engine_type,
                              activeInstall.version,
                            )
                          : pauseInstall(
                              engine.engine_type,
                              activeInstall.version,
                            ));
                      }}
                    >
                      {isPaused ? (
                        <>
                          <Play className="h-2.5 w-2.5" />
                          Resume
                        </>
                      ) : (
                        <>
                          <Pause className="h-2.5 w-2.5" />
                          Pause
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-[var(--status-error)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        void cancelInstall(
                          engine.engine_type,
                          activeInstall.version,
                        );
                      }}
                    >
                      <Square className="h-2.5 w-2.5 fill-current" />
                      Stop
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Uniform Card Footer */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
          <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
            {isBuiltInZeroDownload
              ? "Built-in · Zero daemon"
              : `${recommended ? formatBytes(recommended.size_bytes) : "—"} · :${engine.default_port}${
                  engine.versions.length > 1
                    ? ` · ${engine.versions.length} versions`
                    : ""
                }`}
          </span>

          <div
            className="flex shrink-0 items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {isInstalled ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={`Uninstall ${engine.display_name}`}
                  aria-label={`Uninstall ${engine.display_name}`}
                  disabled={
                    isInstalling ||
                    Boolean(uninstallingId) ||
                    installedVersions.length === 0
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setUninstallOpen(true);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
                </Button>
                {updateInfo.hasUpdateAvailable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isInstalling}
                    onClick={handleActionClick}
                  >
                    <ArrowUpCircle className="h-3.5 w-3.5 text-[var(--status-starting)]" />
                    Update
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    openCreateInstanceModal(engine.engine_type);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create Instance
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={isInstalling || !recommended}
                onClick={handleActionClick}
              >
                {isInstalling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {isInstalling
                  ? isPaused
                    ? "Paused"
                    : "Installing..."
                  : isBuiltInZeroDownload
                    ? "Enable Runtime"
                    : "Install"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <InstallEngineDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        engine={engine}
        updateInfo={updateInfo}
        initialVersion={recommended?.version}
        isInstalling={isInstalling}
        onConfirmInstall={startVersionInstall}
      />

      {uninstallOpen && installedVersions.length > 0 && (
        <Dialog
          open={uninstallOpen}
          onOpenChange={setUninstallOpen}
          title={`Uninstall ${engine.display_name}`}
          description="Remove locally installed runtime binaries. Existing instances using a version must be deleted first."
          maxWidthClass="w-[460px]"
        >
          {installedVersions.length === 1 ? (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                Are you sure you want to uninstall{" "}
                <strong className="text-[var(--text-primary)]">
                  {engine.display_name} v{installedVersions[0].version}
                </strong>
                ?
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(uninstallingId)}
                  onClick={() => setUninstallOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={Boolean(uninstallingId)}
                  onClick={() =>
                    installedVersions[0].installed_id &&
                    void handleUninstallVersion(
                      installedVersions[0].installed_id,
                      installedVersions[0].version,
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {uninstallingId
                    ? "Uninstalling..."
                    : `Uninstall v${installedVersions[0].version}`}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                {installedVersions.map((ver) => (
                  <div
                    key={ver.version}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-[var(--text-primary)]">
                        v{ver.version}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        {ver.size_bytes === 0
                          ? "Built-in"
                          : formatBytes(ver.size_bytes)}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={Boolean(uninstallingId)}
                      onClick={() =>
                        ver.installed_id &&
                        void handleUninstallVersion(
                          ver.installed_id,
                          ver.version,
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {uninstallingId === ver.installed_id
                        ? "Removing..."
                        : "Uninstall"}
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setUninstallOpen(false)}
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
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
  onSelectEngine,
}: {
  title: string;
  count: number;
  dotColorClass: string;
  collapsed: boolean;
  onToggle: () => void;
  engines: CatalogEngineView[];
  updateInfoByEngine: Record<string, EngineUpdateInfo>;
  installedEngines: ReturnType<typeof useRuntimeStore.getState>["installedEngines"];
  onSelectEngine: (engineType: string) => void;
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
              onSelectEngine={onSelectEngine}
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
  const refreshCatalogFromDisk = useRuntimeStore(
    (s) => s.refreshCatalogFromDisk,
  );
  const appStatus = useAppStore((s) => s.appStatus);
  const selectedStoreEngine = useAppStore((s) => s.selectedStoreEngine);
  const setSelectedStoreEngine = useAppStore((s) => s.setSelectedStoreEngine);
  const [refreshing, setRefreshing] = React.useState(false);
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [installedCollapsed, setInstalledCollapsed] = React.useState(false);
  const [availableCollapsed, setAvailableCollapsed] = React.useState(false);

  const selectedEngineObj = React.useMemo(
    () =>
      selectedStoreEngine
        ? catalog.find((e) => e.engine_type === selectedStoreEngine) ?? null
        : null,
    [catalog, selectedStoreEngine],
  );

  // Support mouse Back button (button 3), Alt+Left, BrowserBack, and popstate from Engine Detail page
  React.useEffect(() => {
    if (!selectedEngineObj) return;
    if (
      typeof window !== "undefined" &&
      !(
        typeof window.history.state === "object" &&
        window.history.state !== null &&
        (window.history.state as { embedbayStoreDetail?: boolean })
          .embedbayStoreDetail
      )
    ) {
      window.history.pushState({ embedbayStoreDetail: true }, "");
    }

    const goBack = () => setSelectedStoreEngine(null);
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "BrowserBack" || (e.altKey && e.key === "ArrowLeft")) {
        e.preventDefault();
        goBack();
      }
    };
    const onPopState = () => {
      goBack();
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, [selectedEngineObj, setSelectedStoreEngine]);

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
    const minSpin = new Promise((resolve) => window.setTimeout(resolve, 400));
    try {
      const [refreshed] = await Promise.all([
        refreshCatalogFromDisk(),
        minSpin,
      ]);
      toast.success(
        "Catalog refreshed",
        `${refreshed.length} engine(s) verified from local manifest.`,
      );
    } catch (err: unknown) {
      toast.error(
        "Failed to refresh catalog",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setRefreshing(false);
    }
  };

  if (selectedEngineObj) {
    return (
      <EngineDetailView
        engine={selectedEngineObj}
        updateInfo={
          updateInfoByEngine[selectedEngineObj.engine_type] ??
          getEngineUpdateInfo(selectedEngineObj, installedEngines)
        }
        onBack={() => setSelectedStoreEngine(null)}
      />
    );
  }

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
            {refreshing ? "Refreshing..." : "Refresh Catalog"}
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
          onSelectEngine={setSelectedStoreEngine}
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
          onSelectEngine={setSelectedStoreEngine}
        />
      </div>
    </div>
  );
}
