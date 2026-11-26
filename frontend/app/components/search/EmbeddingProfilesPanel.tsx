import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Star,
  Trash2,
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
import { useAppStore } from "@/stores/useAppStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type {
  EmbeddingProfile,
  UpdateEmbeddingProfilePayload,
} from "@/types/explorer";

type BackendProviderId =
  | "ollama"
  | "openai_compatible"
  | "gemini"
  | "cohere"
  | "voyage"
  | "huggingface_tei";

type ProviderOptionId =
  | "ollama"
  | "lm_studio"
  | "huggingface_tei"
  | "openai"
  | "gemini"
  | "cohere"
  | "voyage"
  | "openai_custom";

interface PopularModel {
  id: string;
  dimensions?: number;
}

interface ProviderOption {
  id: ProviderOptionId;
  backendProvider: BackendProviderId;
  category: "local" | "cloud";
  label: string;
  shortDesc: string;
  defaultBaseUrl: string;
  showBaseUrlByDefault: boolean;
  apiKeyMode: "none" | "optional" | "required";
  keyPlaceholder: string;
  keyHint: string;
  modelHint: string;
  urlHint: string;
  popularModels: readonly PopularModel[];
}

const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    id: "ollama",
    backendProvider: "ollama",
    category: "local",
    label: "Ollama",
    shortDesc: "Local daemon · free & private",
    defaultBaseUrl: "http://127.0.0.1:11434",
    showBaseUrlByDefault: true,
    apiKeyMode: "none",
    keyPlaceholder: "",
    keyHint: "",
    modelHint: "Run `ollama pull <model>` before testing.",
    urlHint: "Calls /api/embed with /api/embeddings fallback.",
    popularModels: [
      { id: "nomic-embed-text", dimensions: 768 },
      { id: "mxbai-embed-large", dimensions: 1024 },
      { id: "bge-m3", dimensions: 1024 },
      { id: "all-minilm", dimensions: 384 },
    ],
  },
  {
    id: "lm_studio",
    backendProvider: "openai_compatible",
    category: "local",
    label: "LM Studio / Local API",
    shortDesc: "Local OpenAI-compatible server",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    showBaseUrlByDefault: true,
    apiKeyMode: "optional",
    keyPlaceholder: "Optional for local servers",
    keyHint: "Optional · OS Keyring",
    modelHint: "Exact model identifier loaded in LM Studio or vLLM.",
    urlHint: "/v1/embeddings or /embeddings is appended automatically.",
    popularModels: [
      { id: "text-embedding-nomic-embed-text-v1.5", dimensions: 768 },
      { id: "text-embedding-bge-small-en-v1.5", dimensions: 384 },
    ],
  },
  {
    id: "huggingface_tei",
    backendProvider: "huggingface_tei",
    category: "local",
    label: "HuggingFace TEI",
    shortDesc: "Self-hosted or HF Inference TEI",
    defaultBaseUrl: "http://127.0.0.1:8080",
    showBaseUrlByDefault: true,
    apiKeyMode: "optional",
    keyPlaceholder: "hf_... (optional for local TEI)",
    keyHint: "Optional Bearer token · OS Keyring",
    modelHint: "Informational model label served by your TEI container.",
    urlHint: 'Calls POST {base}/embed with {"inputs": [...]}.',
    popularModels: [
      { id: "BAAI/bge-small-en-v1.5", dimensions: 384 },
      { id: "BAAI/bge-large-en-v1.5", dimensions: 1024 },
      { id: "intfloat/e5-small-v2", dimensions: 384 },
    ],
  },
  {
    id: "openai",
    backendProvider: "openai_compatible",
    category: "cloud",
    label: "OpenAI",
    shortDesc: "text-embedding-3-small / large",
    defaultBaseUrl: "https://api.openai.com/v1",
    showBaseUrlByDefault: false,
    apiKeyMode: "required",
    keyPlaceholder: "sk-...",
    keyHint: "OpenAI API key · OS Keyring",
    modelHint: "Standard OpenAI embedding model ID.",
    urlHint: "Defaults to https://api.openai.com/v1.",
    popularModels: [
      { id: "text-embedding-3-small", dimensions: 1536 },
      { id: "text-embedding-3-large", dimensions: 3072 },
    ],
  },
  {
    id: "gemini",
    backendProvider: "gemini",
    category: "cloud",
    label: "Google Gemini",
    shortDesc: "gemini-embedding-001",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    showBaseUrlByDefault: false,
    apiKeyMode: "required",
    keyPlaceholder: "AIza...",
    keyHint: "Google AI Studio key · OS Keyring",
    modelHint: "e.g. gemini-embedding-001 or text-embedding-004.",
    urlHint: "Calls /models/{model}:batchEmbedContents with x-goog-api-key.",
    popularModels: [
      { id: "gemini-embedding-001", dimensions: 3072 },
      { id: "text-embedding-004", dimensions: 768 },
    ],
  },
  {
    id: "cohere",
    backendProvider: "cohere",
    category: "cloud",
    label: "Cohere",
    shortDesc: "Cohere Embed v4 / v3",
    defaultBaseUrl: "https://api.cohere.com",
    showBaseUrlByDefault: false,
    apiKeyMode: "required",
    keyPlaceholder: "co-...",
    keyHint: "Cohere API key · OS Keyring",
    modelHint: "e.g. embed-v4.0 or embed-english-v3.0.",
    urlHint: "Calls /v2/embed with float embedding_types.",
    popularModels: [
      { id: "embed-v4.0", dimensions: 1536 },
      { id: "embed-english-v3.0", dimensions: 1024 },
      { id: "embed-multilingual-v3.0", dimensions: 1024 },
    ],
  },
  {
    id: "voyage",
    backendProvider: "voyage",
    category: "cloud",
    label: "Voyage AI",
    shortDesc: "Domain-tuned embeddings",
    defaultBaseUrl: "https://api.voyageai.com/v1",
    showBaseUrlByDefault: false,
    apiKeyMode: "required",
    keyPlaceholder: "pa-...",
    keyHint: "Voyage API key · OS Keyring",
    modelHint: "e.g. voyage-3-lite, voyage-3, voyage-code-3.",
    urlHint: "Calls /v1/embeddings with Bearer auth.",
    popularModels: [
      { id: "voyage-3-lite", dimensions: 512 },
      { id: "voyage-3", dimensions: 1024 },
      { id: "voyage-code-3", dimensions: 1024 },
    ],
  },
  {
    id: "openai_custom",
    backendProvider: "openai_compatible",
    category: "cloud",
    label: "Custom OpenAI-Compatible",
    shortDesc: "OpenRouter, Azure, proxy, etc.",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    showBaseUrlByDefault: true,
    apiKeyMode: "optional",
    keyPlaceholder: "sk-... / Bearer token",
    keyHint: "Bearer token · OS Keyring",
    modelHint: "Exact model ID expected by your custom endpoint.",
    urlHint: "/v1/embeddings or /embeddings is appended automatically.",
    popularModels: [{ id: "text-embedding-3-small", dimensions: 1536 }],
  },
];

