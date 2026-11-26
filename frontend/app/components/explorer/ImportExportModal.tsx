import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  Download,
  FileText,
  FolderOpen,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { isTauriRuntime } from "@/ipc/system";
import {
  exportRecords,
  exportSearchResults,
  importRecords,
  ingestDocuments,
  previewDocumentChunks,
  type ChunkStrategy,
  type DocumentChunkPreview,
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
  readOnly = false,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ConnectionTarget | null;
  collection: string | null;
  searchRecords?: VectorRecord[] | null;
  readOnly?: boolean;
  onImported?: () => void;
}) {
  const embeddingProfiles = useTabsStore((s) => s.embeddingProfiles);

  const [mode, setMode] = React.useState<"import" | "export" | "documents">(
    searchRecords || readOnly ? "export" : "import",
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

  // Document ingestion state
  const [docPaths, setDocPaths] = React.useState<string[]>([]);
  const [chunkStrategy, setChunkStrategy] =
    React.useState<ChunkStrategy>("markdown_headers");
  const [chunkSize, setChunkSize] = React.useState(800);
  const [chunkOverlap, setChunkOverlap] = React.useState(120);
  const [docProfileId, setDocProfileId] = React.useState("");
  const [chunkPreview, setChunkPreview] =
    React.useState<DocumentChunkPreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const wasOpenRef = React.useRef(false);

  React.useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setMode(searchRecords || readOnly ? "export" : "import");
    setFilePath("");
    setProgress(null);
    setDocPaths([]);
    setChunkPreview(null);
    setDocProfileId(embeddingProfiles[0]?.id ?? "");
  }, [open, searchRecords, readOnly, embeddingProfiles]);

  React.useEffect(() => {
    if (open && !docProfileId && embeddingProfiles.length > 0) {
      setDocProfileId(embeddingProfiles[0].id);
    }
  }, [open, docProfileId, embeddingProfiles]);

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

  const refreshChunkPreview = React.useCallback(
    async (
      paths: string[],
      strategy: ChunkStrategy,
      size: number,
      overlap: number,
    ) => {
      if (paths.length === 0 || !isTauriRuntime()) {
        setChunkPreview(null);
        return;
      }
      setPreviewing(true);
      try {
        const res = await previewDocumentChunks(paths, {
          strategy,
          chunk_size: Math.max(64, size),
          chunk_overlap: Math.max(0, overlap),
        });
        setChunkPreview(res);
      } catch (err: unknown) {
        toast.error(
          "Chunk preview failed",
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        setPreviewing(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (mode !== "documents" || docPaths.length === 0) return;
    const t = window.setTimeout(() => {
      void refreshChunkPreview(
        docPaths,
        chunkStrategy,
        chunkSize,
        chunkOverlap,
      );
    }, 200);
    return () => window.clearTimeout(t);
  }, [mode, docPaths, chunkStrategy, chunkSize, chunkOverlap, refreshChunkPreview]);

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

  const handlePickDocFiles = async () => {
    if (!isTauriRuntime()) return;
    try {
      const picked = await openDialog({
        multiple: true,
        filters: [{ name: "Documents", extensions: ["md", "txt"] }],
      });
      if (Array.isArray(picked) && picked.length > 0) {
        setDocPaths((prev) => Array.from(new Set([...prev, ...picked])));
      } else if (typeof picked === "string") {
        setDocPaths((prev) => Array.from(new Set([...prev, picked])));
      }
    } catch (err: unknown) {
      toast.error(
        "File picker failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handlePickDocFolder = async () => {
    if (!isTauriRuntime()) return;
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked === "string") {
        setDocPaths((prev) => Array.from(new Set([...prev, picked])));
      }
    } catch (err: unknown) {
      toast.error(
        "Folder picker failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (mode === "documents") {
      if (!target || !collection || docPaths.length === 0 || !docProfileId) {
        toast.error("Select at least one file/folder and an embedding profile");
        return;
      }
      setBusy(true);
      try {
        const res = await ingestDocuments(
          target,
          collection,
          docPaths,
          {
            strategy: chunkStrategy,
            chunk_size: Math.max(64, chunkSize),
            chunk_overlap: Math.max(0, chunkOverlap),
          },
          docProfileId,
        );
        toast.success(
          `Ingested ${res.chunks_ingested} chunk(s) from ${res.files_processed} file(s)`,
          res.failed > 0 ? `${res.failed} failed` : undefined,
        );
        onImported?.();
        onOpenChange(false);
      } catch (err: unknown) {
        toast.error(
          "Document ingestion failed",
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!filePath.trim()) return;
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
      description="Batch import JSONL/CSV records, chunk & embed Markdown/Text documents, or export snapshots."
      maxWidthClass={mode === "documents" ? "w-[min(92vw,680px)]" : "w-[540px]"}
    >
      <form onSubmit={(e) => void handleExecute(e)} className="space-y-4">
        {!searchRecords && (
          <div className="inline-flex flex-wrap rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-0.5 text-xs">
            <button
              type="button"
              disabled={readOnly}
              title={readOnly ? "Disabled in Read-Only mode" : undefined}
              onClick={() => setMode("import")}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1 font-medium cursor-pointer disabled:pointer-events-none disabled:opacity-45",
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
            <button
              type="button"
              disabled={readOnly}
              title={readOnly ? "Disabled in Read-Only mode" : undefined}
              onClick={() => setMode("documents")}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1 font-medium cursor-pointer disabled:pointer-events-none disabled:opacity-45",
                mode === "documents"
                  ? "bg-[var(--accent-ai)] text-white font-semibold"
                  : "text-[var(--text-secondary)]",
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              Documents (.md / .txt)
            </button>
          </div>
        )}

        {mode === "documents" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handlePickDocFiles()}
              >
                <FileText className="h-3.5 w-3.5" />
                Add .md / .txt Files
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void handlePickDocFolder()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Add Folder
              </Button>
              {docPaths.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDocPaths([]);
                    setChunkPreview(null);
                  }}
                  className="text-[11px] text-[var(--status-error)] hover:underline cursor-pointer"
                >
                  Clear ({docPaths.length})
                </button>
              )}
            </div>

            {docPaths.length > 0 && (
              <div className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
                {docPaths.map((p) => (
                  <span
                    key={p}
                    className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]"
                  >
                    <span className="truncate max-w-[260px]" title={p}>
                      {p}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setDocPaths((prev) => prev.filter((item) => item !== p))
                      }
                      className="text-[var(--text-muted)] hover:text-[var(--status-error)] cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                  Chunking Strategy
                </label>
                <select
                  value={chunkStrategy}
                  onChange={(e) =>
                    setChunkStrategy(e.target.value as ChunkStrategy)
                  }
                  className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="markdown_headers">Markdown Headers</option>
                  <option value="recursive">Recursive Character</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                  Chunk Size (chars)
                </label>
                <input
                  type="number"
                  min={64}
                  max={16000}
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value))}
                  className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-[var(--text-muted)]">
                  Overlap (chars)
                </label>
                <input
                  type="number"
                  min={0}
                  max={4000}
                  value={chunkOverlap}
                  onChange={(e) => setChunkOverlap(Number(e.target.value))}
                  className="h-8 w-full rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                Embedding Profile <span className="text-[var(--status-error)]">*</span>
              </label>
              <select
                value={docProfileId}
                onChange={(e) => setDocProfileId(e.target.value)}
                className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)]"
              >
                {embeddingProfiles.length === 0 ? (
                  <option value="">No embedding profiles configured</option>
                ) : (
                  embeddingProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.model_name})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Live Chunk Preview */}
            <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[var(--text-primary)]">
                  Chunk Preview
                </span>
                {previewing ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Chunking...
                  </span>
                ) : chunkPreview ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="default" className="font-mono text-[10px]">
                      {chunkPreview.total_files} file(s)
                    </Badge>
                    <Badge variant="accent" className="font-mono text-[10px]">
                      {chunkPreview.total_chunks} chunks
                    </Badge>
                    <Badge variant="ai" className="font-mono text-[10px]">
                      Avg {chunkPreview.avg_chunk_length} chars
                    </Badge>
                  </div>
                ) : null}
              </div>

              <div className="max-h-48 space-y-2 overflow-y-auto">
                {!chunkPreview || chunkPreview.chunks.length === 0 ? (
                  <div className="py-4 text-center text-[11px] text-[var(--text-muted)]">
                    Select `.md` or `.txt` files or a directory to preview chunks.
                  </div>
                ) : (
                  chunkPreview.chunks.map((c, idx) => (
                    <div
                      key={`${c.source_file}:${c.chunk_index}:${idx}`}
                      className="space-y-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2 text-[11px]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-semibold text-[var(--accent-secondary)]">
                            {c.file_name} #{c.chunk_index + 1}
                          </span>
                          {c.heading && (
                            <Badge variant="ai" className="text-[9px]">
                              {c.heading}
                            </Badge>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-[var(--text-muted)]">
                          {c.char_count} chars
                        </span>
                      </div>
                      <p className="line-clamp-3 whitespace-pre-wrap text-[11px] text-[var(--text-secondary)]">
                        {c.text}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
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
          </>
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
          {mode === "documents" ? (
            <Button
              type="submit"
              size="sm"
              disabled={
                busy || readOnly || docPaths.length === 0 || !docProfileId
              }
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Embed &amp; Ingest
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={busy || !filePath.trim()}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {mode === "import" ? "Start Import" : "Export File"}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
