import * as React from "react";
import { Copy, Save, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { VectorRecord } from "@/types/explorer";

export function MetadataDrawer({
  record,
  onClose,
  onSave,
  onFindSimilar,
  onDelete,
}: {
  record: VectorRecord | null;
  onClose: () => void;
  onSave?: (updated: VectorRecord) => Promise<void>;
  onFindSimilar: (record: VectorRecord) => void;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [payloadText, setPayloadText] = React.useState("{}");
  const [documentText, setDocumentText] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!record) return;
    setPayloadText(JSON.stringify(record.payload ?? {}, null, 2));
    setDocumentText(record.document ?? "");
  }, [record]);

  if (!record) return null;

  const handleSave = async () => {
    if (!onSave || saving) return;
    let parsed: Record<string, unknown>;
    try {
      const raw = JSON.parse(payloadText || "{}");
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        toast.error("Payload must be a JSON object");
        return;
      }
      parsed = raw as Record<string, unknown>;
    } catch {
      toast.error("Invalid JSON payload");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        ...record,
        payload: parsed,
        document: documentText.trim() ? documentText : null,
      });
      toast.success(`Saved record ${record.id}`);
    } catch (err: unknown) {
      toast.error(
        "Failed to save record",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      aria-label="Record Inspector"
      className="flex h-full w-80 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Record Inspector
          </div>
          <div className="truncate font-mono text-xs font-semibold text-[var(--accent-secondary)]">
            {record.id}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3.5 text-xs">
        {record.score != null && (
          <div className="flex items-center justify-between rounded-md border border-[var(--accent-secondary)]/40 bg-[var(--accent-secondary)]/10 px-2.5 py-1.5">
            <span className="text-[11px] text-[var(--text-secondary)]">
              Similarity Score
            </span>
            <span className="font-mono font-semibold text-[var(--accent-secondary)]">
              {record.score.toFixed(5)}
            </span>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Document Text
            </label>
          </div>
          <textarea
            rows={4}
            value={documentText}
            onChange={(e) => setDocumentText(e.target.value)}
            placeholder="(no document text)"
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Metadata JSON
            </label>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(payloadText);
                toast.success("Copied JSON payload");
              }}
              className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <Copy className="h-2.5 w-2.5" />
              Copy
            </button>
          </div>
          <textarea
            rows={10}
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        {record.vector && record.vector.length > 0 && (
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Vector ({record.vector.length} dims)
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    JSON.stringify(record.vector),
                  );
                  toast.success("Copied vector array");
                }}
                className="inline-flex items-center gap-1 text-[10px] text-[var(--accent-secondary)] hover:underline cursor-pointer"
              >
                <Copy className="h-2.5 w-2.5" />
                Copy Array
              </button>
            </div>
            <div className="max-h-20 overflow-hidden font-mono text-[10px] text-[var(--text-secondary)]">
              [{record.vector
                .slice(0, 12)
                .map((n) => n.toFixed(4))
                .join(", ")}
              {record.vector.length > 12 ? ", …" : ""}]
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onFindSimilar(record)}
        >
          <Sparkles className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
          Similar
        </Button>

        <div className="flex items-center gap-1.5">
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Delete Record"
              onClick={() => void onDelete(record.id)}
            >
              <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
            </Button>
          )}
          {onSave && (
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
