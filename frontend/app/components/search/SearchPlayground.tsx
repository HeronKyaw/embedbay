import * as React from "react";
import {
  ArrowLeftRight,
  Bookmark,
  BookmarkPlus,
  Code2,
  Download,
  History,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { MetadataDrawer } from "@/components/explorer/MetadataDrawer";
import { RecordTable } from "@/components/explorer/RecordTable";
import { SnippetModal } from "@/components/explorer/SnippetModal";
import { EmbeddingProfilesPanel } from "@/components/search/EmbeddingProfilesPanel";
import { FilterBuilder } from "@/components/search/FilterBuilder";
import { ScoreChart } from "@/components/search/ScoreChart";
import { SearchComparePane } from "@/components/search/SearchComparePane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { embedTexts } from "@/ipc/connections";
import {
  clearSearchHistory,
  deleteRecords,
  deleteSearchPreset,
  listSearchHistory,
  listSearchPresets,
  recordSearchHistory,
  saveSearchPreset,
  searchVectors,
  upsertRecords,
} from "@/ipc/explorer";
import { isTauriRuntime } from "@/ipc/system";
import { generateSearchSnippets } from "@/lib/snippets";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore, type WorkspaceTab } from "@/stores/useTabsStore";
import type {
  FilterSpec,
  SearchHistoryItem,
  SearchPreset,
  VectorRecord,
} from "@/types/explorer";

function parseStoredFilter(raw: string | null): FilterSpec | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FilterSpec;
  } catch {
    return null;
  }
}

