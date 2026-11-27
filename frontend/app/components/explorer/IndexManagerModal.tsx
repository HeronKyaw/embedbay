import * as React from "react";
import {
  DatabaseZap,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  createCollectionIndex,
  deleteCollectionIndex,
  listCollectionIndexes,
} from "@/ipc/explorer";
import { formatUserError } from "@/lib/errors";
import type {
  CollectionIndexInfo,
  CollectionSchema,
  ConnectionTarget,
} from "@/types/explorer";

const QDRANT_INDEX_TYPES = [
  "keyword",
  "integer",
  "float",
  "bool",
  "geo",
  "datetime",
  "text",
] as const;

export function IndexManagerModal({
  open,
  onOpenChange,
  target,
  collection,
  engineType,
  schema,
  readOnly = false,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ConnectionTarget | null;
  collection: string | null;
  engineType: string;
  schema: CollectionSchema | null;
  readOnly?: boolean;
  onChanged?: () => void;
}) {
  const isPg = engineType.toLowerCase() === "pgvector";
  const [indexes, setIndexes] = React.useState<CollectionIndexInfo[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [confirmDropName, setConfirmDropName] = React.useState<string | null>(
    null,
  );
  const [dropping, setDropping] = React.useState(false);

  // Qdrant form
  const [qdrantField, setQdrantField] = React.useState("");
  const [qdrantType, setQdrantType] = React.useState<string>("keyword");

  // pgvector form
  const [pgMethod, setPgMethod] = React.useState<"hnsw" | "ivfflat">("hnsw");
  const [pgColumn, setPgColumn] = React.useState("embedding");
  const [pgOps, setPgOps] = React.useState("vector_cosine_ops");
  const [pgIndexName, setPgIndexName] = React.useState("");
  const [pgM, setPgM] = React.useState("16");
  const [pgEfConstruction, setPgEfConstruction] = React.useState("64");
  const [pgLists, setPgLists] = React.useState("100");

  const loadIndexes = React.useCallback(async (manual = false) => {
    if (!open || !target || !collection) return;
    setLoading(true);
    const minSpin = manual
      ? new Promise((resolve) => window.setTimeout(resolve, 400))
      : Promise.resolve();
    try {
      const [list] = await Promise.all([
        listCollectionIndexes(target, collection),
        minSpin,
      ]);
      setIndexes(list);
    } catch (err: unknown) {
      toast.error("Failed to load indexes", formatUserError(err));
    } finally {
      setLoading(false);
    }
  }, [open, target, collection]);

  const wasOpenRef = React.useRef(false);

  React.useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setQdrantField("");
    setQdrantType("keyword");
    setPgMethod("hnsw");
    setPgColumn(schema?.vector_field_name || "embedding");
    setPgOps("vector_cosine_ops");
    setPgIndexName("");
    setPgM("16");
    setPgEfConstruction("64");
    setPgLists("100");
    setConfirmDropName(null);
    void loadIndexes();
  }, [open, schema, loadIndexes]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !collection || creating || readOnly) return;

    setCreating(true);
    try {
      if (isPg) {
        const params: Record<string, unknown> = { ops: pgOps };
        if (pgIndexName.trim()) {
          params.name = pgIndexName.trim();
        }
        if (pgMethod === "hnsw") {
          const m = Number(pgM);
          const ef = Number(pgEfConstruction);
          if (Number.isInteger(m) && m > 0) params.m = m;
          if (Number.isInteger(ef) && ef > 0) params.ef_construction = ef;
        } else {
          const lists = Number(pgLists);
          if (Number.isInteger(lists) && lists > 0) params.lists = lists;
        }
        await createCollectionIndex(target, collection, {
          field_name: pgColumn.trim() || "embedding",
          index_type: pgMethod,
          params,
        });
        toast.success(`Created ${pgMethod.toUpperCase()} index`);
        setPgIndexName("");
      } else {
        if (!qdrantField.trim()) {
          toast.error("Payload field name is required");
          setCreating(false);
          return;
        }
        await createCollectionIndex(target, collection, {
          field_name: qdrantField.trim(),
          index_type: qdrantType,
          params: {},
        });
        toast.success(
          `Created ${qdrantType} index on "${qdrantField.trim()}"`,
        );
        setQdrantField("");
      }
      await loadIndexes();
      onChanged?.();
    } catch (err: unknown) {
      toast.error("Failed to create index", formatUserError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!target || !collection || !confirmDropName || dropping || readOnly) {
      return;
    }
    setDropping(true);
    try {
      await deleteCollectionIndex(target, collection, confirmDropName);
      toast.info(`Dropped index "${confirmDropName}"`);
      setConfirmDropName(null);
      await loadIndexes();
      onChanged?.();
    } catch (err: unknown) {
      toast.error("Failed to delete index", formatUserError(err));
    } finally {
      setDropping(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<DatabaseZap className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />}
      title={`Indexes · ${collection ?? ""}`}
      description={
        isPg
          ? "Inspect, create, or drop pgvector HNSW and IVFFlat indexes."
          : "Manage Qdrant payload field indexes for fast filtered vector search."
      }
      maxWidthClass="w-[min(92vw,640px)]"
    >
      <div className="space-y-4">
        {readOnly && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--status-starting)]/40 bg-[var(--status-starting)]/10 px-3 py-2 text-xs text-[var(--status-starting)]">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span>
              Read-Only Mode active: index creation and deletion are disabled.
            </span>
          </div>
        )}

        {/* Existing Indexes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Active Indexes ({indexes.length})
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => void loadIndexes(true)}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>

          <div className="max-h-56 divide-y divide-[var(--border-subtle)] overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {loading && indexes.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--text-muted)]">
                Loading indexes...
              </div>
            ) : indexes.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--text-muted)]">
                No indexes configured on this collection.
              </div>
            ) : (
              indexes.map((idx) => (
                <div
                  key={idx.name}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono font-semibold text-[var(--text-primary)]">
                        {idx.name}
                      </span>
                      <Badge variant="accent" className="font-mono text-[10px]">
                        {idx.index_type}
                      </Badge>
                      {idx.field_name && idx.field_name !== idx.name && (
                        <Badge variant="default" className="font-mono text-[10px]">
                          col: {idx.field_name}
                        </Badge>
                      )}
                      {idx.status && (
                        <Badge variant="ai" className="font-mono text-[10px]">
                          {idx.status}
                        </Badge>
                      )}
                    </div>
                    {idx.params && Object.keys(idx.params).length > 0 && (
                      <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                        {JSON.stringify(idx.params)}
                      </div>
                    )}
                  </div>

                  {confirmDropName === idx.name ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        disabled={dropping || readOnly}
                        onClick={() => void handleConfirmDelete()}
                      >
                        {dropping ? "Dropping..." : "Confirm Drop"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setConfirmDropName(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={readOnly}
                      title={
                        readOnly ? "Disabled in Read-Only mode" : "Drop index"
                      }
                      onClick={() => setConfirmDropName(idx.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Create Index Form */}
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5"
        >
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            {isPg ? "Create Vector Index" : "Create Payload Field Index"}
          </div>

          {isPg ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                    Method
                  </label>
                  <select
                    value={pgMethod}
                    disabled={readOnly}
                    onChange={(e) =>
                      setPgMethod(e.target.value as "hnsw" | "ivfflat")
                    }
                    className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs"
                  >
                    <option value="hnsw">HNSW</option>
                    <option value="ivfflat">IVFFlat</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                    Vector Column
                  </label>
                  <input
                    type="text"
                    value={pgColumn}
                    disabled={readOnly}
                    onChange={(e) => setPgColumn(e.target.value)}
                    className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                    Operator Class
                  </label>
                  <select
                    value={pgOps}
                    disabled={readOnly}
                    onChange={(e) => setPgOps(e.target.value)}
                    className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px]"
                  >
                    <option value="vector_cosine_ops">vector_cosine_ops</option>
                    <option value="vector_l2_ops">vector_l2_ops</option>
                    <option value="vector_ip_ops">vector_ip_ops</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                    Index Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={pgIndexName}
                    disabled={readOnly}
                    onChange={(e) => setPgIndexName(e.target.value)}
                    placeholder="Auto-generated"
                    className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                  />
                </div>
                {pgMethod === "hnsw" ? (
                  <>
                    <div>
                      <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                        m (2–128)
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={128}
                        value={pgM}
                        disabled={readOnly}
                        onChange={(e) => setPgM(e.target.value)}
                        className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                        ef_construction (4–1000)
                      </label>
                      <input
                        type="number"
                        min={4}
                        max={1000}
                        value={pgEfConstruction}
                        disabled={readOnly}
                        onChange={(e) => setPgEfConstruction(e.target.value)}
                        className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                      lists (1–65536)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={65536}
                      value={pgLists}
                      disabled={readOnly}
                      onChange={(e) => setPgLists(e.target.value)}
                      className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_160px]">
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                  Payload Field Name
                </label>
                <input
                  type="text"
                  value={qdrantField}
                  disabled={readOnly}
                  onChange={(e) => setQdrantField(e.target.value)}
                  placeholder="e.g. topic, year, tenant_id"
                  className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                  Field Schema Type
                </label>
                <select
                  value={qdrantType}
                  disabled={readOnly}
                  onChange={(e) => setQdrantType(e.target.value)}
                  className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                >
                  {QDRANT_INDEX_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <Button
              type="submit"
              size="sm"
              disabled={readOnly || creating || (!isPg && !qdrantField.trim())}
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Create Index
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
