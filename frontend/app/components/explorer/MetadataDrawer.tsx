import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { VectorRecord } from "@/types/explorer";

type MetadataViewMode = "fields" | "raw";

type ParsedPayloadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

function parsePayloadObject(text: string): ParsedPayloadResult {
  try {
    const raw = JSON.parse(text || "{}");
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, error: "Metadata payload must be a JSON object." };
    }
    return { ok: true, data: raw as Record<string, unknown> };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid JSON payload.",
    };
  }
}

function renderMetadataValue(value: unknown): React.ReactNode {
  if (value === null) {
    return (
      <span className="font-mono text-xs italic text-[var(--text-muted)]">
        null
      </span>
    );
  }
  if (typeof value === "boolean") {
    return (
      <span className="font-mono text-xs font-medium text-[var(--accent-ai)]">
        {String(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <span className="font-mono text-xs text-[var(--accent-primary)]">
        {String(value)}
      </span>
    );
  }
  if (typeof value === "string") {
    if (value.length === 0) {
      return (
        <span className="text-xs italic text-[var(--text-muted)]">(empty)</span>
      );
    }
    return (
      <span className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--text-primary)]">
        {value}
      </span>
    );
  }
  return (
    <pre className="overflow-x-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function MetadataDrawer({
  record,
  positionLabel,
  hasPrev = false,
  hasNext = false,
  onPrev,
  onNext,
  onClose,
  onSave,
  onFindSimilar,
  onDelete,
}: {
  record: VectorRecord | null;
  positionLabel?: string;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onSave?: (updated: VectorRecord) => Promise<void>;
  onFindSimilar: (record: VectorRecord) => void;
  onDelete?: (id: string) => Promise<void>;
}) {
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);
  const [payloadText, setPayloadText] = React.useState("{}");
  const [documentText, setDocumentText] = React.useState("");
  const [metadataView, setMetadataView] =
    React.useState<MetadataViewMode>("fields");
  const [saving, setSaving] = React.useState(false);

  const initialDocumentText = record?.document ?? "";
  const initialPayloadText = React.useMemo(
    () => JSON.stringify(record?.payload ?? {}, null, 2),
    [record],
  );

  React.useEffect(() => {
    if (!record) return;
    setPayloadText(initialPayloadText);
    setDocumentText(initialDocumentText);
  }, [record, initialPayloadText, initialDocumentText]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (record && !dialog.open) {
      dialog.showModal();
    } else if (!record && dialog.open) {
      dialog.close();
    }
  }, [record]);

  const parsedPayload = React.useMemo(
    () => parsePayloadObject(payloadText),
    [payloadText],
  );

  if (!record) return null;

  const isDirty =
    documentText !== initialDocumentText || payloadText !== initialPayloadText;
  const payloadEntries = parsedPayload.ok
    ? Object.entries(parsedPayload.data)
    : [];

  const handleFormatJson = () => {
    if (!parsedPayload.ok) {
      toast.error("Invalid JSON payload", parsedPayload.error);
      return;
    }
    setPayloadText(JSON.stringify(parsedPayload.data, null, 2));
  };

  const handleSave = async () => {
    if (!onSave || saving) return;
    if (!parsedPayload.ok) {
      toast.error("Invalid JSON payload", parsedPayload.error);
      setMetadataView("raw");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        ...record,
        payload: parsedPayload.data,
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
    <dialog
      ref={dialogRef}
      aria-label="Record Inspector"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      className="rounded-xl shadow-2xl"
    >
      <div className="flex max-h-[88vh] w-[min(92vw,860px)] flex-col overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--bg-canvas)] text-[var(--text-primary)] shadow-2xl">
        {/* Header */}
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Record Inspector
              </span>
              {positionLabel && (
                <Badge variant="default" className="font-mono text-[10px]">
                  {positionLabel}
                </Badge>
              )}
              {record.score != null && (
                <Badge variant="ai" className="font-mono text-[10px]">
                  Score {record.score.toFixed(5)}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1">
              {(onPrev || onNext) && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!hasPrev}
                    onClick={onPrev}
                    title="Previous record"
                    aria-label="Previous record"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={!hasNext}
                    onClick={onNext}
                    title="Next record"
                    aria-label="Next record"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close inspector"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-1.5 flex items-start justify-between gap-3">
            <div className="min-w-0 select-all break-all font-mono text-xs font-semibold leading-relaxed text-[var(--accent-secondary)]">
              {record.id}
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(record.id);
                toast.success("Copied record ID");
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <Copy className="h-3 w-3" />
              Copy ID
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 text-xs">
          {/* Document Text */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Document Text
                </label>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {documentText.length.toLocaleString()} chars
                </span>
              </div>
              {documentText.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(documentText);
                    toast.success("Copied document text");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              )}
            </div>
            <textarea
              rows={7}
              value={documentText}
              onChange={(e) => setDocumentText(e.target.value)}
              placeholder="(no document text)"
              className="w-full resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3 text-[13px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          {/* Metadata */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Metadata
                </span>
                <div className="inline-flex rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setMetadataView("fields")}
                    className={cn(
                      "rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                      metadataView === "fields"
                        ? "bg-[var(--bg-elevated)] text-[var(--accent-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetadataView("raw")}
                    className={cn(
                      "rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                      metadataView === "raw"
                        ? "bg-[var(--bg-elevated)] text-[var(--accent-primary)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    Raw JSON
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                {metadataView === "raw" && (
                  <button
                    type="button"
                    onClick={handleFormatJson}
                    className="text-[11px] text-[var(--accent-secondary)] hover:underline cursor-pointer"
                  >
                    Format
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(payloadText);
                    toast.success("Copied JSON payload");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </div>
            </div>

            {metadataView === "fields" ? (
              !parsedPayload.ok ? (
                <div className="rounded-lg border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-3.5 py-2.5 text-xs text-[var(--status-error)]">
                  Invalid JSON: {parsedPayload.error} Switch to{" "}
                  <button
                    type="button"
                    onClick={() => setMetadataView("raw")}
                    className="font-semibold underline cursor-pointer"
                  >
                    Raw JSON
                  </button>{" "}
                  to edit.
                </div>
              ) : payloadEntries.length === 0 ? (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3 text-xs italic text-[var(--text-muted)]">
                  (no metadata fields)
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                  {payloadEntries.map(([key, val]) => (
                    <div
                      key={key}
                      className="grid grid-cols-1 gap-1 px-3.5 py-2.5 sm:grid-cols-[minmax(140px,220px)_minmax(0,1fr)] sm:gap-4"
                    >
                      <div className="break-all font-mono text-xs font-medium text-[var(--accent-secondary)]">
                        {key}
                      </div>
                      <div className="min-w-0">{renderMetadataValue(val)}</div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <textarea
                rows={12}
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                className="w-full resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3 font-mono text-xs leading-relaxed text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            )}
          </div>

          {/* Vector */}
          {record.vector && record.vector.length > 0 && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
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
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--accent-secondary)] hover:underline cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                  Copy Array
                </button>
              </div>
              <div className="font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
                [{record.vector
                  .slice(0, 24)
                  .map((n) => n.toFixed(4))
                  .join(", ")}
                {record.vector.length > 24 ? ", …" : ""}]
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-3.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              onClose();
              onFindSimilar(record);
            }}
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
            Find Similar
          </Button>

          <div className="flex items-center gap-2">
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void onDelete(record.id)}
                className="text-[var(--status-error)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            {onSave && (
              <Button
                type="button"
                size="sm"
                disabled={saving || !isDirty}
                onClick={() => void handleSave()}
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
