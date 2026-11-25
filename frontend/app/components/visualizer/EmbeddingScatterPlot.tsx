import * as React from "react";
import Plotly, { type PlotlyHTMLElement } from "plotly.js-dist-min";
import { Loader2, RefreshCw, ScatterChart } from "lucide-react";
import { MetadataDrawer } from "@/components/explorer/MetadataDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  computeEmbeddingProjection,
  type ProjectionMethod,
  type ProjectionResult,
} from "@/ipc/analytics";
import { browseRecords, deleteRecords, upsertRecords } from "@/ipc/explorer";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useTabsStore, type WorkspaceTab } from "@/stores/useTabsStore";
import type { VectorRecord } from "@/types/explorer";
import { SWATCH_PRESETS } from "@/types/system";

export function EmbeddingScatterPlot({ tab }: { tab: WorkspaceTab }) {
  const theme = useAppStore((s) => s.theme);
  const updateTab = useTabsStore((s) => s.updateTab);
  const openSearchTab = useTabsStore((s) => s.openSearchTab);

  const [method, setMethod] = React.useState<ProjectionMethod>("pca");
  const [dims, setDims] = React.useState<2 | 3>(3);
  const [sampleSize, setSampleSize] = React.useState(250);
  const [colorField, setColorField] = React.useState<string>("");
  const [records, setRecords] = React.useState<VectorRecord[]>([]);
  const [projection, setProjection] = React.useState<ProjectionResult | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);

  const plotRef = React.useRef<HTMLDivElement | null>(null);

  const payloadKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const r of records) {
      for (const k of Object.keys(r.payload ?? {})) {
        keys.add(k);
      }
    }
    return Array.from(keys).sort();
  }, [records]);

  const computeMap = React.useCallback(async () => {
    if (!tab.target || !tab.collection) return;
    setLoading(true);
    try {
      const resp = await browseRecords(tab.target, tab.collection, {
        limit: sampleSize,
        offset: 0,
        include_vectors: true,
        filter: tab.filter,
      });
      const withVecs = resp.records.filter(
        (r) => Array.isArray(r.vector) && r.vector.length > 0,
      );
      setRecords(withVecs);

      if (withVecs.length === 0) {
        setProjection(null);
        toast.info(
          "No vectors available",
          "This collection has no vectors in the sampled records.",
        );
        return;
      }

      const proj = await computeEmbeddingProjection(
        withVecs.map((r) => r.vector as number[]),
        method,
        dims,
      );
      setProjection(proj);
    } catch (err: unknown) {
      toast.error(
        "Projection failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setLoading(false);
    }
  }, [tab.target, tab.collection, tab.filter, sampleSize, method, dims]);

  React.useEffect(() => {
    void computeMap();
  }, [computeMap]);

  React.useEffect(() => {
    const container = plotRef.current;
    if (!container) return;

    if (!projection || records.length === 0) {
      Plotly.purge(container);
      return;
    }

    const isDark = theme === "dark";
    const bgCanvas = isDark ? "#090C12" : "#F8FAFC";
    const gridColor = isDark ? "#1E2738" : "#E2E8F0";
    const textColor = isDark ? "#94A3B8" : "#475569";

    const hoverTexts = records.map((r) => {
      const doc = r.document ? `<br>${r.document.slice(0, 80)}` : "";
      const fieldLine =
        colorField && r.payload?.[colorField] !== undefined
          ? `<br>${colorField}: ${String(r.payload[colorField])}`
          : "";
      return `<b>${r.id}</b>${fieldLine}${doc}`;
    });

    // Build traces grouped by metadata category (or single numeric/default trace)
    const values = colorField
      ? records.map((r) => r.payload?.[colorField])
      : [];
    const allNumeric =
      Boolean(colorField) &&
      values.some((v) => typeof v === "number") &&
      values.every((v) => v === undefined || typeof v === "number");

    const traces: Record<string, unknown>[] = [];

    if (colorField && !allNumeric) {
      const groups = new Map<string, number[]>();
      records.forEach((r, idx) => {
        const raw = r.payload?.[colorField];
        const label =
          raw === undefined || raw === null ? "(unset)" : String(raw);
        const arr = groups.get(label) ?? [];
        arr.push(idx);
        groups.set(label, arr);
      });

      let colorIdx = 0;
      for (const [label, indices] of groups.entries()) {
        const swatch =
          SWATCH_PRESETS[colorIdx % SWATCH_PRESETS.length].hex;
        colorIdx += 1;

        traces.push({
          type: dims === 3 ? "scatter3d" : "scattergl",
          mode: "markers",
          name: label,
          x: indices.map((i) => projection.coords[i][0]),
          y: indices.map((i) => projection.coords[i][1]),
          ...(dims === 3
            ? { z: indices.map((i) => projection.coords[i][2]) }
            : {}),
          text: indices.map((i) => hoverTexts[i]),
          customdata: indices,
          hoverinfo: "text",
          marker: {
            size: dims === 3 ? 4 : 7,
            color: swatch,
            opacity: 0.88,
          },
        });
      }
    } else {
      const numericColors = allNumeric
        ? records.map((r) => Number(r.payload?.[colorField] ?? 0))
        : undefined;
      traces.push({
        type: dims === 3 ? "scatter3d" : "scattergl",
        mode: "markers",
        name: tab.collection ?? "Vectors",
        x: projection.coords.map((c) => c[0]),
        y: projection.coords.map((c) => c[1]),
        ...(dims === 3 ? { z: projection.coords.map((c) => c[2]) } : {}),
        text: hoverTexts,
        customdata: records.map((_, i) => i),
        hoverinfo: "text",
        marker: {
          size: dims === 3 ? 4 : 7,
          color: numericColors ?? "#14B8A6",
          colorscale: allNumeric ? "Teal" : undefined,
          showscale: allNumeric,
          opacity: 0.88,
        },
      });
    }

    const layout: Record<string, unknown> = {
      paper_bgcolor: bgCanvas,
      plot_bgcolor: bgCanvas,
      font: { color: textColor, size: 11 },
      margin: { l: 28, r: 20, t: 18, b: 28 },
      showlegend: traces.length > 1,
      legend: {
        orientation: "h",
        y: -0.08,
        font: { color: textColor, size: 10 },
      },
      xaxis: { gridcolor: gridColor, zerolinecolor: gridColor, title: "Dim 1" },
      yaxis: { gridcolor: gridColor, zerolinecolor: gridColor, title: "Dim 2" },
      scene: {
        xaxis: { gridcolor: gridColor, title: "Dim 1" },
        yaxis: { gridcolor: gridColor, title: "Dim 2" },
        zaxis: { gridcolor: gridColor, title: "Dim 3" },
      },
      hovermode: "closest",
    };

    void Plotly.react(container, traces, layout, {
      responsive: true,
      displaylogo: false,
    }).then((el: PlotlyHTMLElement) => {
      el.removeAllListeners?.("plotly_click");
      el.on("plotly_click", (evt) => {
        const pt = evt.points?.[0];
        const idx =
          typeof pt?.customdata === "number"
            ? pt.customdata
            : pt?.pointIndex ?? pt?.pointNumber;
        if (typeof idx === "number" && records[idx]) {
          updateTab(tab.id, {
            selectedRecord: records[idx],
            drawerOpen: true,
          });
        }
      });
    });
  }, [projection, records, dims, colorField, theme, tab.id, tab.collection, updateTab]);

  React.useEffect(() => {
    const container = plotRef.current;
    return () => {
      if (container) {
        Plotly.purge(container);
      }
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">
              <ScatterChart className="h-3 w-3" />
              Embedding Visualizer
            </Badge>
            <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
              {tab.collection}
            </span>
            {projection && (
              <span className="font-mono text-[11px] text-[var(--text-muted)]">
                {records.length} pts · {projection.elapsed_ms} ms
                {projection.explained_variance.length > 0 &&
                  ` · var ${(
                    projection.explained_variance.reduce((a, b) => a + b, 0) *
                    100
                  ).toFixed(1)}%`}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMethod("pca")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium cursor-pointer",
                  method === "pca"
                    ? "bg-[var(--accent-primary)] text-slate-950 font-semibold"
                    : "text-[var(--text-secondary)]",
                )}
              >
                PCA
              </button>
              <button
                type="button"
                onClick={() => setMethod("umap")}
                className={cn(
                  "rounded-md px-2 py-0.5 font-medium cursor-pointer",
                  method === "umap"
                    ? "bg-[var(--accent-ai)] text-white"
                    : "text-[var(--text-secondary)]",
                )}
              >
                UMAP
              </button>
            </div>

            <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setDims(2)}
                className={cn(
                  "rounded-md px-2 py-0.5 font-mono cursor-pointer",
                  dims === 2
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] font-semibold"
                    : "text-[var(--text-muted)]",
                )}
              >
                2D
              </button>
              <button
                type="button"
                onClick={() => setDims(3)}
                className={cn(
                  "rounded-md px-2 py-0.5 font-mono cursor-pointer",
                  dims === 3
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] font-semibold"
                    : "text-[var(--text-muted)]",
                )}
              >
                3D
              </button>
            </div>

            <select
              value={sampleSize}
              onChange={(e) => setSampleSize(Number(e.target.value))}
              className="h-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              title="Sample size"
            >
              <option value={100}>100 pts</option>
              <option value={250}>250 pts</option>
              <option value={500}>500 pts</option>
              <option value={1000}>1,000 pts</option>
              <option value={2000}>2,000 pts</option>
            </select>

            <select
              value={colorField}
              onChange={(e) => setColorField(e.target.value)}
              className="h-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[11px] text-[var(--text-primary)] focus:border-[var(--border-strong)] focus:outline-none"
              title="Color points by metadata field"
            >
              <option value="">Color: Uniform</option>
              {payloadKeys.map((k) => (
                <option key={k} value={k}>
                  Color: {k}
                </option>
              ))}
            </select>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={() => void computeMap()}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Recompute
            </Button>
          </div>
        </div>

        {/* Plot Canvas */}
        <div className="relative min-h-0 flex-1 bg-[var(--bg-canvas)]">
          <div ref={plotRef} className="h-full w-full" />
          {loading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--bg-canvas)]/60">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 py-2 text-xs text-[var(--text-primary)] shadow-xl">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-primary)]" />
                Computing {method.toUpperCase()} {dims}D projection in Rust...
              </div>
            </div>
          )}
        </div>
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
            updateTab(tab.id, { selectedRecord: updated });
          }}
          onDelete={async (id) => {
            if (!tab.target || !tab.collection) return;
            await deleteRecords(tab.target, tab.collection, [id]);
            updateTab(tab.id, { drawerOpen: false, selectedRecord: null });
            void computeMap();
          }}
        />
      )}
    </div>
  );
}
