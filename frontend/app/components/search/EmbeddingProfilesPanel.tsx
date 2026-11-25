import * as React from "react";
import {
  CheckCircle2,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  createEmbeddingProfile,
  deleteEmbeddingProfile,
  testEmbeddingProfile,
} from "@/ipc/connections";
import { useTabsStore } from "@/stores/useTabsStore";

export function EmbeddingProfilesPanel() {
  const profiles = useTabsStore((s) => s.embeddingProfiles);
  const refreshConnectionsAndProfiles = useTabsStore(
    (s) => s.refreshConnectionsAndProfiles,
  );

  const [name, setName] = React.useState("");
  const [provider, setProvider] = React.useState<"ollama" | "openai_compatible">(
    "ollama",
  );
  const [modelName, setModelName] = React.useState("nomic-embed-text");
  const [baseUrl, setBaseUrl] = React.useState("http://127.0.0.1:11434");
  const [dimensions, setDimensions] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);

  const handleProviderChange = (next: "ollama" | "openai_compatible") => {
    setProvider(next);
    if (next === "ollama") {
      setBaseUrl("http://127.0.0.1:11434");
      setModelName("nomic-embed-text");
    } else {
      setBaseUrl("https://api.openai.com/v1");
      setModelName("text-embedding-3-small");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !modelName.trim() || busy) return;
    setBusy(true);
    try {
      await createEmbeddingProfile({
        name: name.trim(),
        provider,
        model_name: modelName.trim(),
        base_url: baseUrl.trim() || null,
        dimensions: dimensions.trim() ? Number(dimensions.trim()) : null,
        api_key: provider === "openai_compatible" && apiKey.trim() ? apiKey.trim() : null,
      });
      setName("");
      setApiKey("");
      await refreshConnectionsAndProfiles();
      toast.success("Added embedding profile");
    } catch (err: unknown) {
      toast.error(
        "Failed to create embedding profile",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await testEmbeddingProfile(id);
      toast.success("Embedding profile verified", res.message);
    } catch (err: unknown) {
      toast.error(
        "Embedding test failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteEmbeddingProfile(id);
      await refreshConnectionsAndProfiles();
      toast.info("Removed embedding profile");
    } catch (err: unknown) {
      toast.error(
        "Delete failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
          <Sparkles className="h-4 w-4 text-[var(--accent-ai)]" />
          Embedding Profiles (Text-to-Vector Search & Batch Import)
        </div>
        <Badge variant="ai">{profiles.length} configured</Badge>
      </div>

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Profile name (e.g. Local Nomic)"
          className="h-8 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)] focus:outline-none"
        />

        <select
          value={provider}
          onChange={(e) =>
            handleProviderChange(
              e.target.value as "ollama" | "openai_compatible",
            )
          }
          className="h-8 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)] focus:outline-none"
        >
          <option value="ollama">Local Ollama</option>
          <option value="openai_compatible">OpenAI-Compatible API</option>
        </select>

        <input
          type="text"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder="Model name"
          className="h-8 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 font-mono text-xs text-[var(--text-primary)] focus:outline-none"
        />

        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="Base URL"
          className="h-8 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 font-mono text-xs text-[var(--text-primary)] focus:outline-none"
        />

        <input
          type="number"
          value={dimensions}
          onChange={(e) => setDimensions(e.target.value)}
          placeholder="Dimensions (optional)"
          className="h-8 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 font-mono text-xs text-[var(--text-primary)] focus:outline-none"
        />

        <div className="flex gap-2">
          {provider === "openai_compatible" && (
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API key (OS Keyring)"
              className="h-8 flex-1 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 font-mono text-xs text-[var(--text-primary)] focus:outline-none"
            />
          )}
          <Button
            type="submit"
            size="sm"
            disabled={busy || !name.trim() || !modelName.trim()}
            className="shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>
      </form>

      {profiles.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {profiles.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {p.name}
                  </span>
                  <Badge variant="ai" className="text-[10px]">
                    {p.provider}
                  </Badge>
                  <span className="font-mono text-[11px] text-[var(--accent-secondary)]">
                    {p.model_name}
                  </span>
                </div>
                <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                  {p.base_url}
                  {p.dimensions ? ` · ${p.dimensions}d` : ""}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={testingId === p.id}
                  onClick={() => void handleTest(p.id)}
                >
                  {testingId === p.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-[var(--status-running)]" />
                  )}
                  Test
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void handleDelete(p.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
