import * as React from "react";
import { CheckCircle2, Globe, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  createRemoteConnection,
  updateRemoteConnection,
} from "@/ipc/connections";
import { testConnection } from "@/ipc/explorer";
import { cn } from "@/lib/utils";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import { SWATCH_PRESETS } from "@/types/system";

const REMOTE_ENGINES = [
  { id: "qdrant", label: "Qdrant", hint: "https://your-cluster.qdrant.io:6333" },
  { id: "chroma", label: "Chroma", hint: "http://127.0.0.1:8000" },
  { id: "pgvector", label: "PostgreSQL + pgvector", hint: "postgresql://user@host:5432/dbname?sslmode=require" },
  { id: "pinecone", label: "Pinecone", hint: "https://your-index-project.svc.pinecone.io" },
  { id: "weaviate", label: "Weaviate", hint: "https://your-cluster.weaviate.network" },
  { id: "milvus", label: "Milvus / Zilliz", hint: "https://in01-xxxx.serverless.gcp-us-west1.cloud.zilliz.com" },
  { id: "elasticsearch", label: "Elasticsearch", hint: "https://localhost:9200" },
  { id: "redis_stack", label: "Redis Stack", hint: "redis://127.0.0.1:6379" },
] as const;

export function RemoteConnectionModal() {
  const open = useTabsStore((s) => s.remoteModalOpen);
  const editing = useTabsStore((s) => s.editingRemoteConnection);
  const closeModal = useTabsStore((s) => s.closeRemoteModal);
  const refreshConnectionsAndProfiles = useTabsStore(
    (s) => s.refreshConnectionsAndProfiles,
  );
  const groups = useRuntimeStore((s) => s.groups);
  const tags = useRuntimeStore((s) => s.tags);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [color, setColor] = React.useState<string>(SWATCH_PRESETS[7].hex); // Rose default for remote warning
  const [groupId, setGroupId] = React.useState("");
  const [engineType, setEngineType] = React.useState("qdrant");
  const [endpointUrl, setEndpointUrl] = React.useState("");
  const [authType, setAuthType] = React.useState("api_key");
  const [secret, setSecret] = React.useState("");
  const [extraJson, setExtraJson] = React.useState("{}");
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [testResult, setTestResult] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTestResult(null);
    if (editing) {
      setName(editing.name);
      setDescription(editing.description ?? "");
      setColor(editing.color ?? SWATCH_PRESETS[7].hex);
      setGroupId(editing.group_id ?? "");
      setEngineType(editing.engine_type);
      setEndpointUrl(editing.endpoint_url);
      setAuthType(editing.auth_type);
      setSecret("");
      setExtraJson(editing.extra_json || "{}");
      setSelectedTags(editing.tag_ids);
    } else {
      setName("");
      setDescription("");
      setColor(SWATCH_PRESETS[7].hex);
      setGroupId("");
      setEngineType("qdrant");
      setEndpointUrl("");
      setAuthType("api_key");
      setSecret("");
      setExtraJson("{}");
      setSelectedTags([]);
    }
  }, [open, editing]);

  const currentEngineMeta =
    REMOTE_ENGINES.find((e) => e.id === engineType) ?? REMOTE_ENGINES[0];

  const handleTest = async () => {
    if (!endpointUrl.trim() || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res =
        editing && !secret.trim()
          ? await testConnection({
              kind: "remote_connection",
              connection_id: editing.id,
            })
          : await testConnection({
              kind: "direct",
              engine_type: engineType,
              endpoint_url: endpointUrl.trim(),
              auth_type: authType,
              secret: secret.trim() || null,
              extra_json: extraJson.trim() || "{}",
            });
      setTestResult(`${res.message} (${res.latency_ms} ms)`);
      toast.success("Connection verified", res.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult(`Error: ${msg}`);
      toast.error("Connection test failed", msg);
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !endpointUrl.trim() || saving) return;
    try {
      JSON.parse(extraJson || "{}");
    } catch {
      toast.error("Invalid Extra JSON", "Ensure extra options are valid JSON.");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateRemoteConnection(editing.id, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          group_id: groupId || null,
          engine_type: engineType,
          endpoint_url: endpointUrl.trim(),
          auth_type: authType,
          secret:
            authType === "none"
              ? null
              : secret.trim()
                ? secret.trim()
                : undefined,
          extra_json: extraJson.trim() || "{}",
          tag_ids: selectedTags,
        });
        toast.success(`Updated "${name.trim()}"`);
      } else {
        await createRemoteConnection({
          name: name.trim(),
          description: description.trim() || null,
          color,
          group_id: groupId || null,
          engine_type: engineType,
          endpoint_url: endpointUrl.trim(),
          auth_type: authType,
          secret: authType === "none" ? null : secret.trim() || null,
          extra_json: extraJson.trim() || "{}",
          tag_ids: selectedTags,
        });
        toast.success(
          `Saved remote connection "${name.trim()}"`,
          "API credentials stored in Windows Credential Manager.",
        );
      }
      await refreshConnectionsAndProfiles();
      closeModal();
    } catch (err: unknown) {
      toast.error(
        "Failed to save connection",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeModal();
      }}
      title={editing ? `Edit Remote: ${editing.name}` : "Add Remote Connection"}
      description="Connect to cloud or self-hosted vector databases. Secrets are stored in the OS keyring, never plaintext SQLite."
      maxWidthClass="w-[560px]"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Connection Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Prod Pinecone US-East"
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Engine Type
            </label>
            <select
              value={engineType}
              onChange={(e) => setEngineType(e.target.value)}
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            >
              {REMOTE_ENGINES.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Endpoint URL / Connection URI
          </label>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
            <input
              type="text"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder={currentEngineMeta.hint}
              className="h-8 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Authentication Mode
            </label>
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value)}
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            >
              <option value="none">None (Open / Local)</option>
              <option value="api_key">API Key / Bearer Token</option>
              <option value="basic">Basic Auth (Base64 / User:Pass)</option>
            </select>
          </div>

          {authType !== "none" && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                API Key / Secret{" "}
                {editing?.secret_ref && (
                  <span className="text-[var(--text-muted)]">
                    (leave blank to keep existing)
                  </span>
                )}
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={
                  editing?.secret_ref
                    ? "Stored securely in OS Keyring"
                    : "Paste API key or token..."
                }
                className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Group
            </label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            >
              <option value="">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Badge Color (Rose = Prod Warning)
            </label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {SWATCH_PRESETS.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  onClick={() => setColor(swatch.hex)}
                  title={swatch.label}
                  className={cn(
                    "h-5 w-5 rounded-full border-2 cursor-pointer",
                    color === swatch.hex
                      ? "scale-110 border-[var(--text-primary)]"
                      : "border-transparent opacity-75 hover:opacity-100",
                  )}
                  style={{ backgroundColor: swatch.hex }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Description (Optional)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Production index — read carefully"
            className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Engine Options JSON{" "}
            <span className="text-[var(--text-muted)]">
              (e.g. {`{"namespace":"prod"}`} or {`{"tenant":"default_tenant"}`})
            </span>
          </label>
          <input
            type="text"
            value={extraJson}
            onChange={(e) => setExtraJson(e.target.value)}
            className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        {tags.length > 0 && (
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Tags
            </label>
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => {
                const active = selectedTags.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setSelectedTags((prev) =>
                        prev.includes(t.id)
                          ? prev.filter((x) => x !== t.id)
                          : [...prev, t.id],
                      )
                    }
                    style={{ "--pill-color": t.color } as React.CSSProperties}
                    className={cn(
                      "tag-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium cursor-pointer",
                      active
                        ? "ring-1 ring-[var(--text-primary)]"
                        : "opacity-55 hover:opacity-90",
                    )}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {testResult && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
              testResult.startsWith("Error:")
                ? "border-[var(--status-error)]/40 bg-[var(--status-error)]/10 text-[var(--status-error)]"
                : "border-[var(--status-running)]/40 bg-[var(--status-running)]/10 text-[var(--status-running)]",
            )}
          >
            {testResult.startsWith("Error:") ? (
              <ShieldAlert className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">{testResult}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={testing || !endpointUrl.trim()}
            onClick={() => void handleTest()}
          >
            {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Test Connection
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeModal}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || !name.trim() || !endpointUrl.trim()}
            >
              {editing ? "Save Connection" : "Add Connection"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
