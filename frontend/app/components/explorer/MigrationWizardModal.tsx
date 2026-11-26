import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Repeat2,
} from "lucide-react";
import { FilterBuilder } from "@/components/search/FilterBuilder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { listCollections } from "@/ipc/explorer";
import { isTauriRuntime } from "@/ipc/system";
import {
  migrateCollection,
  type MigrationResult,
  type TransferProgressEvent,
} from "@/ipc/transfer";
import { formatUserError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type {
  CollectionSchema,
  CollectionSummary,
  ConnectionTarget,
  FilterSpec,
} from "@/types/explorer";

interface DestConnectionOption {
  key: string;
  label: string;
  readOnly: boolean;
  target: ConnectionTarget;
}

export function MigrationWizardModal({
  open,
  onOpenChange,
  sourceTarget,
  sourceCollection,
  sourceSchema,
  onMigrated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceTarget: ConnectionTarget | null;
  sourceCollection: string | null;
  sourceSchema?: CollectionSchema | null;
  onMigrated?: (destKey: string, destTarget: ConnectionTarget) => void;
}) {
  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const remoteConnections = useTabsStore((s) => s.remoteConnections);
  const embeddingProfiles = useTabsStore((s) => s.embeddingProfiles);
  const collectionsByConnection = useTabsStore(
    (s) => s.collectionsByConnection,
  );

  const destOptions = React.useMemo<DestConnectionOption[]>(() => {
    const out: DestConnectionOption[] = [];
    for (const inst of instances) {
      const st = metrics[inst.id]?.status ?? "stopped";
      const ready =
        st === "running" ||
        st === "embedded" ||
        inst.engine_type === "lancedb";
      if (!ready) continue;
      out.push({
        key: `local:${inst.id}`,
        label: `${inst.name} (${inst.engine_type.toUpperCase()})`,
        readOnly: false,
        target: { kind: "local_instance", instance_id: inst.id },
      });
    }
    for (const conn of remoteConnections) {
      out.push({
        key: `remote:${conn.id}`,
        label: `${conn.name} (${conn.engine_type.toUpperCase()}${conn.read_only ? " · Read-Only" : ""})`,
        readOnly: Boolean(conn.read_only),
        target: { kind: "remote_connection", connection_id: conn.id },
      });
    }
    return out;
  }, [instances, metrics, remoteConnections]);

  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [filter, setFilter] = React.useState<FilterSpec | null>(null);
  const [maxRecords, setMaxRecords] = React.useState(50000);
  const [batchSize, setBatchSize] = React.useState(100);

  const [destKey, setDestKey] = React.useState("");
  const [destCollections, setDestCollections] = React.useState<
    CollectionSummary[]
  >([]);
  const [destCollection, setDestCollection] = React.useState("");
  const [createIfMissing, setCreateIfMissing] = React.useState(true);
  const [destMetric, setDestMetric] = React.useState("cosine");
  const [destDimensions, setDestDimensions] = React.useState("");
  const [reembedProfileId, setReembedProfileId] = React.useState("");
  const [reembedTextField, setReembedTextField] = React.useState("");

  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] =
    React.useState<TransferProgressEvent | null>(null);
  const [result, setResult] = React.useState<MigrationResult | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);

  const wasOpenRef = React.useRef(false);
  const destOptionsRef = React.useRef(destOptions);
  destOptionsRef.current = destOptions;

  React.useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setStep(1);
    setFilter(null);
    setMaxRecords(50000);
    setBatchSize(100);
    const firstWritable = destOptionsRef.current.find((d) => !d.readOnly);
    setDestKey(firstWritable?.key ?? "");
    setDestCollection(sourceCollection ? `${sourceCollection}_migrated` : "");
    setCreateIfMissing(true);
    setDestMetric(sourceSchema?.distance_metric?.toLowerCase() || "cosine");
    setDestDimensions(
      sourceSchema?.dimensions ? String(sourceSchema.dimensions) : "",
    );
    setReembedProfileId("");
    setReembedTextField("");
    setRunning(false);
    setProgress(null);
    setResult(null);
    setErrorMsg(null);
    setShowErrors(false);
  }, [open, sourceCollection, sourceSchema]);

  React.useEffect(() => {
    if (!open || !destKey) return;
    const cached = collectionsByConnection[destKey];
    if (cached) {
      setDestCollections(cached);
      return;
    }
    const opt = destOptionsRef.current.find((d) => d.key === destKey);
    if (!opt) return;
    void listCollections(opt.target)
      .then((cols) => setDestCollections(cols))
      .catch(() => setDestCollections([]));
  }, [open, destKey, collectionsByConnection]);

  React.useEffect(() => {
    if (!open || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen<TransferProgressEvent>("transfer-progress", (e) => {
      if (e.payload.kind === "migrate") {
        setProgress(e.payload);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [open]);

  const selectedDest = destOptions.find((d) => d.key === destKey) ?? null;

  const handleStartMigration = async () => {
    if (!sourceTarget || !sourceCollection || !selectedDest || selectedDest.readOnly) {
      return;
    }
    if (!destCollection.trim()) {
      toast.error("Enter a destination collection name");
      return;
    }

    setStep(3);
    setRunning(true);
    setProgress(null);
    setResult(null);
    setErrorMsg(null);

    try {
      const dimsParsed = destDimensions.trim()
        ? Number(destDimensions.trim())
        : null;
      const res = await migrateCollection({
        source_target: sourceTarget,
        source_collection: sourceCollection,
        dest_target: selectedDest.target,
        dest_collection: destCollection.trim(),
        create_dest_if_missing: createIfMissing,
        dest_dimensions:
          dimsParsed && Number.isInteger(dimsParsed) && dimsParsed > 0
            ? dimsParsed
            : null,
        dest_distance_metric: destMetric,
        filter,
        reembed_profile_id: reembedProfileId || null,
        reembed_text_field: reembedTextField.trim() || null,
        batch_size: batchSize,
        max_records: maxRecords,
      });
      setResult(res);
      toast.success(
        `Migrated ${res.migrated} record(s)`,
        res.failed > 0 ? `${res.failed} failed` : undefined,
      );
      onMigrated?.(selectedDest.key, selectedDest.target);
    } catch (err: unknown) {
      const msg = formatUserError(err);
      setErrorMsg(msg);
      toast.error("Migration failed", msg);
    } finally {
      setRunning(false);
    }
  };

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!running) onOpenChange(next);
      }}
      icon={<Repeat2 className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />}
      title={`Migrate Collection · ${sourceCollection ?? ""}`}
      description="Copy records across instances or engines, with optional filtering and batch re-embedding."
      maxWidthClass="w-[min(92vw,620px)]"
    >
      <div className="space-y-4">
        {/* Stepper Indicator */}
        <div className="flex items-center gap-2 text-[11px]">
          {[
            { num: 1, label: "1. Source & Filter" },
            { num: 2, label: "2. Destination & Re-Embed" },
            { num: 3, label: "3. Progress" },
          ].map((s) => (
            <div
              key={s.num}
              className={cn(
                "flex-1 rounded-md border px-2.5 py-1.5 text-center font-medium",
                step === s.num
                  ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
                  : step > s.num
                    ? "border-[var(--status-running)]/40 bg-[var(--status-running)]/10 text-[var(--status-running)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)]",
              )}
            >
              {s.label}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[var(--text-primary)]">
                  Source: {sourceCollection}
                </span>
                {sourceSchema && (
                  <>
                    <Badge variant="accent" className="font-mono text-[10px]">
                      {sourceSchema.vector_count.toLocaleString()} records
                    </Badge>
                    {sourceSchema.dimensions != null && (
                      <Badge variant="default" className="font-mono text-[10px]">
                        {sourceSchema.dimensions} dims
                      </Badge>
                    )}
                    {sourceSchema.distance_metric && (
                      <Badge variant="default" className="uppercase text-[10px]">
                        {sourceSchema.distance_metric}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>

            <FilterBuilder value={filter} onChange={setFilter} />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                  Max Records
                </label>
                <input
                  type="number"
                  min={1}
                  max={500000}
                  value={maxRecords}
                  onChange={(e) => setMaxRecords(Number(e.target.value))}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                  Batch Size (10–500)
                </label>
                <input
                  type="number"
                  min={10}
                  max={500}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => setStep(2)}>
                Next: Destination
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                Destination Connection
              </label>
              <select
                value={destKey}
                onChange={(e) => setDestKey(e.target.value)}
                className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)]"
              >
                {destOptions.length === 0 ? (
                  <option value="">No writable running instances</option>
                ) : (
                  destOptions.map((opt) => (
                    <option
                      key={opt.key}
                      value={opt.key}
                      disabled={opt.readOnly}
                    >
                      {opt.label}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                Destination Collection Name
              </label>
              <input
                type="text"
                list="migration-dest-cols"
                value={destCollection}
                onChange={(e) => setDestCollection(e.target.value)}
                placeholder="e.g. docs_v2"
                className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)]"
              />
              <datalist id="migration-dest-cols">
                {destCollections.map((c) => (
                  <option key={c.name} value={c.name} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <label className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={createIfMissing}
                  onChange={(e) => setCreateIfMissing(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
                />
                <span>Create destination collection automatically if missing</span>
              </label>

              {createIfMissing && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                      Distance Metric
                    </label>
                    <select
                      value={destMetric}
                      onChange={(e) => setDestMetric(e.target.value)}
                      className="h-7 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs"
                    >
                      <option value="cosine">Cosine</option>
                      <option value="dot">Dot Product</option>
                      <option value="euclidean">Euclidean (L2)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                      Dimensions Override (Optional)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={destDimensions}
                      onChange={(e) => setDestDimensions(e.target.value)}
                      placeholder="Auto-detect"
                      className="h-7 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                  Re-embed with Profile (Optional)
                </label>
                <select
                  value={reembedProfileId}
                  onChange={(e) => setReembedProfileId(e.target.value)}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="">Copy existing vectors as-is</option>
                  {embeddingProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.model_name}
                      {p.dimensions ? ` · ${p.dimensions}d` : ""})
                    </option>
                  ))}
                </select>
              </div>

              {reembedProfileId && (
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                    Payload Text Field Override (default: document / text)
                  </label>
                  <input
                    type="text"
                    value={reembedTextField}
                    onChange={(e) => setReembedTextField(e.target.value)}
                    placeholder="e.g. content or body"
                    className="h-7 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep(1)}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={
                  !selectedDest ||
                  selectedDest.readOnly ||
                  !destCollection.trim()
                }
                onClick={() => void handleStartMigration()}
              >
                Start Migration
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {running && (
              <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-primary)]" />
                    {progress?.message ?? "Migrating records..."}
                  </span>
                  {progress && (
                    <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                      {progress.processed} / {progress.total} ({pct}%)
                    </span>
                  )}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-canvas)]">
                  <div
                    className="h-full bg-[var(--accent-primary)] transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 p-3 text-xs text-[var(--status-error)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {result && (
              <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--status-running)]">
                  <CheckCircle2 className="h-4 w-4" />
                  Migration Complete
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="running" className="font-mono">
                    Migrated: {result.migrated}
                  </Badge>
                  <Badge variant="default" className="font-mono">
                    Skipped: {result.skipped}
                  </Badge>
                  <Badge
                    variant={result.failed > 0 ? "error" : "default"}
                    className="font-mono"
                  >
                    Failed: {result.failed}
                  </Badge>
                </div>

                {result.errors.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowErrors((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--status-error)] hover:underline cursor-pointer"
                    >
                      {showErrors ? "Hide" : "Show"} {result.errors.length}{" "}
                      error(s)
                      {showErrors ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                    {showErrors && (
                      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border border-[var(--status-error)]/30 bg-[var(--bg-canvas)] p-2 font-mono text-[10px] text-[var(--status-error)]">
                        {result.errors.map((err, i) => (
                          <div key={i}>{err}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
              <Button
                type="button"
                size="sm"
                disabled={running}
                onClick={() => onOpenChange(false)}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
