import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import type { ThemeMode } from "@/types/system";

function ThemePreviewCard({
  mode,
  title,
  subtitle,
  selected,
  liveBadge,
  onSelect,
}: {
  mode: ThemeMode;
  title: string;
  subtitle: string;
  selected: boolean;
  liveBadge?: string;
  onSelect: () => void;
}) {
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border text-left transition-all cursor-pointer",
        selected
          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/8 ring-1 ring-[var(--accent-primary)]/40"
          : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] hover:border-[var(--border-strong)]",
      )}
    >
      {/* Mini UI Chrome Preview */}
      <div className="relative h-20 w-full overflow-hidden border-b border-[var(--border-subtle)]">
        {mode === "light" && (
          <div className="flex h-full w-full bg-[#F8FAFC] p-2">
            <div className="w-7 rounded border border-[#E2E8F0] bg-[#FFFFFF] p-1">
              <div className="h-1.5 w-full rounded-sm bg-[#0D9488]" />
              <div className="mt-1 h-1 w-3/4 rounded-sm bg-[#CBD5E1]" />
              <div className="mt-1 h-1 w-3/4 rounded-sm bg-[#CBD5E1]" />
            </div>
            <div className="ml-1.5 flex-1 rounded border border-[#E2E8F0] bg-[#FFFFFF] p-1.5">
              <div className="flex items-center justify-between">
                <div className="h-1.5 w-10 rounded-sm bg-[#0F172A]/80" />
                <div className="h-2 w-4 rounded-full bg-[#0D9488]/20" />
              </div>
              <div className="mt-2 space-y-1">
                <div className="h-1.5 w-full rounded-sm bg-[#F1F5F9]" />
                <div className="h-1.5 w-4/5 rounded-sm bg-[#F1F5F9]" />
              </div>
            </div>
          </div>
        )}

        {mode === "dark" && (
          <div className="flex h-full w-full bg-[#090C12] p-2">
            <div className="w-7 rounded border border-[#1E2738] bg-[#10151F] p-1">
              <div className="h-1.5 w-full rounded-sm bg-[#14B8A6]" />
              <div className="mt-1 h-1 w-3/4 rounded-sm bg-[#2B374D]" />
              <div className="mt-1 h-1 w-3/4 rounded-sm bg-[#2B374D]" />
            </div>
            <div className="ml-1.5 flex-1 rounded border border-[#1E2738] bg-[#10151F] p-1.5">
              <div className="flex items-center justify-between">
                <div className="h-1.5 w-10 rounded-sm bg-[#F1F5F9]/80" />
                <div className="h-2 w-4 rounded-full bg-[#14B8A6]/30" />
              </div>
              <div className="mt-2 space-y-1">
                <div className="h-1.5 w-full rounded-sm bg-[#161D2B]" />
                <div className="h-1.5 w-4/5 rounded-sm bg-[#161D2B]" />
              </div>
            </div>
          </div>
        )}

        {mode === "system" && (
          <div className="relative flex h-full w-full">
            {/* Left half: Light */}
            <div className="flex h-full w-1/2 bg-[#F8FAFC] p-2 pr-0.5">
              <div className="flex-1 rounded-l border border-r-0 border-[#E2E8F0] bg-[#FFFFFF] p-1.5">
                <div className="h-1.5 w-7 rounded-sm bg-[#0D9488]" />
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 w-full rounded-sm bg-[#F1F5F9]" />
                  <div className="h-1.5 w-3/4 rounded-sm bg-[#F1F5F9]" />
                </div>
              </div>
            </div>
            {/* Right half: Dark */}
            <div className="flex h-full w-1/2 bg-[#090C12] p-2 pl-0.5">
              <div className="flex-1 rounded-r border border-l-0 border-[#1E2738] bg-[#10151F] p-1.5">
                <div className="ml-auto h-1.5 w-7 rounded-sm bg-[#14B8A6]" />
                <div className="mt-2 space-y-1">
                  <div className="h-1.5 w-full rounded-sm bg-[#161D2B]" />
                  <div className="ml-auto h-1.5 w-3/4 rounded-sm bg-[#161D2B]" />
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" />
          </div>
        )}

        {selected && (
          <span className="absolute top-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-slate-950 shadow">
            <Check className="h-3 w-3 stroke-[2.5]" />
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
            <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" />
            <span>{title}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            {subtitle}
          </p>
        </div>
        {liveBadge && (
          <Badge variant="accent" className="shrink-0 text-[10px]">
            {liveBadge}
          </Badge>
        )}
      </div>
    </button>
  );
}

export function ThemePickerCards() {
  const theme = useAppStore((s) => s.theme);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <ThemePreviewCard
        mode="light"
        title="Light"
        subtitle="Crisp daylight workspace"
        selected={theme === "light"}
        onSelect={() => setTheme("light")}
      />
      <ThemePreviewCard
        mode="dark"
        title="Dark"
        subtitle="Deep Harbor Charcoal"
        selected={theme === "dark"}
        onSelect={() => setTheme("dark")}
      />
      <ThemePreviewCard
        mode="system"
        title="Auto"
        subtitle="Follows OS theme"
        selected={theme === "system"}
        liveBadge={
          theme === "system"
            ? resolvedTheme === "dark"
              ? "Dark"
              : "Light"
            : undefined
        }
        onSelect={() => setTheme("system")}
      />
    </div>
  );
}
