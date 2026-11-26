import * as React from "react";
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Database,
  KeyRound,
  LogOut,
  PackagePlus,
  Rocket,
  ScatterChart,
  Search,
  Sparkles,
} from "lucide-react";
import { EmbedBayLogo } from "@/components/layout/EmbedBayLogo";
import { ThemePickerCards } from "@/components/settings/ThemePickerCards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setCloseBehavior } from "@/ipc/system";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { useTabsStore } from "@/stores/useTabsStore";
import type { ActivitySection, CloseBehavior } from "@/types/system";

type StartDestination = "store" | "explorer" | "embeddings";

const STEPS = [
  { id: 0, label: "Welcome" },
  { id: 1, label: "Capabilities" },
  { id: 2, label: "Appearance" },
  { id: 3, label: "AI Stack" },
  { id: 4, label: "Launch" },
] as const;

export function OnboardingPage() {
  const completeOnboarding = useAppStore((s) => s.completeOnboarding);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const openSettings = useAppStore((s) => s.openSettings);
  const appStatus = useAppStore((s) => s.appStatus);
  const setAppStatus = useAppStore((s) => s.setAppStatus);
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);

  const installedCount = useRuntimeStore((s) => s.installedEngines.length);
  const instancesCount = useRuntimeStore((s) => s.instances.length);
  const profileCount = useTabsStore((s) => s.embeddingProfiles.length);

  const [step, setStep] = React.useState(0);
  const [direction, setDirection] = React.useState<"forward" | "backward">(
    "forward",
  );
  const [closeBusy, setCloseBusy] = React.useState(false);
  const [destination, setDestination] = React.useState<StartDestination>(() =>
    installedCount === 0 ? "store" : "explorer",
  );

  const goToStep = (nextStep: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, nextStep));
    if (clamped === step) return;
    setDirection(clamped > step ? "forward" : "backward");
    setStep(clamped);
  };

  const handleCloseBehavior = async (next: CloseBehavior) => {
    if (!appStatus || closeBusy || appStatus.close_behavior === next) return;
    setCloseBusy(true);
    try {
      const confirmed = await setCloseBehavior(next);
      setAppStatus({ ...appStatus, close_behavior: confirmed });
    } catch (err: unknown) {
      toast.error(
        "Failed to update close behavior",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setCloseBusy(false);
    }
  };

  const handleFinish = () => {
    completeOnboarding();
    if (destination === "embeddings") {
      openSettings("embeddings");
    } else {
      setActiveSection(destination);
    }
  };

  const closeBehavior: CloseBehavior = appStatus?.close_behavior ?? "tray";
  const isMac = appStatus?.platform.os === "macos";
  const progressPct = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      {/* Subtle Ambient Radial Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -top-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--accent-primary) 12%, transparent), color-mix(in srgb, var(--accent-secondary) 6%, transparent), transparent 70%)",
          }}
        />
      </div>

      {/* Top Progress Header */}
      <header className="relative z-10 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {STEPS.map((s) => {
              const active = step === s.id;
              const done = step > s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goToStep(s.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                    active
                      ? "bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]"
                      : done
                        ? "text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-4 w-4 items-center justify-center rounded-full font-mono text-[10px]",
                      active
                        ? "bg-[var(--accent-primary)] font-semibold text-slate-950"
                        : done
                          ? "bg-[var(--status-running)]/20 text-[var(--status-running)]"
                          : "bg-[var(--bg-elevated)] text-[var(--text-muted)]",
                    )}
                  >
                    {s.id + 1}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              );
            })}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={completeOnboarding}
          >
            Skip setup
          </Button>
        </div>

        {/* Animated Progress Track */}
        <div className="h-0.5 w-full bg-[var(--border-subtle)]/60">
          <div
            className="h-full bg-[var(--accent-primary)] transition-all duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      {/* Main Centered Animated Viewport */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div
          key={step}
          className={cn(
            "mx-auto my-auto w-full max-w-3xl",
            direction === "forward"
              ? "onboard-step-forward"
              : "onboard-step-backward",
          )}
        >
          {/* PAGE 1: Welcome */}
          {step === 0 && (
            <div className="flex flex-col items-center text-center">
              <div
                className="onboard-stagger relative mb-5 rounded-3xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 shadow-xl"
                style={{ animationDelay: "30ms" }}
              >
                <EmbedBayLogo size={68} />
              </div>

              <div
                className="onboard-stagger flex items-center gap-2"
                style={{ animationDelay: "80ms" }}
              >
                <Badge variant="accent" className="font-mono">
                  EmbedBay v{appStatus?.app_version ?? "0.1.0"}
                </Badge>
                <Badge variant="default">Native Desktop Workbench</Badge>
              </div>

              <h1
                className="onboard-stagger mt-4 text-3xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl"
                style={{ animationDelay: "130ms" }}
              >
                Welcome to EmbedBay
              </h1>

              <p
                className="onboard-stagger mt-3 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]"
                style={{ animationDelay: "180ms" }}
              >
                Your native command center for running local vector databases,
                exploring collections, testing semantic search, and projecting
                high-dimensional embeddings—with zero Docker required.
              </p>

              <div
                className="onboard-stagger mt-7 flex flex-wrap items-center justify-center gap-2"
                style={{ animationDelay: "240ms" }}
              >
                {[
                  { icon: Boxes, label: "Zero-Docker Engines" },
                  { icon: Database, label: "Vector Explorer" },
                  { icon: Search, label: "Semantic Search" },
                  { icon: ScatterChart, label: "3D Embedding Maps" },
                ].map((pill) => {
                  const Icon = pill.icon;
                  return (
                    <span
                      key={pill.label}
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-primary)]"
                    >
                      <Icon className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                      {pill.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* PAGE 2: Discover Capabilities */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                  What You Can Build & Inspect
                </h2>
                <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                  Everything needed to run, query, debug, and migrate vector
                  workloads in one workspace.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {[
                  {
                    icon: Boxes,
                    accent: "text-[var(--accent-primary)]",
                    title: "Zero-Docker Local Runtimes",
                    desc: "Download and supervise native Qdrant, Chroma, pgvector, LanceDB, SQLite-vec, and DuckDB instances with live CPU/RAM telemetry and idle auto-stop.",
                    delay: "40ms",
                  },
                  {
                    icon: Database,
                    accent: "text-[var(--accent-secondary)]",
                    title: "Unified Vector & Cloud Explorer",
                    desc: "Browse collections, filter metadata, edit records, import/export JSONL & CSV, and connect remote Pinecone, Weaviate, or Milvus clusters.",
                    delay: "100ms",
                  },
                  {
                    icon: Search,
                    accent: "text-[var(--accent-ai)]",
                    title: "Semantic Search & Doc Ingestion",
                    desc: "Pair Ollama, OpenAI, Gemini, Cohere, or Voyage embedding profiles to query with plain text, chunk local documents, and compare scores.",
                    delay: "160ms",
                  },
                  {
                    icon: ScatterChart,
                    accent: "text-[var(--status-running)]",
                    title: "3D Vector Maps & Safe Backups",
                    desc: "Project embeddings into interactive 2D/3D PCA & UMAP scatter plots and create stop-before-zip snapshots to back up or restore instances.",
                    delay: "220ms",
                  },
                ].map((card) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.title}
                      className="onboard-stagger rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
                      style={{ animationDelay: card.delay }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                          <Icon className={cn("h-4 w-4", card.accent)} />
                        </span>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          {card.title}
                        </h3>
                      </div>
                      <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                        {card.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* PAGE 3: Appearance & Window Behavior */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="text-center">
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                  Make It Feel Like Home
                </h2>
                <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                  Choose your theme and how EmbedBay behaves when you close the
                  window.
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                <div className="mb-3 text-xs font-semibold text-[var(--text-primary)]">
                  Theme
                </div>
                <ThemePickerCards />
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                <div className="mb-3 text-xs font-semibold text-[var(--text-primary)]">
                  When Closing Window
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={closeBusy}
                    onClick={() => void handleCloseBehavior("tray")}
                    aria-pressed={closeBehavior === "tray"}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors cursor-pointer",
                      closeBehavior === "tray"
                        ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                        : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]",
                    )}
                  >
                    <AppWindow className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
                    <div>
                      <div className="text-xs font-semibold text-[var(--text-primary)]">
                        Minimize to System Tray
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                        Keep local vector databases running quietly in the
                        background.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={closeBusy}
                    onClick={() => void handleCloseBehavior("quit")}
                    aria-pressed={closeBehavior === "quit"}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors cursor-pointer",
                      closeBehavior === "quit"
                        ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                        : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]",
                    )}
                  >
                    <LogOut className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-secondary)]" />
                    <div>
                      <div className="text-xs font-semibold text-[var(--text-primary)]">
                        Quit EmbedBay
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                        Stop all running local databases and exit completely.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3.5">
                <div>
                  <div className="text-xs font-semibold text-[var(--text-primary)]">
                    Default Startup View
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Initial section opened on future app launches.
                  </p>
                </div>
                <select
                  value={preferences.defaultSection}
                  onChange={(e) =>
                    updatePreferences({
                      defaultSection: e.target.value as ActivitySection,
                    })
                  }
                  className="h-8 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                >
                  <option value="explorer">Vector Explorer</option>
                  <option value="runtimes">Local Runtimes</option>
                  <option value="store">Engine Store</option>
                </select>
              </div>
            </div>
          )}

          {/* PAGE 4: Engines & Embeddings Stack */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="text-center">
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                  Engines & Embedding Profiles
                </h2>
                <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                  Database runtimes and text-to-vector models work independently
                  so you can pair any model with any collection.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                      <PackagePlus className="h-4 w-4 text-[var(--accent-primary)]" />
                      Vector Engines
                    </div>
                    <Badge variant={installedCount > 0 ? "running" : "default"}>
                      {installedCount} installed · {instancesCount} instances
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                    Start instantly with built-in zero-download embedded engines
                    (<strong className="text-[var(--text-primary)]">LanceDB</strong>,{" "}
                    <strong className="text-[var(--text-primary)]">
                      SQLite-vec
                    </strong>
                    ), or install native{" "}
                    <strong className="text-[var(--text-primary)]">Qdrant</strong>,{" "}
                    <strong className="text-[var(--text-primary)]">Chroma</strong>,
                    and{" "}
                    <strong className="text-[var(--text-primary)]">
                      pgvector
                    </strong>{" "}
                    binaries with SHA-256 verification.
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                      <Sparkles className="h-4 w-4 text-[var(--accent-ai)]" />
                      Embedding Profiles
                    </div>
                    <Badge variant={profileCount > 0 ? "running" : "ai"}>
                      {profileCount} configured
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                    Use <strong className="text-[var(--text-primary)]">Ollama</strong>{" "}
                    or{" "}
                    <strong className="text-[var(--text-primary)]">
                      LM Studio
                    </strong>{" "}
                    locally for free private embeddings, or connect{" "}
                    <strong className="text-[var(--text-primary)]">
                      OpenAI, Gemini, Cohere, or Voyage AI
                    </strong>
                    .
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <KeyRound className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
                    API keys are saved in your OS Keyring, never plaintext
                    SQLite.
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-xs text-[var(--text-secondary)]">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--status-running)]" />
                <span>
                  Everything is optional and configurable anytime inside{" "}
                  <strong className="text-[var(--text-primary)]">
                    Settings
                  </strong>{" "}
                  ({isMac ? "⌘," : "Ctrl+,"}).
                </span>
              </div>
            </div>
          )}

          {/* PAGE 5: Ready to Launch */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
                  <Rocket className="h-5 w-5" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                  Choose Your Starting Point
                </h2>
                <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                  Pick where you&apos;d like to jump in first—you can switch
                  workspaces anytime.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(
                  [
                    {
                      id: "store" as const,
                      title: "Engine Store",
                      desc: "Install Qdrant, Chroma, pgvector, or enable LanceDB.",
                      icon: PackagePlus,
                    },
                    {
                      id: "explorer" as const,
                      title: "Vector Explorer",
                      desc: "Browse collections or connect a remote cloud cluster.",
                      icon: Database,
                    },
                    {
                      id: "embeddings" as const,
                      title: "Embedding Profiles",
                      desc: "Set up Ollama, OpenAI, or Gemini embedding models.",
                      icon: Sparkles,
                    },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const selected = destination === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDestination(item.id)}
                      className={cn(
                        "rounded-xl border p-4 text-left transition-all cursor-pointer",
                        selected
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 ring-1 ring-[var(--accent-primary)]/40"
                          : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]",
                      )}
                    >
                      <Icon className="h-5 w-5 text-[var(--accent-primary)]" />
                      <div className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                        {item.title}
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {item.desc}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Handy Shortcuts
                </div>
                <div className="grid grid-cols-1 gap-2.5 text-xs sm:grid-cols-3">
                  <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2">
                    <span className="text-[var(--text-secondary)]">
                      Command Palette
                    </span>
                    <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-primary)]">
                      {isMac ? "⌘K" : "Ctrl+K"}
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2">
                    <span className="text-[var(--text-secondary)]">
                      Settings
                    </span>
                    <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-primary)]">
                      {isMac ? "⌘," : "Ctrl+,"}
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2">
                    <span className="text-[var(--text-secondary)]">
                      Replay Guide
                    </span>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      Settings → About
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Sticky Navigation Footer */}
      <footer className="relative z-10 shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            {step > 0 && (
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={() => goToStep(step - 1)}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            <span className="font-mono text-xs text-[var(--text-muted)]">
              Step {step + 1} of {STEPS.length}
            </span>
          </div>

          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              size="default"
              onClick={() => goToStep(step + 1)}
            >
              {step === 0 ? "Get Started" : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" size="default" onClick={handleFinish}>
              Launch EmbedBay
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
