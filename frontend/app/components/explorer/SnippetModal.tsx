import * as React from "react";
import { Check, Code2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import type { CodeSnippet } from "@/lib/snippets";
import { cn } from "@/lib/utils";

export function SnippetModal({
  open,
  onOpenChange,
  title,
  description,
  snippets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  snippets: CodeSnippet[];
}) {
  const [activeId, setActiveId] = React.useState<string>(
    snippets[0]?.id ?? "python",
  );
  const [copied, setCopied] = React.useState(false);
  const wasOpenRef = React.useRef(false);

  React.useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (justOpened) {
      setActiveId(snippets[0]?.id ?? "python");
      setCopied(false);
    }
  }, [open, snippets]);

  React.useEffect(() => {
    if (!open || snippets.length === 0) return;
    if (!snippets.some((s) => s.id === activeId)) {
      setActiveId(snippets[0].id);
    }
  }, [open, snippets, activeId]);

  const current =
    snippets.find((s) => s.id === activeId) ?? snippets[0] ?? null;

  const handleCopy = async () => {
    if (!current) return;
    await navigator.clipboard.writeText(current.code);
    setCopied(true);
    toast.success(`Copied ${current.label} snippet`);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<Code2 className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />}
      title={title}
      description={
        description ??
        "Ready-to-run client snippet using environment variable credential placeholders."
      }
      maxWidthClass="w-[min(92vw,680px)]"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5 text-xs">
            {snippets.map((snippet) => (
              <button
                key={snippet.id}
                type="button"
                onClick={() => {
                  setActiveId(snippet.id);
                  setCopied(false);
                }}
                className={cn(
                  "rounded-md px-3 py-1 font-medium transition-colors cursor-pointer",
                  current?.id === snippet.id
                    ? "bg-[var(--accent-primary)] text-slate-950 font-semibold"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {snippet.label}
              </button>
            ))}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!current}
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--status-running)]" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy Snippet"}
          </Button>
        </div>

        <pre className="max-h-[54vh] overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
          <code>{current?.code ?? ""}</code>
        </pre>
      </div>
    </Dialog>
  );
}
