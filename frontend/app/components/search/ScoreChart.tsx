import { BarChart3, Clock, Sparkles } from "lucide-react";
import type { VectorRecord } from "@/types/explorer";

export function ScoreChart({
  records,
  dbLatencyMs,
  embedLatencyMs,
}: {
  records: VectorRecord[];
  dbLatencyMs: number | null;
  embedLatencyMs: number | null;
}) {
  if (records.length === 0 && dbLatencyMs === null) return null;

  const scores = records
    .map((r) => r.score ?? 0)
    .filter((s) => Number.isFinite(s));
  const maxScore = scores.length > 0 ? Math.max(...scores, 0.0001) : 1;
  const avgScore =
    scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
          <BarChart3 className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
          Query Telemetry & Score Distribution
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <span className="text-[var(--text-secondary)]">
            Matches:{" "}
            <strong className="text-[var(--text-primary)]">
              {records.length}
            </strong>
          </span>
          {embedLatencyMs != null && (
            <span className="flex items-center gap-1 text-[var(--accent-ai)]">
              <Sparkles className="h-3 w-3" />
              Embed: {embedLatencyMs} ms
            </span>
          )}
          {dbLatencyMs != null && (
            <span className="flex items-center gap-1 text-[var(--accent-primary)]">
              <Clock className="h-3 w-3" />
              DB: {dbLatencyMs} ms
            </span>
          )}
          {scores.length > 0 && (
            <span className="text-[var(--text-secondary)]">
              Avg:{" "}
              <strong className="text-[var(--accent-secondary)]">
                {avgScore.toFixed(4)}
              </strong>
            </span>
          )}
        </div>
      </div>

      {records.length > 0 && (
        <div className="mt-2.5 flex items-end gap-1.5 overflow-x-auto pt-1">
          {records.slice(0, 24).map((rec) => {
            const score = rec.score ?? 0;
            const heightPct = Math.max(8, Math.round((score / maxScore) * 100));
            return (
              <div
                key={rec.id}
                title={`${rec.id}: ${score.toFixed(4)}`}
                className="flex min-w-[20px] flex-1 flex-col items-center gap-1"
              >
                <div className="flex h-10 w-full items-end rounded-sm bg-[var(--bg-canvas)] p-0.5">
                  <div
                    className="w-full rounded-sm bg-[var(--accent-secondary)] transition-all"
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <span className="w-full truncate text-center font-mono text-[9px] text-[var(--text-muted)]">
                  {score.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
