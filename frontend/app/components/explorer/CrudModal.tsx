import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { embedTexts } from "@/ipc/connections";
import { createCollection, upsertRecords } from "@/ipc/explorer";
import { useTabsStore } from "@/stores/useTabsStore";
import type { ConnectionTarget } from "@/types/explorer";

export function CreateCollectionModal({
  open,
  onOpenChange,
  target,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ConnectionTarget | null;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [dimensions, setDimensions] = React.useState(384);
  const [metric, setMetric] = React.useState<"cosine" | "dot" | "euclidean">(
    "cosine",
  );
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setDimensions(384);
      setMetric("cosine");
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !name.trim() || busy) return;
    setBusy(true);
    try {
      await createCollection(target, {
        name: name.trim(),
        dimensions: Math.max(1, dimensions),
        distance_metric: metric,
      });
      toast.success(`Created collection "${name.trim()}"`);
      onCreated(name.trim());
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(
        "Failed to create collection",
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
      title="Create Collection"
      description="Create a new vector collection / index on the active database."
      maxWidthClass="w-[420px]"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Collection Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. docs_embeddings"
            autoFocus
            className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Dimensions
            </label>
            <input
              type="number"
              min={1}
              max={65536}
              value={dimensions}
              onChange={(e) => setDimensions(Number(e.target.value))}
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Distance Metric
            </label>
            <select
              value={metric}
              onChange={(e) =>
                setMetric(e.target.value as "cosine" | "dot" | "euclidean")
              }
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            >
              <option value="cosine">Cosine</option>
              <option value="dot">Dot Product</option>
              <option value="euclidean">Euclidean (L2)</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            Create Collection
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function UpsertRecordModal({
  open,
  onOpenChange,
  target,
  collection,
  expectedDimensions,
  onUpserted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ConnectionTarget | null;
  collection: string | null;
  expectedDimensions?: number | null;
  onUpserted: () => void;
}) {
  const embeddingProfiles = useTabsStore((s) => s.embeddingProfiles);

  const [id, setId] = React.useState("");
  const [documentText, setDocumentText] = React.useState("");
  const [payloadText, setPayloadText] = React.useState("{}");
  const [vectorText, setVectorText] = React.useState("");
  const [profileId, setProfileId] = React.useState("");
  const [embeddingBusy, setEmbeddingBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setId(crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    setDocumentText("");
    setPayloadText('{\n  "source": "manual"\n}');
    setVectorText(
      expectedDimensions && expectedDimensions <= 16
        ? JSON.stringify(
            Array.from({ length: expectedDimensions }, () => 0.1),
          )
        : "",
    );
    setProfileId(embeddingProfiles[0]?.id ?? "");
  }, [open, expectedDimensions, embeddingProfiles]);

  const handleEmbedDocument = async () => {
    if (!profileId || !documentText.trim() || embeddingBusy) return;
    setEmbeddingBusy(true);
    try {
      const [vecs, ms] = await embedTexts(profileId, [documentText]);
      if (vecs[0]) {
        setVectorText(JSON.stringify(vecs[0]));
        toast.success(`Embedded ${vecs[0].length}d vector in ${ms} ms`);
      }
    } catch (err: unknown) {
      toast.error(
        "Embedding failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setEmbeddingBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !collection || !id.trim() || saving) return;

    let payload: Record<string, unknown>;
    try {
      const raw = JSON.parse(payloadText || "{}");
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        toast.error("Payload must be a JSON object");
        return;
      }
      payload = raw as Record<string, unknown>;
    } catch {
      toast.error("Invalid payload JSON");
      return;
    }

    let vector: number[] | null = null;
    if (vectorText.trim()) {
      try {
        const cleaned = vectorText.trim().startsWith("[")
          ? JSON.parse(vectorText.trim())
          : vectorText
              .split(/[\s,]+/)
              .filter(Boolean)
              .map(Number);
        if (
          !Array.isArray(cleaned) ||
          cleaned.some((n) => typeof n !== "number" || !Number.isFinite(n))
        ) {
          toast.error("Vector must be a valid array of finite numbers");
          return;
        }
        vector = cleaned;
      } catch {
        toast.error("Invalid vector array syntax");
        return;
      }
    }

    setSaving(true);
    try {
      await upsertRecords(target, collection, [
        {
          id: id.trim(),
          payload,
          document: documentText.trim() || null,
          vector,
        },
      ]);
      toast.success(`Upserted record ${id.trim()}`);
      onUpserted();
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(
        "Upsert failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Upsert Record · ${collection ?? ""}`}
      description="Insert or update a vector point and JSON metadata."
      maxWidthClass="w-[540px]"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Record ID (UUID or Integer)
          </label>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] font-medium text-[var(--text-secondary)]">
              Document Text (Optional)
            </label>
            {embeddingProfiles.length > 0 && (
              <div className="flex items-center gap-1.5">
                <select
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                  className="h-6 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-1.5 text-[10px] text-[var(--text-primary)]"
                >
                  {embeddingProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.model_name})
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  disabled={embeddingBusy || !documentText.trim()}
                  onClick={() => void handleEmbedDocument()}
                >
                  {embeddingBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3 text-[var(--accent-ai)]" />
                  )}
                  Embed Text
                </Button>
              </div>
            )}
          </div>
          <textarea
            rows={2}
            value={documentText}
            onChange={(e) => setDocumentText(e.target.value)}
            placeholder="Text document to store and optionally embed..."
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Vector Floats{" "}
            {expectedDimensions
              ? `(expected ${expectedDimensions} dimensions)`
              : "(JSON array or comma-separated)"}
          </label>
          <textarea
            rows={3}
            value={vectorText}
            onChange={(e) => setVectorText(e.target.value)}
            placeholder="[0.12, -0.04, 0.88, ...]"
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Metadata Payload (JSON)
          </label>
          <textarea
            rows={4}
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !id.trim()}>
            Upsert Record
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
