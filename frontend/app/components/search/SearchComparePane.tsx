import * as React from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";
import { MetadataDrawer } from "@/components/explorer/MetadataDrawer";
import { FilterBuilder } from "@/components/search/FilterBuilder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { embedTexts } from "@/ipc/connections";
import { listCollections, searchVectors } from "@/ipc/explorer";
import { formatUserError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore, type WorkspaceTab } from "@/stores/useTabsStore";
import type {
  CollectionSummary,
  ConnectionTarget,
  FilterSpec,
  VectorRecord,
} from "@/types/explorer";

interface ConnectionOption {
  key: string;
  label: string;
  target: ConnectionTarget;
}

interface ComparePanelResult {
  records: VectorRecord[];
  latencyMs: number;
  embedLatencyMs: number | null;
}

function parseVectorInput(rawText: string): number[] {
  const raw = rawText.trim();
  if (!raw) {
    throw new Error("Paste a query vector array");
  }
  const parsed = raw.startsWith("[")
    ? JSON.parse(raw)
    : raw
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((n) => typeof n !== "number" || !Number.isFinite(n))
  ) {
    throw new Error("Vector must be a non-empty array of finite floats");
  }
  return parsed;
}

function getRankDeltaBadge(
  id: string,
  indexInSelf: number,
  otherRankMap: Map<string, number>,
  otherLabel: string,
): { text: string; variant: "running" | "error" | "default" | "accent" } {
  const otherIdx = otherRankMap.get(id);
  if (otherIdx === undefined) {
    return { text: `Only ${otherLabel === "A" ? "B" : "A"}`, variant: "accent" };
  }
  const delta = otherIdx - indexInSelf;
  if (delta === 0) {
    return { text: "=", variant: "default" };
  }
  if (delta > 0) {
    return { text: `+${delta}`, variant: "running" };
  }
  return { text: `${delta}`, variant: "error" };
}