const OPTION_MAP: Record<ProviderOptionId, ProviderOption> = Object.fromEntries(
  PROVIDER_OPTIONS.map((p) => [p.id, p]),
) as Record<ProviderOptionId, ProviderOption>;

const LOCAL_OPTIONS = PROVIDER_OPTIONS.filter((p) => p.category === "local");
const CLOUD_OPTIONS = PROVIDER_OPTIONS.filter((p) => p.category === "cloud");

interface InlineTestStatus {
  ok: boolean;
  message: string;
}

function detectOptionForProfile(profile: EmbeddingProfile): ProviderOption {
  const url = (profile.base_url ?? "").toLowerCase();
  switch (profile.provider) {
    case "ollama":
      return OPTION_MAP.ollama;
    case "gemini":
      return OPTION_MAP.gemini;
    case "cohere":
      return OPTION_MAP.cohere;
    case "voyage":
      return OPTION_MAP.voyage;
    case "huggingface_tei":
      return OPTION_MAP.huggingface_tei;
    case "openai_compatible":
      if (url.includes("127.0.0.1") || url.includes("localhost")) {
        return OPTION_MAP.lm_studio;
      }
      if (!url || url.includes("api.openai.com")) {
        return OPTION_MAP.openai;
      }
      return OPTION_MAP.openai_custom;
    default:
      return OPTION_MAP.ollama;
  }
}

