import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { isTauriRuntime } from "@/ipc/system";
import {
  exportRecords,
  exportSearchResults,
  importRecords,
  type TransferFormat,
  type TransferProgressEvent,
} from "@/ipc/transfer";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/stores/useTabsStore";
import type { ConnectionTarget, VectorRecord } from "@/types/explorer";

export function ImportExportModal({
  open,
  onOpenChange,
  target,
  collection,
  searchRecords,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ConnectionTarget | null;
  collection: string | null;
  searchRecords?: VectorRecord[] | null;
  onImported?: () => void;
}) {
  const embeddingProfiles = useTabsStore((s) => s.embeddingProfiles);

  const [mode, setMode] = React.useState<"import" | "export">(
    searchRecords ? "export" : "import",
  );
  const [format, setFormat] = React.useState<TransferFormat>("jsonl");
  const [filePath, setFilePath] = React.useState("");
  const [idField, setIdField] = React.useState("id");
  const [vectorField, setVectorField] = React.useState("vector");
  const [textField, setTextField] = React.useState("document");
  const [embeddingProfileId, setEmbeddingProfileId] = React.useState("");
  const [includeVectors, setIncludeVectors] = React.useState(true);
  const [exportLimit, setExportLimit] = React.useState(5000);
  const [progress, setProgress] =
    React.useState<TransferProgressEvent | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setMode(searchRecords ? "export" : "import");
    setFilePath("");
    setProgress(null);
  }, [open, searchRecords]);

  React.useEffect(() => {
    if (!open || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen<TransferProgressEvent>("transfer-progress", (e) => {
      setProgress(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [open]);

  const handleBrowsePath = async () => {
    if (!isTauriRuntime()) return;
    try {
      if (mode === "import") {
        const picked = await openDialog({
          multiple: false,
          filters: [
            { name: "Data Files", extensions: ["jsonl", "ndjson", "json", "csv"] },
          ],
        });
        if (typeof picked === "string") {
          setFilePath(picked);
          if (picked.toLowerCase().endsWith(".csv")) setFormat("csv");
          else if (picked.toLowerCase().endsWith(".jsonl")) setFormat("jsonl");
        }
      } else {
        const picked = await saveDialog({
          defaultPath: `${collection ?? "records"}.${format}`,
          filters: [
            {
              name: format === "csv" ? "CSV File" : "JSONL File",
              extensions: [format],
            },
          ],
        });
        if (picked) setFilePath(picked);
      }
    } catch (err: unknown) {
      toast.error(
        "File picker failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filePath.trim() || busy) return;
    setBusy(true);
    try {
      if (mode === "import") {
        if (!target || !collection) return;
        const res = await importRecords(
          target,
          collection,
          filePath.trim(),
          format,
          {
            id_field: idField.trim() || null,
            vector_field: vectorField.trim() || null,
            text_field: textField.trim() || null,
            embedding_profile_id: embeddingProfileId || null,
          },
        );
        toast.success(
          `Imported ${res.imported} record(s)`,
          res.failed > 0 ? `${res.failed} failed` : undefined,
        );
        onImported?.();
        onOpenChange(false);
      } else if (searchRecords) {
        const res = await exportSearchResults(
          searchRecords,
          filePath.trim(),
          format,
          includeVectors,
        );
        toast.success(`Exported ${res.exported} search results`);
        onOpenChange(false);
      } else if (target && collection) {
        const res = await exportRecords(
          target,
          collection,
          filePath.trim(),
          format,
          includeVectors,
          exportLimit,
          null,
        );
        toast.success(`Exported ${res.exported} record(s) to ${res.dest_path}`);
        onOpenChange(false);
      }
    } catch (err: unknown) {
      toast.error(
        `${mode === "import" ? "Import" : "Export"} failed`,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        searchRecords
          ? "Export Search Results"
          : `Import / Export · ${collection ?? ""}`
      }
      description="Batch import JSONL or CSV records (with optional automatic text embedding) or export snapshots."
      maxWidthClass="w-[520px]"
    >
      <form onSubmit={(e) => void handleExecute(e)} className="space-y-4">
        {!searchRecords && (
          <div className="inline-flex rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("import")}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1 font-medium cursor-pointer",
                mode === "import"
                  ? "bg-[var(--accent-primary)] text-slate-950 font-semibold"
                  : "text-[var(--text-secondary)]",
              )}
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </button>
            <button
              type="button"
              onClick={() => setMode("export")}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1 font-medium cursor-pointer",
                mode === "export"
                  ? "bg-[var(--accent-primary)] text-slate-950 font-semibold"
                  : "text-[var(--text-secondary)]",
              )}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Format
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as TransferFormat)}
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)]"
            >
              <option value="jsonl">JSONL</option>
              <option value="csv">CSV</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              {mode === "import" ? "Source File Path" : "Destination File Path"}
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder={`C:\\path\\to\\records.${format}`}
                className="h-8 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[11px] text-[var(--text-primary)] focus:outline-none"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handleBrowsePath()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </Button>
            </div>
          </div>
        </div>

        {mode === "import" ? (
          <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                  ID Column
                </label>
                <input
                  type="text"
                  value={idField}
                  onChange={(e) => setIdField(e.target.value)}
                  className="h-7 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                  Vector Column
                </label>
                <input
                  type="text"
                  value={vectorField}
                  onChange={(e) => setVectorField(e.target.value)}
                  className="h-7 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                  Text Column
                </label>
                <input
                  type="text"
                  value={textField}
                  onChange={(e) => setTextField(e.target.value)}
                  className="h-7 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-[11px]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                Auto-Embed Missing Vectors (Optional)
              </label>
              <select
                value={embeddingProfileId}
                onChange={(e) => setEmbeddingProfileId(e.target.value)}
                className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)]"
              >
                <option value="">None (use vector column in file)</option>
                {embeddingProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.model_name})
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeVectors}
                onChange={(e) => setIncludeVectors(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
              />
              <span>Include raw float vectors</span>
            </label>

            {!searchRecords && (
              <label className="flex items-center gap-2">
                <span className="text-[var(--text-secondary)]">Max rows:</span>
                <input
                  type="number"
                  min={1}
                  max={50000}
                  value={exportLimit}
                  onChange={(e) => setExportLimit(Number(e.target.value))}
                  className="h-7 w-24 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                />
              </label>
            )}
          </div>
        )}

        {progress && (
          <div className="rounded-md border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 px-3 py-2 text-[11px] text-[var(--text-primary)]">
            {progress.message} ({progress.processed}/{progress.total})
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || !filePath.trim()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "import" ? "Start Import" : "Export File"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