export function SearchPlayground({
  tab,
  readOnly = false,
  onExportSearchResults,
}: {
  tab: WorkspaceTab;
  readOnly?: boolean;
  onExportSearchResults?: (records: VectorRecord[]) => void;
}) {
  const instances = useRuntimeStore((s) => s.instances);
  const remoteConnections = useTabsStore((s) => s.remoteConnections);
  const embeddingProfiles = useTabsStore((s) => s.embeddingProfiles);
  const updateTab = useTabsStore((s) => s.updateTab);
  const openSearchTab = useTabsStore((s) => s.openSearchTab);

  const [running, setRunning] = React.useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = React.useState(false);
  const [snippetOpen, setSnippetOpen] = React.useState(false);
  const [compareMode, setCompareMode] = React.useState(false);

  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  const [savePresetOpen, setSavePresetOpen] = React.useState(false);
  const [presetName, setPresetName] = React.useState("");
  const [historyItems, setHistoryItems] = React.useState<SearchHistoryItem[]>(
    [],
  );
  const [presetItems, setPresetItems] = React.useState<SearchPreset[]>([]);

  const activeProfileId =
    tab.searchProfileId || embeddingProfiles[0]?.id || "";
  const selectedIndex = tab.selectedRecord
    ? tab.searchResults.findIndex((r) => r.id === tab.selectedRecord?.id)
    : -1;

  const refreshMeta = React.useCallback(async () => {
    if (!tab.connectionKey || !tab.collection || !isTauriRuntime()) return;
    try {
      const [hist, presets] = await Promise.all([
        listSearchHistory(tab.connectionKey, tab.collection, 50),
        listSearchPresets(tab.connectionKey, tab.collection),
      ]);
      setHistoryItems(hist);
      setPresetItems(presets);
    } catch {
      // Non-fatal if history/presets fail to load
    }
  }, [tab.connectionKey, tab.collection]);

  React.useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  const applySavedQuery = (item: {
    search_mode: string;
    query_text: string | null;
    vector_json: string | null;
    embedding_profile_id: string | null;
    top_k: number;
    score_threshold: number | null;
    filter_json: string | null;
  }) => {
    updateTab(tab.id, {
      searchMode: item.search_mode === "vector" ? "vector" : "text",
      searchText: item.query_text ?? "",
      searchVectorText: item.vector_json ?? "",
      searchProfileId: item.embedding_profile_id ?? tab.searchProfileId,
      searchTopK: Math.max(1, item.top_k),
      searchScoreThreshold: item.score_threshold,
      filter: parseStoredFilter(item.filter_json),
    });
    setHistoryOpen(false);
    setPresetsOpen(false);
  };

  const searchSnippets = React.useMemo(() => {
    let parsedVec: number[] | undefined;
    try {
      const raw = tab.searchVectorText.trim();
      if (raw) {
        const arr = raw.startsWith("[")
          ? JSON.parse(raw)
          : raw
              .split(/[\s,]+/)
              .filter(Boolean)
              .map(Number);
        if (
          Array.isArray(arr) &&
          arr.every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
          parsedVec = arr;
        }
      }
    } catch {
      // Ignore partial vector edits
    }

    const target = tab.target;
    if (target?.kind === "local_instance") {
      const inst = instances.find((i) => i.id === target.instance_id);
      return generateSearchSnippets({
        name: inst?.name ?? "Local Instance",
        engineType: inst?.engine_type ?? "qdrant",
        host: inst?.host,
        port: inst?.port,
        dataDir: inst?.data_dir,
        hasAuth: false,
        collection: tab.collection ?? "collection",
        topK: tab.searchTopK,
        scoreThreshold: tab.searchScoreThreshold,
        filter: tab.filter,
        queryVector: parsedVec,
        queryText: tab.searchMode === "text" ? tab.searchText : undefined,
      });
    }
    if (target?.kind === "remote_connection") {
      const conn = remoteConnections.find(
        (r) => r.id === target.connection_id,
      );
      return generateSearchSnippets({
        name: conn?.name ?? "Remote Connection",
        engineType: conn?.engine_type ?? "qdrant",
        endpointUrl: conn?.endpoint_url,
        hasAuth: conn ? conn.auth_type !== "none" : false,
        collection: tab.collection ?? "collection",
        topK: tab.searchTopK,
        scoreThreshold: tab.searchScoreThreshold,
        filter: tab.filter,
        queryVector: parsedVec,
        queryText: tab.searchMode === "text" ? tab.searchText : undefined,
      });
    }
    return generateSearchSnippets({
      name: "Vector DB",
      engineType: "qdrant",
      collection: tab.collection ?? "collection",
      topK: tab.searchTopK,
      scoreThreshold: tab.searchScoreThreshold,
      filter: tab.filter,
      queryVector: parsedVec,
      queryText: tab.searchMode === "text" ? tab.searchText : undefined,
    });
  }, [tab, instances, remoteConnections]);

  const handleRunSearch = async () => {
    if (!tab.target || !tab.collection || running) return;

    setRunning(true);
    try {
      let queryVector: number[] = [];
      let embedMs: number | null = null;

      if (tab.searchMode === "text") {
        if (!tab.searchText.trim()) {
          toast.error("Enter a search query string");
          setRunning(false);
          return;
        }
        if (!activeProfileId) {
          toast.error(
            "No Embedding Profile selected",
            "Create an embedding profile to embed text queries.",
          );
          setProfileDialogOpen(true);
          setRunning(false);
          return;
        }
        const [vecs, ms] = await embedTexts(activeProfileId, [tab.searchText]);
        if (!vecs[0] || vecs[0].length === 0) {
          throw new Error("Embedding provider returned an empty vector");
        }
        queryVector = vecs[0];
        embedMs = ms;
      } else {
        const raw = tab.searchVectorText.trim();
        if (!raw) {
          toast.error("Paste a query vector array");
          setRunning(false);
          return;
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
        queryVector = parsed;
      }

      const resp = await searchVectors(tab.target, tab.collection, {
        vector: queryVector,
        top_k: tab.searchTopK,
        score_threshold: tab.searchScoreThreshold,
        include_vectors: tab.includeVectors,
        filter: tab.filter,
      });

      const nextVectorText =
        tab.searchMode === "text"
          ? JSON.stringify(queryVector)
          : tab.searchVectorText;

      updateTab(tab.id, {
        searchResults: resp.records,
        searchLatencyMs: resp.latency_ms,
        searchEmbedLatencyMs: embedMs,
        searchVectorText: nextVectorText,
      });

      if (isTauriRuntime()) {
        try {
          await recordSearchHistory({
            connection_key: tab.connectionKey,
            collection: tab.collection,
            search_mode: tab.searchMode,
            query_text:
              tab.searchMode === "text" ? tab.searchText.trim() : null,
            vector_json:
              tab.searchMode === "vector" ? tab.searchVectorText.trim() : null,
            embedding_profile_id:
              tab.searchMode === "text" ? activeProfileId || null : null,
            top_k: tab.searchTopK,
            score_threshold: tab.searchScoreThreshold,
            filter_json: tab.filter ? JSON.stringify(tab.filter) : null,
            result_count: resp.records.length,
            latency_ms: resp.latency_ms,
          });
          await refreshMeta();
        } catch {
          // Non-fatal if history recording fails
        }
      }
    } catch (err: unknown) {
      toast.error(
        "Vector search failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setRunning(false);
    }
  };

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tab.collection || !presetName.trim()) return;
    try {
      await saveSearchPreset({
        name: presetName.trim(),
        connection_key: tab.connectionKey,
        collection: tab.collection,
        search_mode: tab.searchMode,
        query_text: tab.searchMode === "text" ? tab.searchText : null,
        vector_json:
          tab.searchMode === "vector" ? tab.searchVectorText : null,
        embedding_profile_id:
          tab.searchMode === "text" ? activeProfileId || null : null,
        top_k: tab.searchTopK,
        score_threshold: tab.searchScoreThreshold,
        filter_json: tab.filter ? JSON.stringify(tab.filter) : null,
      });
      toast.success(`Saved preset "${presetName.trim()}"`);
      setPresetName("");
      setSavePresetOpen(false);
      await refreshMeta();
    } catch (err: unknown) {
      toast.error(
        "Failed to save preset",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top Mode Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2">
          <div className="flex items-center gap-2">
            <Badge variant="ai">
              <Sparkles className="h-3 w-3" />
              Search Playground
            </Badge>
            <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
              {tab.collection}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {!compareMode && (
              <>
                <div className="relative">
                  <Button
                    type="button"
                    variant={historyOpen ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => {
                      setHistoryOpen((v) => !v);
                      setPresetsOpen(false);
                    }}
                  >
                    <History className="h-3.5 w-3.5" />
                    History ({historyItems.length})
                  </Button>
                  {historyOpen && (
                    <div className="absolute right-0 z-30 mt-1.5 w-80 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-2 shadow-2xl">
                      <div className="mb-1.5 flex items-center justify-between border-b border-[var(--border-subtle)] px-1 pb-1.5">
                        <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                          Recent Searches
                        </span>
                        {historyItems.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!tab.collection) return;
                              void clearSearchHistory(
                                tab.connectionKey,
                                tab.collection,
                              ).then(() => {
                                setHistoryItems([]);
                                toast.info("Cleared search history");
                              });
                            }}
                            className="text-[10px] text-[var(--status-error)] hover:underline cursor-pointer"
                          >
                            Clear all
                          </button>
                        )}
                      </div>
                      <div className="max-h-64 space-y-1 overflow-y-auto">
                        {historyItems.length === 0 ? (
                          <div className="py-4 text-center text-[11px] text-[var(--text-muted)]">
                            No search history yet.
                          </div>
                        ) : (
                          historyItems.map((h) => (
                            <button
                              key={h.id}
                              type="button"
                              onClick={() => applySavedQuery(h)}
                              className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-surface)] cursor-pointer"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                                  {h.search_mode === "text"
                                    ? h.query_text || "(empty text)"
                                    : "Raw vector query"}
                                </span>
                                <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                                  {h.result_count} hits
                                  {h.latency_ms != null
                                    ? ` · ${h.latency_ms}ms`
                                    : ""}
                                </span>
                              </div>
                              <div className="font-mono text-[10px] text-[var(--text-muted)]">
                                {h.search_mode} · k={h.top_k}
                                {h.filter_json ? " · filtered" : ""}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <Button
                    type="button"
                    variant={presetsOpen ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => {
                      setPresetsOpen((v) => !v);
                      setHistoryOpen(false);
                    }}
                  >
                    <Bookmark className="h-3.5 w-3.5" />
                    Presets ({presetItems.length})
                  </Button>
                  {presetsOpen && (
                    <div className="absolute right-0 z-30 mt-1.5 w-80 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-2 shadow-2xl">
                      <div className="mb-1.5 flex items-center justify-between border-b border-[var(--border-subtle)] px-1 pb-1.5">
                        <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                          Saved Presets
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPresetsOpen(false);
                            setSavePresetOpen(true);
                          }}
                          className="text-[10px] font-medium text-[var(--accent-primary)] hover:underline cursor-pointer"
                        >
                          + Save current
                        </button>
                      </div>
                      <div className="max-h-64 space-y-1 overflow-y-auto">
                        {presetItems.length === 0 ? (
                          <div className="py-4 text-center text-[11px] text-[var(--text-muted)]">
                            No saved presets yet.
                          </div>
                        ) : (
                          presetItems.map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-surface)]"
                            >
                              <button
                                type="button"
                                onClick={() => applySavedQuery(p)}
                                className="min-w-0 flex-1 text-left cursor-pointer"
                              >
                                <div className="truncate text-xs font-medium text-[var(--text-primary)]">
                                  {p.name}
                                </div>
                                <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                                  {p.search_mode} · k={p.top_k}
                                  {p.query_text ? ` · "${p.query_text}"` : ""}
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void deleteSearchPreset(p.id).then(() => {
                                    toast.info(`Deleted preset "${p.name}"`);
                                    void refreshMeta();
                                  });
                                }}
                                title="Delete preset"
                                className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--status-error)] cursor-pointer"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSnippetOpen(true)}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Copy as Code
                </Button>
              </>
            )}

            <Button
              type="button"
              variant={compareMode ? "default" : "secondary"}
              size="sm"
              onClick={() => {
                setCompareMode((v) => !v);
                setHistoryOpen(false);
                setPresetsOpen(false);
              }}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {compareMode ? "Exit Compare" : "Compare A/B"}
            </Button>
          </div>
        </div>

        {compareMode ? (
          <SearchComparePane tab={tab} />
        ) : (
          <>
            {/* Controls Header */}
            <div className="space-y-3 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => updateTab(tab.id, { searchMode: "text" })}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium cursor-pointer",
                      tab.searchMode === "text"
                        ? "bg-[var(--accent-ai)] text-white"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    Semantic Text
                  </button>
                  <button
                    type="button"
                    onClick={() => updateTab(tab.id, { searchMode: "vector" })}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium cursor-pointer",
                      tab.searchMode === "vector"
                        ? "bg-[var(--accent-primary)] text-slate-950 font-semibold"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    Raw Vector
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {onExportSearchResults && tab.searchResults.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onExportSearchResults(tab.searchResults)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Export Results
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSavePresetOpen(true)}
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    Save Preset
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    disabled={running}
                    onClick={() => void handleRunSearch()}
                  >
                    {running ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5 fill-current" />
                    )}
                    Run Search
                  </Button>
                </div>
              </div>

              {tab.searchMode === "text" ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_240px]">
                  <input
                    type="text"
                    value={tab.searchText}
                    onChange={(e) =>
                      updateTab(tab.id, { searchText: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        void handleRunSearch();
                      }
                    }}
                    placeholder="Enter natural language query (Ctrl+Enter to search)..."
                    className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                  />
                  <div className="flex items-center gap-1.5">
                    <select
                      value={activeProfileId}
                      onChange={(e) =>
                        updateTab(tab.id, { searchProfileId: e.target.value })
                      }
                      className="h-9 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
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
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      title="Manage Embedding Profiles"
                      onClick={() => setProfileDialogOpen(true)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <textarea
                  rows={2}
                  value={tab.searchVectorText}
                  onChange={(e) =>
                    updateTab(tab.id, { searchVectorText: e.target.value })
                  }
                  placeholder="Paste raw float vector array e.g. [0.021, -0.14, 0.88, ...]"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 font-mono text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none"
                />
              )}

              {/* Top-K & Score Threshold */}
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-secondary)]">
                <label className="flex items-center gap-2">
                  <span>Top-K:</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={tab.searchTopK}
                    onChange={(e) =>
                      updateTab(tab.id, {
                        searchTopK: Math.max(1, Number(e.target.value)),
                      })
                    }
                    className="h-7 w-16 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
                  />
                </label>

                <label className="flex items-center gap-2">
                  <span>Min Score:</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={tab.searchScoreThreshold ?? 0}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      updateTab(tab.id, {
                        searchScoreThreshold: v > 0 ? v : null,
                      });
                    }}
                    className="accent-[var(--accent-secondary)]"
                  />
                  <span className="w-10 font-mono text-[var(--text-primary)]">
                    {tab.searchScoreThreshold != null
                      ? tab.searchScoreThreshold.toFixed(2)
                      : "any"}
                  </span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tab.includeVectors}
                    onChange={(e) =>
                      updateTab(tab.id, { includeVectors: e.target.checked })
                    }
                    className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
                  />
                  <span>Include vectors</span>
                </label>
              </div>

              <FilterBuilder
                value={tab.filter}
                onChange={(filter) => updateTab(tab.id, { filter })}
              />

              <ScoreChart
                records={tab.searchResults}
                dbLatencyMs={tab.searchLatencyMs}
                embedLatencyMs={tab.searchEmbedLatencyMs}
              />
            </div>

            {/* Results Table */}
            <RecordTable
              records={tab.searchResults}
              loading={running}
              showScore
              readOnly={readOnly}
              selectedId={tab.selectedRecord?.id ?? null}
              onSelectRecord={(rec) =>
                updateTab(tab.id, { selectedRecord: rec, drawerOpen: true })
              }
              onFindSimilar={(rec) => {
                if (!tab.target || !tab.collection) return;
                openSearchTab(
                  tab.connectionKey,
                  tab.target,
                  tab.collection,
                  tab.collection,
                  rec,
                );
              }}
              onDeleteRecords={(ids) => {
                if (!tab.target || !tab.collection) return;
                void deleteRecords(tab.target, tab.collection, ids)
                  .then(() => {
                    toast.info(`Deleted ${ids.length} record(s)`);
                    updateTab(tab.id, {
                      searchResults: tab.searchResults.filter(
                        (r) => !ids.includes(r.id),
                      ),
                    });
                  })
                  .catch((err: unknown) =>
                    toast.error(
                      "Delete failed",
                      err instanceof Error ? err.message : String(err),
                    ),
                  );
              }}
            />
          </>
        )}
      </div>

      {!compareMode && tab.drawerOpen && (
        <MetadataDrawer
          record={tab.selectedRecord}
          readOnly={readOnly}
          positionLabel={
            selectedIndex >= 0
              ? `${selectedIndex + 1} / ${tab.searchResults.length}`
              : undefined
          }
          hasPrev={selectedIndex > 0}
          hasNext={
            selectedIndex >= 0 && selectedIndex < tab.searchResults.length - 1
          }
          onPrev={() => {
            if (selectedIndex > 0) {
              updateTab(tab.id, {
                selectedRecord: tab.searchResults[selectedIndex - 1],
              });
            }
          }}
          onNext={() => {
            if (
              selectedIndex >= 0 &&
              selectedIndex < tab.searchResults.length - 1
            ) {
              updateTab(tab.id, {
                selectedRecord: tab.searchResults[selectedIndex + 1],
              });
            }
          }}
          onClose={() => updateTab(tab.id, { drawerOpen: false })}
          onFindSimilar={(rec) => {
            if (!tab.target || !tab.collection) return;
            openSearchTab(
              tab.connectionKey,
              tab.target,
              tab.collection,
              tab.collection,
              rec,
            );
          }}
          onSave={async (updated) => {
            if (!tab.target || !tab.collection) return;
            await upsertRecords(tab.target, tab.collection, [updated]);
            updateTab(tab.id, {
              selectedRecord: updated,
              searchResults: tab.searchResults.map((r) =>
                r.id === updated.id ? updated : r,
              ),
            });
          }}
          onDelete={async (id) => {
            if (!tab.target || !tab.collection) return;
            await deleteRecords(tab.target, tab.collection, [id]);
            updateTab(tab.id, {
              drawerOpen: false,
              selectedRecord: null,
              searchResults: tab.searchResults.filter((r) => r.id !== id),
            });
          }}
        />
      )}

      <Dialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        title="Embedding Profiles"
        description="Configure local or cloud text-to-vector models for semantic search."
        maxWidthClass="w-[min(92vw,760px)]"
      >
        <EmbeddingProfilesPanel variant="dialog" />
      </Dialog>

      <Dialog
        open={savePresetOpen}
        onOpenChange={setSavePresetOpen}
        title="Save Search Preset"
        description={`Save query, threshold, top-K, and active filters for "${tab.collection ?? ""}".`}
        maxWidthClass="w-[400px]"
      >
        <form onSubmit={(e) => void handleSavePreset(e)} className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Preset Name
            </label>
            <input
              type="text"
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="e.g. High-precision Rust filter"
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSavePresetOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!presetName.trim()}>
              Save Preset
            </Button>
          </div>
        </form>
      </Dialog>

      <SnippetModal
        open={snippetOpen}
        onOpenChange={setSnippetOpen}
        title={`Search Snippet · ${tab.collection ?? ""}`}
        snippets={searchSnippets}
      />
    </div>
  );
}