function suggestProfileName(option: ProviderOption, model: string): string {
  const shortModel = model.trim().split("/").pop() || model.trim();
  return shortModel ? `${option.label} · ${shortModel}` : option.label;
}

function isLocalEndpoint(profile: EmbeddingProfile): boolean {
  if (profile.provider === "ollama") return true;
  const url = (profile.base_url ?? "").toLowerCase();
  return (
    url.includes("127.0.0.1") ||
    url.includes("localhost") ||
    url.includes("0.0.0.0")
  );
}

export function EmbeddingProfilesPanel({
  variant = "settings",
}: {
  variant?: "settings" | "dialog";
}) {
  const profiles = useTabsStore((s) => s.embeddingProfiles);
  const refreshConnectionsAndProfiles = useTabsStore(
    (s) => s.refreshConnectionsAndProfiles,
  );
  const defaultProfileId = useAppStore(
    (s) => s.preferences.defaultEmbeddingProfileId,
  );
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editingProfile, setEditingProfile] =
    React.useState<EmbeddingProfile | null>(null);

  const [optionId, setOptionId] = React.useState<ProviderOptionId>("ollama");
  const [name, setName] = React.useState(() =>
    suggestProfileName(
      OPTION_MAP.ollama,
      OPTION_MAP.ollama.popularModels[0].id,
    ),
  );
  const [nameDirty, setNameDirty] = React.useState(false);
  const [modelName, setModelName] = React.useState(
    OPTION_MAP.ollama.popularModels[0].id,
  );
  const [baseUrl, setBaseUrl] = React.useState(
    OPTION_MAP.ollama.defaultBaseUrl,
  );
  const [dimensions, setDimensions] = React.useState(
    String(OPTION_MAP.ollama.popularModels[0].dimensions ?? ""),
  );
  const [apiKey, setApiKey] = React.useState("");
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [clearSavedKey, setClearSavedKey] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [testingDraft, setTestingDraft] = React.useState(false);
  const [draftTestResult, setDraftTestResult] =
    React.useState<InlineTestStatus | null>(null);

  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null,
  );
  const [testStatuses, setTestStatuses] = React.useState<
    Record<string, InlineTestStatus>
  >({});

  const activeOption = OPTION_MAP[optionId];

  const openCreateForm = React.useCallback((selectedId: ProviderOptionId = "ollama") => {
    const opt = OPTION_MAP[selectedId];
    const firstModel = opt.popularModels[0];
    setEditingProfile(null);
    setOptionId(selectedId);
    setModelName(firstModel?.id ?? "");
    setDimensions(firstModel?.dimensions ? String(firstModel.dimensions) : "");
    setBaseUrl(opt.defaultBaseUrl);
    setName(suggestProfileName(opt, firstModel?.id ?? ""));
    setNameDirty(false);
    setApiKey("");
    setShowApiKey(false);
    setClearSavedKey(false);
    setDraftTestResult(null);
    setAdvancedOpen(opt.showBaseUrlByDefault);
    setConfirmDeleteId(null);
    setFormOpen(true);
  }, []);

  const openEditForm = (profile: EmbeddingProfile) => {
    const opt = detectOptionForProfile(profile);
    const resolvedUrl = profile.base_url ?? opt.defaultBaseUrl;
    setEditingProfile(profile);
    setOptionId(opt.id);
    setName(profile.name);
    setNameDirty(true);
    setModelName(profile.model_name);
    setBaseUrl(resolvedUrl);
    setDimensions(profile.dimensions != null ? String(profile.dimensions) : "");
    setApiKey("");
    setShowApiKey(false);
    setClearSavedKey(false);
    setDraftTestResult(null);
    setAdvancedOpen(
      opt.showBaseUrlByDefault || resolvedUrl !== opt.defaultBaseUrl,
    );
    setConfirmDeleteId(null);
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

  const handleSelectProvider = (nextId: ProviderOptionId) => {
    if (nextId === optionId) return;
    const prevOpt = OPTION_MAP[optionId];
    const nextOpt = OPTION_MAP[nextId];
    const firstModel = nextOpt.popularModels[0];

    setOptionId(nextId);
    setDraftTestResult(null);

    const nextModel =
      !editingProfile ||
      !modelName.trim() ||
      prevOpt.popularModels.some((m) => m.id === modelName.trim())
        ? (firstModel?.id ?? modelName)
        : modelName;

    setModelName(nextModel);

    if (!editingProfile) {
      setBaseUrl(nextOpt.defaultBaseUrl);
      if (firstModel?.dimensions) {
        setDimensions(String(firstModel.dimensions));
      } else {
        setDimensions("");
      }
      if (!nameDirty) {
        setName(suggestProfileName(nextOpt, nextModel));
      }
    } else if (!baseUrl.trim() || baseUrl.trim() === prevOpt.defaultBaseUrl) {
      setBaseUrl(nextOpt.defaultBaseUrl);
    }

    if (nextOpt.apiKeyMode === "none") {
      setShowApiKey(false);
    }
    if (nextOpt.showBaseUrlByDefault) {
      setAdvancedOpen(true);
    }
  };

  const handlePickModelChip = (model: PopularModel) => {
    setModelName(model.id);
    setDraftTestResult(null);
    if (model.dimensions) {
      setDimensions(String(model.dimensions));
    }
    if (!nameDirty) {
      setName(suggestProfileName(activeOption, model.id));
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
        provider: activeOption.backendProvider,
        model_name: modelName.trim(),
        base_url: baseUrl.trim() || null,
        api_key:
          activeOption.apiKeyMode !== "none" && !clearSavedKey && apiKey.trim()
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
          provider: activeOption.backendProvider,
          model_name: modelName.trim(),
          base_url: baseUrl.trim() || null,
          dimensions: parsedDimensions,
        };

        if (activeOption.apiKeyMode === "none" || clearSavedKey) {
          payload.api_key = null;
        } else if (apiKey.trim()) {
          payload.api_key = apiKey.trim();
        }

        await updateEmbeddingProfile(editingProfile.id, payload);
        await refreshConnectionsAndProfiles();
        toast.success(`Updated "${name.trim()}"`);
      } else {
        const created = await createEmbeddingProfile({
          name: name.trim(),
          provider: activeOption.backendProvider,
          model_name: modelName.trim(),
          base_url: baseUrl.trim() || null,
          dimensions: parsedDimensions,
          api_key:
            activeOption.apiKeyMode !== "none" && apiKey.trim()
              ? apiKey.trim()
              : null,
        });
        await refreshConnectionsAndProfiles();
        if (profiles.length === 0) {
          updatePreferences({ defaultEmbeddingProfileId: created.id });
        }
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
      if (defaultProfileId === profile.id) {
        updatePreferences({ defaultEmbeddingProfileId: null });
      }
      setConfirmDeleteId(null);
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

  const handleToggleDefault = (profile: EmbeddingProfile) => {
    const nextId = defaultProfileId === profile.id ? null : profile.id;
    updatePreferences({ defaultEmbeddingProfileId: nextId });
    toast.success(
      nextId
        ? `Default profile set to "${profile.name}"`
        : "Cleared default embedding profile",
    );
  };

  const hasSavedKey = Boolean(editingProfile?.secret_ref);

  if (formOpen) {
    return (
      <div className="space-y-4">
        {/* Form Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {editingProfile
                ? `Edit · ${editingProfile.name}`
                : "New Embedding Profile"}
            </h3>
          </div>
          <Badge variant={activeOption.category === "local" ? "accent" : "ai"}>
            {activeOption.category === "local" ? "Local" : "Cloud API"}
          </Badge>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* Unified Grouped Provider Selector */}
          <div className="space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                <Laptop className="h-3 w-3 text-[var(--accent-primary)]" />
                <span>Local & Self-Hosted</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {LOCAL_OPTIONS.map((opt) => {
                  const selected = optionId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectProvider(opt.id)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer",
                        selected
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                          : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]",
                      )}
                    >
                      <div className="text-xs font-semibold text-[var(--text-primary)]">
                        {opt.label}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
                        {opt.shortDesc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                <Cloud className="h-3 w-3 text-[var(--accent-ai)]" />
                <span>Cloud APIs</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
                {CLOUD_OPTIONS.map((opt) => {
                  const selected = optionId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelectProvider(opt.id)}
                      className={cn(
                        "rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer",
                        selected
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                          : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]",
                      )}
                    >
                      <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                        {opt.label}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
                        {opt.shortDesc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Model + Popular Chips + Profile Name */}
          <div className="space-y-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
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
                  onChange={(e) => {
                    const nextModel = e.target.value;
                    setModelName(nextModel);
                    if (!editingProfile && !nameDirty) {
                      setName(suggestProfileName(activeOption, nextModel));
                    }
                  }}
                  placeholder={activeOption.popularModels[0]?.id ?? "model-id"}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {activeOption.modelHint}
                </p>
              </div>

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
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameDirty(e.target.value.trim().length > 0);
                  }}
                  placeholder={suggestProfileName(activeOption, modelName)}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Label shown in Search, Migration, and Import dropdowns.
                </p>
              </div>
            </div>

            {activeOption.popularModels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-medium text-[var(--text-muted)]">
                  Popular:
                </span>
                {activeOption.popularModels.map((m) => {
                  const isCurrent = modelName.trim() === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handlePickModelChip(m)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors cursor-pointer",
                        isCurrent
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
                          : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      <span>{m.id}</span>
                      {m.dimensions && (
                        <span className="text-[var(--text-muted)]">
                          · {m.dimensions}d
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* API Key (shown only when provider uses auth) */}
            {activeOption.apiKeyMode !== "none" && (
              <div className="border-t border-[var(--border-subtle)] pt-3">
                <label
                  htmlFor="embed-profile-key"
                  className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]"
                >
                  API Key{" "}
                  <span className="text-[var(--text-muted)]">
                    ({activeOption.keyHint})
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
                        : activeOption.keyPlaceholder
                    }
                    className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] pl-2.5 pr-9 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    disabled={clearSavedKey}
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
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
                    <span>Remove saved API key from OS Keyring</span>
                  </label>
                )}
              </div>
            )}

            {/* Endpoint & Dimensions (auto-expanded for Local/Custom, collapsible for standard Cloud) */}
            <div className="border-t border-[var(--border-subtle)] pt-3">
              {!activeOption.showBaseUrlByDefault && (
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-left text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {advancedOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    <span>Endpoint & Dimensions</span>
                  </span>
                  {!advancedOpen && (
                    <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
                      {baseUrl || activeOption.defaultBaseUrl}
                      {dimensions ? ` · ${dimensions}d` : ""}
                    </span>
                  )}
                </button>
              )}

              {(activeOption.showBaseUrlByDefault || advancedOpen) && (
                <div
                  className={cn(
                    "grid grid-cols-1 gap-3.5 sm:grid-cols-3",
                    !activeOption.showBaseUrlByDefault && "mt-3",
                  )}
                >
                  <div className="min-w-0 sm:col-span-2">
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
                      placeholder={activeOption.defaultBaseUrl}
                      className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                    />
                    <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                      {activeOption.urlHint}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <label
                      htmlFor="embed-profile-dims"
                      className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      Dimensions
                    </label>
                    <input
                      id="embed-profile-dims"
                      type="number"
                      min={1}
                      value={dimensions}
                      onChange={(e) => setDimensions(e.target.value)}
                      placeholder="Auto"
                      className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                    />
                    <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                      Auto-filled on Test.
                    </p>
                  </div>
                </div>
              )}
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

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
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
                {editingProfile ? "Save Changes" : "Save Profile"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Compact Header Action Bar */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3",
          variant === "settings" &&
            "rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3.5",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent-ai)]" />
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              Configured Profiles
            </span>
            <Badge variant="ai">{profiles.length}</Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            Used by Semantic Search, Document Ingestion, Migration, and Batch
            Import.
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={() => openCreateForm("ollama")}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Profile
        </Button>
      </div>

      {/* Empty State: Unified Local vs Cloud Picker */}
      {profiles.length === 0 ? (
        <div className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
              <Laptop className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              <span>Run Locally (Free & Private)</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {LOCAL_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => openCreateForm(opt.id)}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-left transition-colors hover:border-[var(--accent-primary)]/60 hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {opt.label}
                    </span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" />
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    {opt.shortDesc}
                  </p>
                  <div className="mt-1.5 truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {opt.popularModels[0]?.id}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--border-subtle)] pt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
              <Cloud className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
              <span>Cloud Embedding APIs</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CLOUD_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => openCreateForm(opt.id)}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-left transition-colors hover:border-[var(--accent-ai)]/60 hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {opt.label}
                    </span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--accent-ai)]" />
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    {opt.shortDesc}
                  </p>
                  <div className="mt-1.5 truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {opt.popularModels[0]?.id}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => {
            const status = testStatuses[p.id];
            const isTesting = testingId === p.id;
            const opt = detectOptionForProfile(p);
            const local = isLocalEndpoint(p);
            const isDefault = defaultProfileId === p.id;
            const confirmingDelete = confirmDeleteId === p.id;

            return (
              <div
                key={p.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-[var(--bg-surface)] px-4 py-3 text-xs transition-colors",
                  isDefault
                    ? "border-[var(--accent-primary)]/50"
                    : "border-[var(--border-subtle)]",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {p.name}
                    </span>
                    <Badge
                      variant={local ? "accent" : "ai"}
                      className="text-[10px]"
                    >
                      {local ? (
                        <Laptop className="h-2.5 w-2.5" />
                      ) : (
                        <Cloud className="h-2.5 w-2.5" />
                      )}
                      {opt.label}
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
                    {isDefault && (
                      <Badge variant="running" className="text-[10px]">
                        <Star className="h-2.5 w-2.5 fill-current" />
                        Default
                      </Badge>
                    )}
                    {p.secret_ref && (
                      <span
                        title="API key stored in OS Keyring"
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                      >
                        <KeyRound className="h-2.5 w-2.5 text-[var(--accent-primary)]" />
                        Keyring
                      </span>
                    )}
                  </div>

                  <div className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                    {p.base_url || opt.defaultBaseUrl}
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
                    variant="ghost"
                    size="icon"
                    title={
                      isDefault
                        ? "Default profile for new Search tabs (click to clear)"
                        : "Set as default profile for new Search tabs"
                    }
                    aria-label={
                      isDefault
                        ? `Unset ${p.name} as default`
                        : `Set ${p.name} as default`
                    }
                    onClick={() => handleToggleDefault(p)}
                  >
                    <Star
                      className={cn(
                        "h-3.5 w-3.5",
                        isDefault
                          ? "fill-[var(--status-starting)] text-[var(--status-starting)]"
                          : "text-[var(--text-muted)]",
                      )}
                    />
                  </Button>
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

                  {confirmingDelete ? (
                    <div className="flex items-center gap-1 pl-1">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDelete(p)}
                      >
                        Delete
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Delete profile"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => setConfirmDeleteId(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--status-error)]" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
