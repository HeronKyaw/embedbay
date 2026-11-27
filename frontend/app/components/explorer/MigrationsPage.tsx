import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  RefreshCw,
  Repeat2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBuilder } from "@/components/search/FilterBuilder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EngineIcon } from "@/components/ui/engine-icon";
import { toast } from "@/components/ui/toast";
import { listCollections } from "@/ipc/explorer";
import { isTauriRuntime } from "@/ipc/system";
import {
  migrateCollection,
  type MigrationResult,
  type TransferProgressEvent,
} from "@/ipc/transfer";
import { isEmbeddedEngine } from "@/lib/engineVersions";
import { formatUserError } from "@/lib/errors";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type {
  CollectionSummary,
  ConnectionTarget,
  FilterSpec,
} from "@/types/explorer";

interface ConnectionOption {
  key: string;
  label: string;
  engineType: string;
  readOnly: boolean;
  target: ConnectionTarget;
}

interface MigrationRunRecord {
  id: string;
  sourceLabel: string;
  sourceEngine: string;
  sourceCollection: string;
  destKey: string;
  destTarget: ConnectionTarget;
  destLabel: string;
  destEngine: string;
  destCollection: string;
  result: MigrationResult;
  finishedAt: string;
}

/** Dedicated workspace view for migrating collections between any two databases. */
export function MigrationsPage() {
  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const remoteConnections = useTabsStore((s) => s.remoteConnections);
  const embeddingProfiles = useTabsStore((s) => s.embeddingProfiles);
  const refreshConnectionCollections = useTabsStore(
    (s) => s.refreshConnectionCollections,
  );
  const setActiveTabId = useTabsStore((s) => s.setActiveTabId);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const connectionOptions = React.useMemo<ConnectionOption[]>(() => {
    const out: ConnectionOption[] = [];
    for (const inst of instances) {
      const st = metrics[inst.id]?.status ?? "stopped";
      const ready =
        st === "running" ||
        st === "embedded" ||
        isEmbeddedEngine(inst.engine_type);
      if (!ready) continue;
      out.push({
        key: `local:${inst.id}`,
        label: `${inst.name} (${inst.engine_type.toUpperCase()})`,
        engineType: inst.engine_type,
        readOnly: false,
        target: { kind: "local_instance", instance_id: inst.id },
      });
    }
    for (const conn of remoteConnections) {
      out.push({
        key: `remote:${conn.id}`,
        label: `${conn.name} (${conn.engine_type.toUpperCase()}${conn.read_only ? " · Read-Only" : ""})`,
        engineType: conn.engine_type,
        readOnly: Boolean(conn.read_only),
        target: { kind: "remote_connection", connection_id: conn.id },
      });
    }
    return out;
  }, [instances, metrics, remoteConnections]);

  const [sourceKey, setSourceKey] = React.useState("");
  const [sourceCollections, setSourceCollections] = React.useState<
    CollectionSummary[]
  >([]);
  const [loadingSourceCols, setLoadingSourceCols] = React.useState(false);
  const [sourceCollection, setSourceCollection] = React.useState("");
  const [showFilter, setShowFilter] = React.useState(false);
  const [filterSpec, setFilterSpec] = React.useState<FilterSpec | null>(null);

  const [destKey, setDestKey] = React.useState("");
  const [destCollections, setDestCollections] = React.useState<
    CollectionSummary[]
  >([]);
  const [loadingDestCols, setLoadingDestCols] = React.useState(false);
  const [destMode, setDestMode] = React.useState<"new" | "existing">("new");
  const [destNewName, setDestNewName] = React.useState("");
  const [destExistingName, setDestExistingName] = React.useState("");
  const [destMetric, setDestMetric] = React.useState("Cosine");
  const [reembedProfileId, setReembedProfileId] = React.useState("");
  const [batchSize, setBatchSize] = React.useState("128");

  const [migrating, setMigrating] = React.useState(false);
  const [progress, setProgress] = React.useState<TransferProgressEvent | null>(
    null,
  );
  const [history, setHistory] = React.useState<MigrationRunRecord[]>([]);

  // Initialize default source & destination keys when connections become available
  React.useEffect(() => {
    if (connectionOptions.length === 0) return;
    if (!sourceKey || !connectionOptions.some((o) => o.key === sourceKey)) {
      setSourceKey(connectionOptions[0].key);
    }
    if (!destKey || !connectionOptions.some((o) => o.key === destKey)) {
      const writable =
        connectionOptions.find(
          (o, idx) => !o.readOnly && (connectionOptions.length === 1 || idx > 0),
        ) ?? connectionOptions.find((o) => !o.readOnly);
      setDestKey(writable?.key ?? connectionOptions[0].key);
    }
  }, [connectionOptions, sourceKey, destKey]);

  const selectedSource =
    connectionOptions.find((o) => o.key === sourceKey) ?? null;
  const selectedDest =
    connectionOptions.find((o) => o.key === destKey) ?? null;

  const loadSourceCollections = React.useCallback(
    async (target: ConnectionTarget, manual = false) => {
      setLoadingSourceCols(true);
      const minSpin = manual
        ? new Promise((resolve) => window.setTimeout(resolve, 400))
        : Promise.resolve();
      try {
        const [cols] = await Promise.all([listCollections(target), minSpin]);
        setSourceCollections(cols);
        setSourceCollection((prev) =>
          cols.some((c) => c.name === prev) ? prev : (cols[0]?.name ?? ""),
        );
      } catch (err: unknown) {
        setSourceCollections([]);
        setSourceCollection("");
        if (manual) {
          toast.error("Failed to list source collections", formatUserError(err));
        }
      } finally {
        setLoadingSourceCols(false);
      }
    },
    [],
  );

  const loadDestCollections = React.useCallback(
    async (target: ConnectionTarget, manual = false) => {
      setLoadingDestCols(true);
      const minSpin = manual
        ? new Promise((resolve) => window.setTimeout(resolve, 400))
        : Promise.resolve();
      try {
        const [cols] = await Promise.all([listCollections(target), minSpin]);
        setDestCollections(cols);
        setDestExistingName((prev) =>
          cols.some((c) => c.name === prev) ? prev : (cols[0]?.name ?? ""),
        );
      } catch {
        setDestCollections([]);
        setDestExistingName("");
      } finally {
        setLoadingDestCols(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (!selectedSource) {
      setSourceCollections([]);
      setSourceCollection("");
      return;
    }
    void loadSourceCollections(selectedSource.target);
  }, [selectedSource, loadSourceCollections]);

  React.useEffect(() => {
    if (!selectedDest) {
      setDestCollections([]);
      setDestExistingName("");
      return;
    }
    void loadDestCollections(selectedDest.target);
  }, [selectedDest, loadDestCollections]);

  React.useEffect(() => {
    if (sourceCollection) {
      setDestNewName(`${sourceCollection}_migrated`);
    }
  }, [sourceCollection]);

  React.useEffect(() => {
    if (!migrating || !isTauriRuntime()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<TransferProgressEvent>("transfer-progress", (event) => {
      if (active) setProgress(event.payload);
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [migrating]);

  const activeSourceMeta =
    sourceCollections.find((c) => c.name === sourceCollection) ?? null;

  const targetDestCollection =
    destMode === "new" ? destNewName.trim() : destExistingName.trim();

  const canStart =
    !migrating &&
    Boolean(selectedSource) &&
    Boolean(selectedDest) &&
    Boolean(sourceCollection) &&
    Boolean(targetDestCollection) &&
    !selectedDest?.readOnly;

  const handleStartMigration = async () => {
    if (!selectedSource || !selectedDest || !canStart) return;
    setMigrating(true);
    setProgress(null);

    try {
      const selectedProfile = embeddingProfiles.find(
        (p) => p.id === reembedProfileId,
      );
      const res = await migrateCollection({
        source_target: selectedSource.target,
        source_collection: sourceCollection,
        dest_target: selectedDest.target,
        dest_collection: targetDestCollection,
        create_dest_if_missing: destMode === "new",
        dest_dimensions:
          selectedProfile?.dimensions ?? activeSourceMeta?.dimensions ?? null,
        dest_distance_metric: destMode === "new" ? destMetric : null,
        filter: filterSpec,
        reembed_profile_id: reembedProfileId || null,
        batch_size: Math.max(16, Number(batchSize) || 128),
      });

      setHistory((prev) => [
        {
          id: `${Date.now()}`,
          sourceLabel: selectedSource.label,
          sourceEngine: selectedSource.engineType,
          sourceCollection,
          destKey: selectedDest.key,
          destTarget: selectedDest.target,
          destLabel: selectedDest.label,
          destEngine: selectedDest.engineType,
          destCollection: targetDestCollection,
          result: res,
          finishedAt: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);

      void refreshConnectionCollections(selectedDest.key, selectedDest.target);
      void loadDestCollections(selectedDest.target);

      if (res.failed === 0) {
        toast.success(
          `Migrated ${res.migrated.toLocaleString()} records`,
          `Moved to ${selectedDest.label} · ${targetDestCollection}`,
        );
      } else {
        toast.error(
          `Migrated ${res.migrated} with ${res.failed} failure(s)`,
          res.errors[0] ?? "Inspect migration summary for details.",
        );
      }
    } catch (err: unknown) {
      toast.error("Migration failed", formatUserError(err));
    } finally {
      setMigrating(false);
    }
  };

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <PageHeader
        icon={
          <Repeat2 className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
        }
        title="Migrations"
        badges={
          <Badge variant="accent" className="font-mono">
            {connectionOptions.length} ready connection
            {connectionOptions.length === 1 ? "" : "s"}
          </Badge>
        }
        description="Copy, filter, or re-embed vector collections across any running local runtime or remote connection."
      />

      {connectionOptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-12 text-center">
          <Repeat2 className="mb-3 h-7 w-7 text-[var(--accent-primary)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            No Ready Connections Found
          </h2>
          <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
            Start a local vector database instance in Local Runtimes or add a
            remote connection in Explorer to migrate collections.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setActiveSection("runtimes")}
            >
              Open Local Runtimes
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setActiveSection("explorer")}
            >
              Open Explorer
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Source -> Destination Configuration */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Source Card */}
            <section className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Source
                </h2>
                {activeSourceMeta && (
                  <Badge variant="default" className="font-mono text-[10px]">
                    {activeSourceMeta.dimensions ?? "?"}d ·{" "}
                    {(activeSourceMeta.vector_count ?? 0).toLocaleString()} vectors
                  </Badge>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                  Source Connection
                </label>
                <select
                  value={sourceKey}
                  disabled={migrating}
                  onChange={(e) => setSourceKey(e.target.value)}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                >
                  {connectionOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      <EngineIcon engineType={opt.engineType} size="xs" />
                      <span>{opt.label}</span>
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[11px] font-medium text-[var(--text-secondary)]">
                    Source Collection
                  </label>
                  <button
                    type="button"
                    disabled={!selectedSource || loadingSourceCols || migrating}
                    onClick={() =>
                      selectedSource &&
                      void loadSourceCollections(selectedSource.target, true)
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${loadingSourceCols ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </button>
                </div>
                <select
                  value={sourceCollection}
                  disabled={
                    migrating ||
                    loadingSourceCols ||
                    sourceCollections.length === 0
                  }
                  onChange={(e) => setSourceCollection(e.target.value)}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                >
                  {sourceCollections.length === 0 ? (
                    <option value="">
                      {loadingSourceCols
                        ? "Loading collections..."
                        : "No collections found"}
                    </option>
                  ) : (
                    sourceCollections.map((col) => (
                      <option key={col.name} value={col.name}>
                        {col.name} ({(col.vector_count ?? 0).toLocaleString()} vecs)
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60">
                <button
                  type="button"
                  onClick={() => setShowFilter((prev) => !prev)}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <span>Optional Source Filter</span>
                  {showFilter ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {showFilter && (
                  <div className="border-t border-[var(--border-subtle)] p-3">
                    <FilterBuilder value={filterSpec} onChange={setFilterSpec} />
                  </div>
                )}
              </div>
            </section>

            {/* Destination Card */}
            <section className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Destination
                </h2>
                {selectedDest?.readOnly && (
                  <Badge variant="warning">Read-Only Target</Badge>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                  Destination Connection
                </label>
                <select
                  value={destKey}
                  disabled={migrating}
                  onChange={(e) => setDestKey(e.target.value)}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                >
                  {connectionOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      <EngineIcon engineType={opt.engineType} size="xs" />
                      <span>{opt.label}</span>
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                    Target Mode
                  </label>
                  <div className="flex rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-0.5 text-[11px]">
                    <button
                      type="button"
                      disabled={migrating}
                      onClick={() => setDestMode("new")}
                      className={`flex-1 rounded py-1 font-medium cursor-pointer ${
                        destMode === "new"
                          ? "bg-[var(--accent-primary)] text-slate-950 font-semibold"
                          : "text-[var(--text-secondary)]"
                      }`}
                    >
                      Create New
                    </button>
                    <button
                      type="button"
                      disabled={migrating}
                      onClick={() => setDestMode("existing")}
                      className={`flex-1 rounded py-1 font-medium cursor-pointer ${
                        destMode === "existing"
                          ? "bg-[var(--accent-primary)] text-slate-950 font-semibold"
                          : "text-[var(--text-secondary)]"
                      }`}
                    >
                      Existing
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                    {destMode === "new"
                      ? "New Collection Name"
                      : "Existing Collection"}
                  </label>
                  {destMode === "new" ? (
                    <input
                      type="text"
                      value={destNewName}
                      disabled={migrating}
                      onChange={(e) => setDestNewName(e.target.value)}
                      placeholder="collection_migrated"
                      className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                    />
                  ) : (
                    <select
                      value={destExistingName}
                      disabled={migrating || loadingDestCols}
                      onChange={(e) => setDestExistingName(e.target.value)}
                      className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                    >
                      {destCollections.length === 0 ? (
                        <option value="">No existing collections</option>
                      ) : (
                        destCollections.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name} ({c.dimensions}d)
                          </option>
                        ))
                      )}
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                    Distance Metric
                  </label>
                  <select
                    value={destMetric}
                    disabled={migrating || destMode !== "new"}
                    onChange={(e) => setDestMetric(e.target.value)}
                    className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] disabled:opacity-60 focus:border-[var(--accent-primary)] focus:outline-none"
                  >
                    <option value="Cosine">Cosine</option>
                    <option value="Euclid">Euclidean</option>
                    <option value="Dot">Dot Product</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                    Re-Embedding
                  </label>
                  <select
                    value={reembedProfileId}
                    disabled={migrating}
                    onChange={(e) => setReembedProfileId(e.target.value)}
                    className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  >
                    <option value="">Keep Existing Vectors</option>
                    {embeddingProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.model_name})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                    Batch Size
                  </label>
                  <input
                    type="number"
                    min={16}
                    max={1000}
                    value={batchSize}
                    disabled={migrating}
                    onChange={(e) => setBatchSize(e.target.value)}
                    className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Route Banner & Action */}
          <section className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                {selectedSource && (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5">
                    <EngineIcon engineType={selectedSource.engineType} size="sm" />
                    <span className="font-semibold text-[var(--text-primary)]">
                      {sourceCollection || "Select source"}
                    </span>
                  </span>
                )}
                <ArrowRight className="h-4 w-4 text-[var(--accent-primary)]" />
                {selectedDest && (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5">
                    <EngineIcon engineType={selectedDest.engineType} size="sm" />
                    <span className="font-semibold text-[var(--text-primary)]">
                      {targetDestCollection || "Select destination"}
                    </span>
                  </span>
                )}
              </div>

              <Button
                type="button"
                disabled={!canStart}
                onClick={() => void handleStartMigration()}
              >
                {migrating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Repeat2 className="h-3.5 w-3.5" />
                )}
                {migrating ? "Migrating..." : "Start Migration"}
              </Button>
            </div>

            {migrating && (
              <div className="space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                  <span>{progress?.message ?? "Migrating records..."}</span>
                  <span className="font-mono">
                    {progress
                      ? `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()} (${progressPct}%)`
                      : "Starting..."}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                  <div
                    className="h-full bg-[var(--accent-primary)] transition-all duration-150"
                    style={{ width: `${Math.max(4, progressPct)}%` }}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Session Migration Runs */}
          {history.length > 0 && (
            <section className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Recent Migrations ({history.length})
              </h2>
              <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                {history.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      {run.result.failed === 0 ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--status-running)]" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 text-[var(--status-error)]" />
                      )}
                      <EngineIcon engineType={run.sourceEngine} size="sm" />
                      <span className="font-mono font-semibold text-[var(--text-primary)]">
                        {run.sourceCollection}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      <EngineIcon engineType={run.destEngine} size="sm" />
                      <span className="font-mono font-semibold text-[var(--text-primary)]">
                        {run.destCollection}
                      </span>
                      <Badge variant="running" className="font-mono text-[10px]">
                        {run.result.migrated.toLocaleString()} migrated
                      </Badge>
                      {run.result.failed > 0 && (
                        <Badge variant="error" className="font-mono text-[10px]">
                          {run.result.failed} failed
                        </Badge>
                      )}
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">
                        {run.finishedAt}
                      </span>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedConnectionKey(run.destKey);
                        setActiveTabId(null);
                        setActiveSection("explorer");
                        void refreshConnectionCollections(
                          run.destKey,
                          run.destTarget,
                        );
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in Explorer
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
