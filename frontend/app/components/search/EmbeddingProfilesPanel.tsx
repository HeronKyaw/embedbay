import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  createEmbeddingProfile,
  deleteEmbeddingProfile,
  testEmbeddingProfile,
  testEmbeddingProfileDraft,
  updateEmbeddingProfile,
} from "@/ipc/connections";
import { formatUserError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/stores/useTabsStore";
import type {
  EmbeddingProfile,
  UpdateEmbeddingProfilePayload,
} from "@/types/explorer";

type ProviderId = "ollama" | "openai_compatible";

interface EmbeddingPreset {
  id: string;
  label: string;
  subtitle: string;
  name: string;
  provider: ProviderId;
  modelName: string;
  baseUrl: string;
  dimensions: string;
}

const PROVIDER_DEFAULTS: Record<
  ProviderId,
  { baseUrl: string; modelName: string }
> = {
  ollama: {
    baseUrl: "http://127.0.0.1:11434",
    modelName: "nomic-embed-text",
  },
  openai_compatible: {
    baseUrl: "https://api.openai.com/v1",
    modelName: "text-embedding-3-small",
  },
};

const QUICK_PRESETS: readonly EmbeddingPreset[] = [
  {
    id: "ollama-nomic",
    label: "Local Ollama",
    subtitle: "Free & local via Ollama",
    name: "Local Nomic",
    provider: "ollama",
    modelName: "nomic-embed-text",
    baseUrl: "http://127.0.0.1:11434",
    dimensions: "768",
  },
  {
    id: "openai-small",
    label: "OpenAI",
    subtitle: "OpenAI cloud embeddings",
    name: "OpenAI Small",
    provider: "openai_compatible",
    modelName: "text-embedding-3-small",
    baseUrl: "https://api.openai.com/v1",
    dimensions: "1536",
  },
  {
    id: "lm-studio",
    label: "LM Studio / Local API",
    subtitle: "LM Studio, vLLM, or local server",
    name: "Local OpenAI",
    provider: "openai_compatible",
    modelName: "text-embedding-nomic-embed-text-v1.5",
    baseUrl: "http://127.0.0.1:1234/v1",
    dimensions: "",
  },
];

interface InlineTestStatus {
  ok: boolean;
  message: string;
}

function formatProviderLabel(provider: string): string {
  if (provider === "ollama") return "Local Ollama";
  if (provider === "openai_compatible") return "OpenAI-Compatible";
  return provider;
}

export function EmbeddingProfilesPanel() {
  const profiles = useTabsStore((s) => s.embeddingProfiles);
  const refreshConnectionsAndProfiles = useTabsStore(
    (s) => s.refreshConnectionsAndProfiles,
  );

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingProfile, setEditingProfile] =
    React.useState<EmbeddingProfile | null>(null);

  const [name, setName] = React.useState("");
  const [provider, setProvider] = React.useState<ProviderId>("ollama");
  const [modelName, setModelName] = React.useState(
    PROVIDER_DEFAULTS.ollama.modelName,
  );
  const [baseUrl, setBaseUrl] = React.useState(
    PROVIDER_DEFAULTS.ollama.baseUrl,
  );
  const [dimensions, setDimensions] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [clearSavedKey, setClearSavedKey] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [testingDraft, setTestingDraft] = React.useState(false);
  const [draftTestResult, setDraftTestResult] =
    React.useState<InlineTestStatus | null>(null);

  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testStatuses, setTestStatuses] = React.useState<
    Record<string, InlineTestStatus>
  >({});

  const resetFormFields = React.useCallback((preset?: EmbeddingPreset) => {
    setEditingProfile(null);
    setDraftTestResult(null);
    setShowApiKey(false);
    setClearSavedKey(false);
    setApiKey("");

    if (preset) {
      setName(preset.name);
      setProvider(preset.provider);
      setModelName(preset.modelName);
      setBaseUrl(preset.baseUrl);
      setDimensions(preset.dimensions);
    } else {
      setName("");
      setProvider("ollama");
      setModelName(PROVIDER_DEFAULTS.ollama.modelName);
      setBaseUrl(PROVIDER_DEFAULTS.ollama.baseUrl);
      setDimensions("");
    }
  }, []);

  const openCreateForm = (preset?: EmbeddingPreset) => {
    resetFormFields(preset);
    setFormOpen(true);
  };

  const openEditForm = (profile: EmbeddingProfile) => {
    const normalizedProvider: ProviderId =
      profile.provider === "openai_compatible" ? "openai_compatible" : "ollama";
    setEditingProfile(profile);
    setName(profile.name);
    setProvider(normalizedProvider);
    setModelName(profile.model_name);
    setBaseUrl(profile.base_url ?? PROVIDER_DEFAULTS[normalizedProvider].baseUrl);
    setDimensions(profile.dimensions != null ? String(profile.dimensions) : "");
    setApiKey("");
    setShowApiKey(false);
    setClearSavedKey(false);
    setDraftTestResult(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingProfile(null);
    setDraftTestResult(null);
    setApiKey("");
    setShowApiKey(false);
    setClearSavedKey(false);
  };

  const handleProviderChange = (next: ProviderId) => {
    if (next === provider) return;
    const prevDefaults = PROVIDER_DEFAULTS[provider];
    const nextDefaults = PROVIDER_DEFAULTS[next];

    setProvider(next);
    setDraftTestResult(null);

    if (!baseUrl.trim() || baseUrl.trim() === prevDefaults.baseUrl) {
      setBaseUrl(nextDefaults.baseUrl);
    }
    if (!modelName.trim() || modelName.trim() === prevDefaults.modelName) {
      setModelName(nextDefaults.modelName);
    }
    if (next !== "openai_compatible") {
      setShowApiKey(false);
    }
  };

  const handleTestDraft = async () => {
    if (!modelName.trim() || testingDraft) return;
    setTestingDraft(true);
    setDraftTestResult(null);
    try {
      const res = await testEmbeddingProfileDraft({
        profile_id:
          editingProfile && !clearSavedKey ? editingProfile.id : null,
        provider,
        model_name: modelName.trim(),
        base_url: baseUrl.trim() || null,
        api_key:
          provider === "openai_compatible" && !clearSavedKey && apiKey.trim()
            ? apiKey.trim()
            : null,
      });

      setDraftTestResult({ ok: true, message: res.message });
      if (!dimensions.trim() && res.dimensions > 0) {
        setDimensions(String(res.dimensions));
      }
    } catch (err: unknown) {
      setDraftTestResult({
        ok: false,
        message: formatUserError(err),
      });
    } finally {
      setTestingDraft(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !modelName.trim() || busy) return;

    let parsedDimensions: number | null = null;
    if (dimensions.trim()) {
      const num = Number(dimensions.trim());
      if (!Number.isInteger(num) || num <= 0) {
        toast.error("Dimensions must be a positive whole number");
        return;
      }
      parsedDimensions = num;
    }

    setBusy(true);
    try {
      if (editingProfile) {
        const payload: UpdateEmbeddingProfilePayload = {
          name: name.trim(),
          provider,
          model_name: modelName.trim(),
          base_url: baseUrl.trim() || null,
          dimensions: parsedDimensions,
        };

        if (provider !== "openai_compatible" || clearSavedKey) {
          payload.api_key = null;
        } else if (apiKey.trim()) {
          payload.api_key = apiKey.trim();
        }

        await updateEmbeddingProfile(editingProfile.id, payload);
        await refreshConnectionsAndProfiles();
        toast.success(`Updated "${name.trim()}"`);
      } else {
        await createEmbeddingProfile({
          name: name.trim(),
          provider,
          model_name: modelName.trim(),
          base_url: baseUrl.trim() || null,
          dimensions: parsedDimensions,
          api_key:
            provider === "openai_compatible" && apiKey.trim()
              ? apiKey.trim()
              : null,
        });
        await refreshConnectionsAndProfiles();
        toast.success(`Added "${name.trim()}"`);
      }
      closeForm();
    } catch (err: unknown) {
      toast.error(
        editingProfile
          ? "Failed to update embedding profile"
          : "Failed to create embedding profile",
        formatUserError(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleTestSaved = async (profile: EmbeddingProfile) => {
    if (testingId) return;
    setTestingId(profile.id);
    try {
      const res = await testEmbeddingProfile(profile.id);
      setTestStatuses((prev) => ({
        ...prev,
        [profile.id]: {
          ok: true,
          message: `Verified · ${res.dimensions}d · ${res.latency_ms} ms`,
        },
      }));
      toast.success("Embedding profile verified", res.message);

      if (profile.dimensions == null && res.dimensions > 0) {
        try {
          await updateEmbeddingProfile(profile.id, {
            dimensions: res.dimensions,
          });
          await refreshConnectionsAndProfiles();
        } catch {
          // Non-fatal if dimension backfill fails
        }
      }
    } catch (err: unknown) {
      const formatted = formatUserError(err);
      setTestStatuses((prev) => ({
        ...prev,
        [profile.id]: { ok: false, message: formatted },
      }));
      toast.error("Embedding test failed", formatted);
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (profile: EmbeddingProfile) => {
    try {
      await deleteEmbeddingProfile(profile.id);
      if (editingProfile?.id === profile.id) {
        closeForm();
      }
      setTestStatuses((prev) => {
        const next = { ...prev };
        delete next[profile.id];
        return next;
      });
      await refreshConnectionsAndProfiles();
      toast.info(`Removed "${profile.name}"`);
    } catch (err: unknown) {
      toast.error("Delete failed", formatUserError(err));
    }
  };

  const hasSavedKey = Boolean(editingProfile?.secret_ref);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      {/* Unified Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent-ai)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Embedding Profiles
            </h3>
            <Badge variant="ai">{profiles.length} configured</Badge>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Optional text-to-vector models for Semantic Search, Upsert Record,
            and Batch Import.
          </p>
        </div>

        {formOpen ? (
          <button
            type="button"
            onClick={closeForm}
            aria-label="Close profile form"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => openCreateForm()}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Profile
          </Button>
        )}
      </div>

      {/* Unified Body */}
      <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
        {formOpen ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-[var(--text-primary)]">
                {editingProfile
                  ? `Edit Profile · ${editingProfile.name}`
                  : "Add Embedding Profile"}
              </h4>

              {!editingProfile && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Quick presets:
                  </span>
                  {QUICK_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => openCreateForm(preset)}
                      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-ai)]/50 hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="mt-4 space-y-4"
            >
              {/* Provider Selector */}
              <div>
                <span className="mb-1.5 block text-[11px] font-medium text-[var(--text-secondary)]">
                  Provider
                </span>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => handleProviderChange("ollama")}
                    className={cn(
                      "min-w-0 rounded-lg border p-3 text-left transition-colors cursor-pointer",
                      provider === "ollama"
                        ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                        : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]",
                    )}
                  >
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      Local Ollama
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      Runs locally on your machine. No API key required.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProviderChange("openai_compatible")}
                    className={cn(
                      "min-w-0 rounded-lg border p-3 text-left transition-colors cursor-pointer",
                      provider === "openai_compatible"
                        ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                        : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]",
                    )}
                  >
                    <div className="text-xs font-semibold text-[var(--text-primary)]">
                      OpenAI-Compatible API
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      OpenAI, OpenRouter, LM Studio, vLLM, or any /v1/embeddings
                      API.
                    </p>
                  </button>
                </div>
              </div>

              {/* Row 1: Profile Name & Model Name */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div className="min-w-0">
                  <label
                    htmlFor="embed-profile-name"
                    className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    Profile Name{" "}
                    <span className="text-[var(--status-error)]">*</span>
                  </label>
                  <input
                    id="embed-profile-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Local Nomic"
                    className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    Shown in Search, Upsert, and Import dropdowns.
                  </p>
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="embed-profile-model"
                    className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    Model Name{" "}
                    <span className="text-[var(--status-error)]">*</span>
                  </label>
                  <input
                    id="embed-profile-model"
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder={
                      provider === "ollama"
                        ? "nomic-embed-text"
                        : "text-embedding-3-small"
                    }
                    className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    {provider === "ollama"
                      ? "Pull first with ollama pull <model>."
                      : "Exact model ID expected by your API."}
                  </p>
                </div>
              </div>

              {/* Row 2: Base URL */}
              <div className="min-w-0">
                <label
                  htmlFor="embed-profile-url"
                  className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]"
                >
                  Base URL
                </label>
                <input
                  id="embed-profile-url"
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={PROVIDER_DEFAULTS[provider].baseUrl}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {provider === "ollama"
                    ? "Calls /api/embed with /api/embeddings fallback."
                    : "/v1/embeddings or /embeddings is appended automatically."}
                </p>
              </div>

              {/* Row 3: API Key & Dimensions */}
              <div
                className={cn(
                  "grid grid-cols-1 gap-3.5",
                  provider === "openai_compatible"
                    ? "sm:grid-cols-2"
                    : "sm:grid-cols-1",
                )}
              >
                {provider === "openai_compatible" && (
                  <div className="min-w-0">
                    <label
                      htmlFor="embed-profile-key"
                      className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      API Key{" "}
                      <span className="text-[var(--text-muted)]">
                        (Optional for local servers · OS Keyring)
                      </span>
                    </label>
                    <div className="relative">
                      <input
                        id="embed-profile-key"
                        type={showApiKey ? "text" : "password"}
                        value={apiKey}
                        disabled={clearSavedKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={
                          hasSavedKey
                            ? "Saved in OS Keyring — leave blank to keep"
                            : "sk-..."
                        }
                        className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] pl-2.5 pr-9 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((v) => !v)}
                        disabled={clearSavedKey}
                        aria-label={
                          showApiKey ? "Hide API key" : "Show API key"
                        }
                        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
                      >
                        {showApiKey ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>

                    {hasSavedKey && (
                      <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={clearSavedKey}
                          onChange={(e) => {
                            setClearSavedKey(e.target.checked);
                            if (e.target.checked) setApiKey("");
                          }}
                          className="h-3.5 w-3.5 accent-[var(--status-error)]"
                        />
                        <span>Remove saved API key</span>
                      </label>
                    )}
                  </div>
                )}

                <div className="min-w-0">
                  <label
                    htmlFor="embed-profile-dims"
                    className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]"
                  >
                    Dimensions{" "}
                    <span className="text-[var(--text-muted)]">(Optional)</span>
                  </label>
                  <input
                    id="embed-profile-dims"
                    type="number"
                    min={1}
                    value={dimensions}
                    onChange={(e) => setDimensions(e.target.value)}
                    placeholder="Auto-detected on Test"
                    className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    Informational size reference; auto-filled when you run Test.
                  </p>
                </div>
              </div>

              {draftTestResult && (
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                    draftTestResult.ok
                      ? "border-[var(--status-running)]/40 bg-[var(--status-running)]/10 text-[var(--status-running)]"
                      : "border-[var(--status-error)]/40 bg-[var(--status-error)]/10 text-[var(--status-error)]",
                  )}
                >
                  {draftTestResult.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 break-words">
                    {draftTestResult.message}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!modelName.trim() || testingDraft}
                  onClick={() => void handleTestDraft()}
                >
                  {testingDraft ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--status-running)]" />
                  )}
                  Test Connection
                </Button>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={closeForm}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busy || !name.trim() || !modelName.trim()}
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {editingProfile ? "Save Changes" : "Add Profile"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        ) : profiles.length === 0 ? (
          <div>
            <div className="text-[11px] font-medium text-[var(--text-secondary)]">
              Quick start with a preset
            </div>
            <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {QUICK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => openCreateForm(preset)}
                  className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-left transition-colors hover:border-[var(--accent-ai)]/50 hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {preset.label}
                    </span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--accent-ai)]" />
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    {preset.subtitle}
                  </p>
                  <div className="mt-1.5 truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {preset.modelName}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => {
              const status = testStatuses[p.id];
              const isTesting = testingId === p.id;
              return (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-2.5 text-xs"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {p.name}
                      </span>
                      <Badge variant="ai" className="text-[10px]">
                        {formatProviderLabel(p.provider)}
                      </Badge>
                      <span className="font-mono text-[11px] text-[var(--accent-secondary)]">
                        {p.model_name}
                      </span>
                      {p.dimensions != null && (
                        <Badge
                          variant="default"
                          className="font-mono text-[10px]"
                        >
                          {p.dimensions}d
                        </Badge>
                      )}
                      {p.secret_ref && (
                        <span
                          title="API key stored in OS Keyring"
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                        >
                          <KeyRound className="h-2.5 w-2.5 text-[var(--accent-primary)]" />
                          Keyring
                        </span>
                      )}
                    </div>

                    <div className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                      {p.base_url ||
                        PROVIDER_DEFAULTS[
                          p.provider === "openai_compatible"
                            ? "openai_compatible"
                            : "ollama"
                        ].baseUrl}
                    </div>

                    {status && (
                      <div
                        className={cn(
                          "flex items-center gap-1.5 text-[11px]",
                          status.ok
                            ? "text-[var(--status-running)]"
                            : "text-[var(--status-error)]",
                        )}
                      >
                        {status.ok ? (
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                        ) : (
                          <AlertCircle className="h-3 w-3 shrink-0" />
                        )}
                        <span className="truncate">{status.message}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={Boolean(testingId)}
                      onClick={() => void handleTestSaved(p)}
                    >
                      {isTesting ? (
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
                      title="Edit profile"
                      aria-label={`Edit ${p.name}`}
                      onClick={() => openEditForm(p)}
                    >
                      <Pencil className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Delete profile"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => void handleDelete(p)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
