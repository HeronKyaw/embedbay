import * as React from "react";
import { Download, Loader2, Play, Plus, Sparkles } from "lucide-react";
import { MetadataDrawer } from "@/components/explorer/MetadataDrawer";
import { RecordTable } from "@/components/explorer/RecordTable";
import { EmbeddingProfilesPanel } from "@/components/search/EmbeddingProfilesPanel";
import { FilterBuilder } from "@/components/search/FilterBuilder";
import { ScoreChart } from "@/components/search/ScoreChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { embedTexts } from "@/ipc/connections";
import { deleteRecords, searchVectors, upsertRecords } from "@/ipc/explorer";
import { cn } from "@/lib/utils";
import { useTabsStore, type WorkspaceTab } from "@/stores/useTabsStore";
import type { VectorRecord } from "@/types/explorer";

export function SearchPlayground({
  tab,
  onExportSearchResults,
}: {
  tab: WorkspaceTab;
  onExportSearchResults?: (records: VectorRecord[]) => void;
}) {
  const embeddingProfiles = useTabsStore((s) => s.embeddingProfiles);
  const updateTab = useTabsStore((s) => s.updateTab);
  const openSearchTab = useTabsStore((s) => s.openSearchTab);

  const [running, setRunning] = React.useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = React.useState(false);

  const activeProfileId =
    tab.searchProfileId || embeddingProfiles[0]?.id || "";

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
            "Create an Ollama or OpenAI-compatible profile to embed text queries.",
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

      updateTab(tab.id, {
        searchResults: resp.records,
        searchLatencyMs: resp.latency_ms,
        searchEmbedLatencyMs: embedMs,
        searchVectorText:
          tab.searchMode === "text"
            ? JSON.stringify(queryVector)
            : tab.searchVectorText,
      });
    } catch (err: unknown) {
      toast.error(
        "Vector search failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Controls Header */}
        <div className="space-y-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="ai">
                <Sparkles className="h-3 w-3" />
                Search Playground
              </Badge>
              <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                {tab.collection}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => updateTab(tab.id, { searchMode: "text" })}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium cursor-pointer",
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
                    "rounded px-2.5 py-1 font-medium cursor-pointer",
                    tab.searchMode === "vector"
                      ? "bg-[var(--accent-primary)] text-slate-950 font-semibold"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                  )}
                >
                  Raw Vector
                </button>
              </div>

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
                className="h-9 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-3 text-xs text-[var(--text-primary)] focus:border-[var(--accent-ai)] focus:outline-none"
              />
              <div className="flex items-center gap-1.5">
                <select
                  value={activeProfileId}
                  onChange={(e) =>
                    updateTab(tab.id, { searchProfileId: e.target.value })
                  }
                  className="h-9 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:outline-none"
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
              className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
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
                className="h-7 w-16 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs text-[var(--text-primary)]"
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
      </div>

      {tab.drawerOpen && (
        <MetadataDrawer
          record={tab.selectedRecord}
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
        title="Configure Embedding Profiles"
        description="Connect local Ollama or OpenAI-compatible embedding models."
        maxWidthClass="w-[680px]"
      >
        <EmbeddingProfilesPanel />
      </Dialog>
    </div>
  );
}