export function SearchComparePane({ tab }: { tab: WorkspaceTab }) {
  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const remoteConnections = useTabsStore((s) => s.remoteConnections);
  const embeddingProfiles = useTabsStore((s) => s.embeddingProfiles);
  const collectionsByConnection = useTabsStore(
    (s) => s.collectionsByConnection,
  );
  const openSearchTab = useTabsStore((s) => s.openSearchTab);

  const connectionOptions = React.useMemo<ConnectionOption[]>(() => {
    const opts: ConnectionOption[] = [];
    for (const inst of instances) {
      const st = metrics[inst.id]?.status ?? "stopped";
      const ready = st === "running" || st === "embedded" || inst.engine_type === "lancedb";
      if (!ready) continue;
      opts.push({
        key: `local:${inst.id}`,
        label: `${inst.name} (${inst.engine_type})`,
        target: { kind: "local_instance", instance_id: inst.id },
      });
    }
    for (const conn of remoteConnections) {
      opts.push({
        key: `remote:${conn.id}`,
        label: `${conn.name} (${conn.engine_type})`,
        target: { kind: "remote_connection", connection_id: conn.id },
      });
    }
    return opts;
  }, [instances, metrics, remoteConnections]);

  const [mode, setMode] = React.useState<"text" | "vector">(tab.searchMode);
  const [queryText, setQueryText] = React.useState(tab.searchText);
  const [vectorText, setVectorText] = React.useState(tab.searchVectorText);
  const [topK, setTopK] = React.useState(tab.searchTopK);

  // Panel A state (defaults to active tab)
  const [connKeyA, setConnKeyA] = React.useState(tab.connectionKey);
  const [collectionA, setCollectionA] = React.useState(tab.collection ?? "");
  const [collectionsA, setCollectionsA] = React.useState<CollectionSummary[]>(
    collectionsByConnection[tab.connectionKey] ?? [],
  );
  const [profileA, setProfileA] = React.useState(
    tab.searchProfileId || embeddingProfiles[0]?.id || "",
  );
  const [filterA, setFilterA] = React.useState<FilterSpec | null>(tab.filter);
  const [showFilterA, setShowFilterA] = React.useState(false);

  // Panel B state (defaults to same connection/collection or second collection if available)
  const [connKeyB, setConnKeyB] = React.useState(tab.connectionKey);
  const [collectionB, setCollectionB] = React.useState(tab.collection ?? "");
  const [collectionsB, setCollectionsB] = React.useState<CollectionSummary[]>(
    collectionsByConnection[tab.connectionKey] ?? [],
  );
  const [profileB, setProfileB] = React.useState(
    embeddingProfiles[1]?.id || tab.searchProfileId || embeddingProfiles[0]?.id || "",
  );
  const [filterB, setFilterB] = React.useState<FilterSpec | null>(null);
  const [showFilterB, setShowFilterB] = React.useState(false);

  const [running, setRunning] = React.useState(false);
  const [resultA, setResultA] = React.useState<ComparePanelResult | null>(null);
  const [resultB, setResultB] = React.useState<ComparePanelResult | null>(null);
  const [inspectedRecord, setInspectedRecord] =
    React.useState<VectorRecord | null>(null);

  const loadColsForKey = React.useCallback(
    async (
      key: string,
      setList: React.Dispatch<React.SetStateAction<CollectionSummary[]>>,
      setSelected: React.Dispatch<React.SetStateAction<string>>,
      preferred?: string,
    ) => {
      const cached = collectionsByConnection[key];
      if (cached && cached.length > 0) {
        setList(cached);
        if (!preferred || !cached.some((c) => c.name === preferred)) {
          setSelected(cached[0].name);
        }
        return;
      }
      const opt = connectionOptions.find((o) => o.key === key);
      if (!opt) return;
      try {
        const list = await listCollections(opt.target);
        setList(list);
        if (list.length > 0 && (!preferred || !list.some((c) => c.name === preferred))) {
          setSelected(list[0].name);
        }
      } catch {
        setList([]);
      }
    },
    [collectionsByConnection, connectionOptions],
  );

  React.useEffect(() => {
    void loadColsForKey(connKeyA, setCollectionsA, setCollectionA, collectionA);
  }, [connKeyA]);

  React.useEffect(() => {
    void loadColsForKey(connKeyB, setCollectionsB, setCollectionB, collectionB);
  }, [connKeyB]);

  const resolveTarget = (key: string): ConnectionTarget | null => {
    if (key === tab.connectionKey && tab.target) return tab.target;
    return connectionOptions.find((o) => o.key === key)?.target ?? null;
  };

  const handleRunCompare = async () => {
    const targetA = resolveTarget(connKeyA);
    const targetB = resolveTarget(connKeyB);
    if (!targetA || !collectionA || !targetB || !collectionB || running) {
      toast.error("Select valid collections for both Panel A and Panel B");
      return;
    }

    setRunning(true);
    try {
      let vecA: number[];
      let vecB: number[];
      let embedMsA: number | null = null;
      let embedMsB: number | null = null;

      if (mode === "text") {
        if (!queryText.trim()) {
          toast.error("Enter a search query string");
          setRunning(false);
          return;
        }
        if (!profileA || !profileB) {
          toast.error("Select embedding profiles for both panels");
          setRunning(false);
          return;
        }
        if (profileA === profileB) {
          const [vecs, ms] = await embedTexts(profileA, [queryText]);
          if (!vecs[0]?.length) {
            throw new Error("Embedding provider returned an empty vector");
          }
          vecA = vecs[0];
          vecB = vecs[0];
          embedMsA = ms;
          embedMsB = ms;
        } else {
          const [[vecsA, msA], [vecsB, msB]] = await Promise.all([
            embedTexts(profileA, [queryText]),
            embedTexts(profileB, [queryText]),
          ]);
          if (!vecsA[0]?.length || !vecsB[0]?.length) {
            throw new Error("Embedding provider returned an empty vector");
          }
          vecA = vecsA[0];
          vecB = vecsB[0];
          embedMsA = msA;
          embedMsB = msB;
        }
      } else {
        const parsed = parseVectorInput(vectorText);
        vecA = parsed;
        vecB = parsed;
      }

      const [respA, respB] = await Promise.all([
        searchVectors(targetA, collectionA, {
          vector: vecA,
          top_k: topK,
          include_vectors: tab.includeVectors,
          filter: filterA,
        }),
        searchVectors(targetB, collectionB, {
          vector: vecB,
          top_k: topK,
          include_vectors: tab.includeVectors,
          filter: filterB,
        }),
      ]);

      setResultA({
        records: respA.records,
        latencyMs: respA.latency_ms,
        embedLatencyMs: embedMsA,
      });
      setResultB({
        records: respB.records,
        latencyMs: respB.latency_ms,
        embedLatencyMs: embedMsB,
      });
    } catch (err: unknown) {
      toast.error("Compare search failed", formatUserError(err));
    } finally {
      setRunning(false);
    }
  };

  const rankMapA = React.useMemo(() => {
    const map = new Map<string, number>();
    resultA?.records.forEach((r, idx) => map.set(r.id, idx));
    return map;
  }, [resultA]);

  const rankMapB = React.useMemo(() => {
    const map = new Map<string, number>();
    resultB?.records.forEach((r, idx) => map.set(r.id, idx));
    return map;
  }, [resultB]);

  const metricsSummary = React.useMemo(() => {
    if (!resultA || !resultB) return null;
    const idsA = new Set(resultA.records.map((r) => r.id));
    const idsB = new Set(resultB.records.map((r) => r.id));
    let overlap = 0;
    for (const id of idsA) {
      if (idsB.has(id)) overlap += 1;
    }
    const union = new Set([...idsA, ...idsB]).size;
    const jaccardPct = union > 0 ? Math.round((overlap / union) * 100) : 0;
    const maxCount = Math.max(resultA.records.length, resultB.records.length);
    const latencyDelta = resultB.latencyMs - resultA.latencyMs;
    return { overlap, maxCount, jaccardPct, latencyDelta };
  }, [resultA, resultB]);

  const renderPanelConfig = (
    label: "A" | "B",
    connKey: string,
    setConnKey: (v: string) => void,
    collection: string,
    setCollection: (v: string) => void,
    collections: CollectionSummary[],
    profileId: string,
    setProfileId: (v: string) => void,
    filter: FilterSpec | null,
    setFilter: (v: FilterSpec | null) => void,
    showFilter: boolean,
    setShowFilter: React.Dispatch<React.SetStateAction<boolean>>,
  ) => (
    <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={label === "A" ? "accent" : "ai"}>Panel {label}</Badge>
        <button
          type="button"
          onClick={() => setShowFilter((v) => !v)}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          {filter ? "Filter (active)" : "Filter"}
          {showFilter ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select
          value={connKey}
          onChange={(e) => setConnKey(e.target.value)}
          className="h-8 w-full min-w-0 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:outline-none"
        >
          {connectionOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
          className="h-8 w-full min-w-0 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:outline-none"
        >
          {collections.length === 0 ? (
            <option value={collection}>{collection || "No collections"}</option>
          ) : (
            collections.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))
          )}
        </select>
      </div>

      {mode === "text" && (
        <select
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:outline-none"
        >
          {embeddingProfiles.length === 0 ? (
            <option value="">No embedding profile</option>
          ) : (
            embeddingProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.model_name})
              </option>
            ))
          )}
        </select>
      )}

      {showFilter && <FilterBuilder value={filter} onChange={setFilter} />}
    </div>
  );

  const renderResultList = (
    label: "A" | "B",
    res: ComparePanelResult | null,
    otherRankMap: Map<string, number>,
  ) => (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs">
        <span className="font-semibold text-[var(--text-primary)]">
          Panel {label} Results
        </span>
        {res && (
          <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--text-secondary)]">
            <span>{res.records.length} hits</span>
            <span>·</span>
            <span>{res.latencyMs} ms DB</span>
            {res.embedLatencyMs != null && (
              <>
                <span>·</span>
                <span>{res.embedLatencyMs} ms embed</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto">
        {!res ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)]">
            {running ? "Running comparison..." : "Run Compare to see hits."}
          </div>
        ) : res.records.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)]">
            No hits returned.
          </div>
        ) : (
          res.records.map((rec, idx) => {
            const delta = getRankDeltaBadge(
              rec.id,
              idx,
              otherRankMap,
              label === "A" ? "B" : "A",
            );
            return (
              <button
                key={rec.id}
                type="button"
                onClick={() => setInspectedRecord(rec)}
                className="flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-elevated)]/60 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-[var(--text-muted)]">
                      #{idx + 1}
                    </span>
                    <span className="truncate font-mono text-[11px] font-medium text-[var(--accent-secondary)]">
                      {rec.id}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {rec.score != null && (
                      <span className="font-mono text-[11px] text-[var(--text-primary)]">
                        {rec.score.toFixed(4)}
                      </span>
                    )}
                    <Badge
                      variant={delta.variant}
                      className="font-mono text-[10px]"
                    >
                      {delta.text}
                    </Badge>
                  </div>
                </div>
                {rec.document && (
                  <div className="line-clamp-2 text-xs text-[var(--text-primary)]">
                    {rec.document}
                  </div>
                )}
                <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                  {JSON.stringify(rec.payload ?? {})}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="space-y-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="ai">
              <ArrowLeftRight className="h-3 w-3" />
              A/B Search Comparison
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMode("text")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium cursor-pointer",
                  mode === "text"
                    ? "bg-[var(--accent-ai)] text-white"
                    : "text-[var(--text-secondary)]",
                )}
              >
                Semantic Text
              </button>
              <button
                type="button"
                onClick={() => setMode("vector")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium cursor-pointer",
                  mode === "vector"
                    ? "bg-[var(--accent-primary)] text-slate-950 font-semibold"
                    : "text-[var(--text-secondary)]",
                )}
              >
                Raw Vector
              </button>
            </div>

            <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <span>Top-K:</span>
              <input
                type="number"
                min={1}
                max={200}
                value={topK}
                onChange={(e) => setTopK(Math.max(1, Number(e.target.value)))}
                className="h-8 w-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-xs text-[var(--text-primary)] focus:outline-none"
              />
            </label>

            <Button
              type="button"
              size="sm"
              disabled={running}
              onClick={() => void handleRunCompare()}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              Run Compare
            </Button>
          </div>
        </div>

        {mode === "text" ? (
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void handleRunCompare();
              }
            }}
            placeholder="Shared search query for Panel A & Panel B (Ctrl+Enter to compare)..."
            className="h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
          />
        ) : (
          <textarea
            rows={2}
            value={vectorText}
            onChange={(e) => setVectorText(e.target.value)}
            placeholder="Shared float vector array e.g. [0.021, -0.14, 0.88, ...]"
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 font-mono text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
          />
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {renderPanelConfig(
            "A",
            connKeyA,
            setConnKeyA,
            collectionA,
            setCollectionA,
            collectionsA,
            profileA,
            setProfileA,
            filterA,
            setFilterA,
            showFilterA,
            setShowFilterA,
          )}
          {renderPanelConfig(
            "B",
            connKeyB,
            setConnKeyB,
            collectionB,
            setCollectionB,
            collectionsB,
            profileB,
            setProfileB,
            filterB,
            setFilterB,
            showFilterB,
            setShowFilterB,
          )}
        </div>

        {metricsSummary && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
              Comparison Metrics:
            </span>
            <Badge variant="accent" className="font-mono">
              Overlap: {metricsSummary.overlap}/{metricsSummary.maxCount}
            </Badge>
            <Badge variant="ai" className="font-mono">
              Jaccard: {metricsSummary.jaccardPct}%
            </Badge>
            <Badge
              variant={
                metricsSummary.latencyDelta <= 0 ? "running" : "warning"
              }
              className="font-mono"
            >
              Latency delta (B - A):{" "}
              {metricsSummary.latencyDelta >= 0
                ? `+${metricsSummary.latencyDelta}`
                : metricsSummary.latencyDelta}{" "}
              ms
            </Badge>
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden bg-[var(--bg-canvas)] p-4 lg:grid-cols-2">
        {renderResultList("A", resultA, rankMapB)}
        {renderResultList("B", resultB, rankMapA)}
      </div>

      <MetadataDrawer
        record={inspectedRecord}
        readOnly
        onClose={() => setInspectedRecord(null)}
        onFindSimilar={(rec) => {
          if (!tab.target || !tab.collection) return;
          setInspectedRecord(null);
          openSearchTab(
            tab.connectionKey,
            tab.target,
            tab.collection,
            tab.collection,
            rec,
          );
        }}
      />
    </div>
  );
}
