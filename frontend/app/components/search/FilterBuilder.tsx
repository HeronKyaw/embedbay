import * as React from "react";
import { Code2, Filter, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FilterCondition, FilterSpec } from "@/types/explorer";

function parseConditionValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  return raw;
}

export function FilterBuilder({
  value,
  onChange,
  onApply,
}: {
  value: FilterSpec | null;
  onChange: (next: FilterSpec | null) => void;
  onApply?: () => void;
}) {
  const isRaw = value?.mode === "raw_json";
  const [rawText, setRawText] = React.useState(
    value?.mode === "raw_json" ? JSON.stringify(value.json, null, 2) : "{}",
  );
  const [rawError, setRawError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (value?.mode === "raw_json") {
      const next = JSON.stringify(value.json ?? {}, null, 2);
      setRawText((prev) => {
        try {
          if (JSON.stringify(JSON.parse(prev || "{}"), null, 2) === next) {
            return prev;
          }
        } catch {
          // Replace invalid local draft when restored externally
        }
        return next;
      });
      setRawError(null);
    }
  }, [value]);

  const visualLogic = value?.mode === "visual" ? value.logic : "and";
  const conditions: FilterCondition[] =
    value?.mode === "visual" ? value.conditions : [];

  const handleToggleMode = () => {
    if (isRaw) {
      onChange({ mode: "visual", logic: "and", conditions: [] });
      setRawError(null);
    } else {
      setRawText("{}");
      setRawError(null);
      onChange({ mode: "raw_json", json: {} });
    }
  };

  const addCondition = () => {
    onChange({
      mode: "visual",
      logic: visualLogic,
      conditions: [
        ...conditions,
        { field: "", op: "eq", value: "" },
      ],
    });
  };

  const updateCondition = (idx: number, patch: Partial<FilterCondition>) => {
    const next = conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange({ mode: "visual", logic: visualLogic, conditions: next });
  };

  const removeCondition = (idx: number) => {
    const next = conditions.filter((_, i) => i !== idx);
    onChange(
      next.length > 0
        ? { mode: "visual", logic: visualLogic, conditions: next }
        : null,
    );
  };

  const handleRawChange = (text: string) => {
    setRawText(text);
    try {
      const parsed = JSON.parse(text || "{}");
      setRawError(null);
      onChange({ mode: "raw_json", json: parsed });
    } catch (err: unknown) {
      setRawError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">
          <Filter className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
          <span>Metadata Filters</span>
          {!isRaw && conditions.length > 1 && (
            <select
              value={visualLogic}
              onChange={(e) =>
                onChange({
                  mode: "visual",
                  logic: e.target.value as "and" | "or",
                  conditions,
                })
              }
              className="rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--text-primary)]"
            >
              <option value="and">AND</option>
              <option value="or">OR</option>
            </select>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!isRaw && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={addCondition}
            >
              <Plus className="h-3 w-3" />
              Condition
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={handleToggleMode}
          >
            <Code2 className="h-3 w-3" />
            {isRaw ? "Visual Mode" : "Raw JSON"}
          </Button>
          {onApply && (
            <Button
              type="button"
              size="sm"
              className="h-6 px-2.5 text-[10px]"
              disabled={Boolean(rawError)}
              onClick={onApply}
            >
              Apply
            </Button>
          )}
        </div>
      </div>

      {isRaw ? (
        <div className="space-y-1">
          <textarea
            rows={3}
            value={rawText}
            onChange={(e) => handleRawChange(e.target.value)}
            placeholder='{"must":[{"key":"topic","match":{"value":"rust"}}]}'
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
          {rawError && (
            <p className="text-[10px] text-[var(--status-error)]">{rawError}</p>
          )}
        </div>
      ) : conditions.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">
          No active filters. Click + Condition to filter by payload metadata.
        </p>
      ) : (
        <div className="space-y-1.5">
          {conditions.map((cond, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                value={cond.field}
                onChange={(e) =>
                  updateCondition(idx, { field: e.target.value })
                }
                placeholder="field (e.g. category)"
                className="h-7 w-36 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px] text-[var(--text-primary)] focus:outline-none"
              />
              <select
                value={cond.op}
                onChange={(e) =>
                  updateCondition(idx, {
                    op: e.target.value as FilterCondition["op"],
                  })
                }
                className="h-7 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-1.5 text-[11px] text-[var(--text-primary)] focus:outline-none"
              >
                <option value="eq">equals</option>
                <option value="neq">not equals</option>
                <option value="in">in (comma list)</option>
                <option value="contains">contains</option>
                <option value="gt">&gt;</option>
                <option value="gte">&gt;=</option>
                <option value="lt">&lt;</option>
                <option value="lte">&lt;=</option>
              </select>
              <input
                type="text"
                value={
                  typeof cond.value === "string"
                    ? cond.value
                    : JSON.stringify(cond.value ?? "")
                }
                onChange={(e) =>
                  updateCondition(idx, {
                    value: parseConditionValue(e.target.value),
                  })
                }
                placeholder="value"
                className="h-7 flex-1 min-w-[120px] rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px] text-[var(--text-primary)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeCondition(idx)}
                className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--status-error)] cursor-pointer"
                aria-label="Remove condition"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
