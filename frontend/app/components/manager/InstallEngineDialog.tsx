import * as React from "react";
import {
  AlertTriangle,
  ArrowUpCircle,
  Download,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EngineIcon } from "@/components/ui/engine-icon";
import {
  compareVersionStrings,
  type EngineUpdateInfo,
} from "@/lib/engineVersions";
import { formatBytes } from "@/lib/format";
import type { CatalogEngineView } from "@/types/runtime";

export interface InstallEngineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  engine: CatalogEngineView;
  updateInfo: EngineUpdateInfo;
  initialVersion?: string;
  isInstalling: boolean;
  onConfirmInstall: (version: string) => void | Promise<void>;
}

/** Shared modal for selecting an engine release version and reviewing any install notice. */
export function InstallEngineDialog({
  open,
  onOpenChange,
  engine,
  updateInfo,
  initialVersion,
  isInstalling,
  onConfirmInstall,
}: InstallEngineDialogProps) {
  const recommended =
    engine.versions.find((v) => v.recommended) ?? engine.versions[0];
  const defaultVersion = initialVersion ?? recommended?.version ?? "";
  const [chosenVersion, setChosenVersion] = React.useState(defaultVersion);

  React.useEffect(() => {
    if (open) {
      setChosenVersion(initialVersion ?? recommended?.version ?? "");
    }
  }, [open, initialVersion, recommended]);

  const pickedVerObj =
    engine.versions.find((v) => v.version === chosenVersion) ?? recommended;

  if (!open || !pickedVerObj) {
    return null;
  }

  const isPickedUpdate = Boolean(
    !pickedVerObj.installed &&
      updateInfo.latestInstalledVersion &&
      compareVersionStrings(
        pickedVerObj.version,
        updateInfo.latestInstalledVersion,
      ) > 0,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<EngineIcon engineType={engine.engine_type} size="sm" />}
      title={`${isPickedUpdate ? "Update" : "Install"} ${engine.display_name}`}
      description="Select a release version to download, SHA-256 verify, and install locally."
      maxWidthClass="w-[520px]"
    >
      <div className="space-y-4">
        {engine.install_notice && (
          <div className="flex items-start gap-2.5 rounded-lg border border-[var(--status-starting)]/40 bg-[var(--status-starting)]/10 p-3 text-xs leading-relaxed text-[var(--text-primary)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-starting)]" />
            <span>{engine.install_notice}</span>
          </div>
        )}

        <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
          {engine.versions.map((ver) => {
            const selected = ver.version === pickedVerObj.version;
            return (
              <button
                key={ver.version}
                type="button"
                onClick={() => setChosenVersion(ver.version)}
                className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs transition-colors ${
                  selected
                    ? "bg-[var(--accent-primary)]/12"
                    : "hover:bg-[var(--bg-elevated)]/60"
                }`}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                      selected
                        ? "border-[var(--accent-primary)]"
                        : "border-[var(--border-strong)]"
                    }`}
                  >
                    {selected && (
                      <span className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
                    )}
                  </span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    v{ver.version}
                  </span>
                  {ver.recommended && <Badge variant="accent">Recommended</Badge>}
                  {ver.installed && <Badge variant="running">Installed</Badge>}
                </div>
                <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-[var(--text-muted)]">
                  <span>
                    {ver.size_bytes === 0
                      ? "Built-in"
                      : formatBytes(ver.size_bytes)}
                  </span>
                  {ver.sha256 && ver.sha256 !== "embedded" && (
                    <span className="hidden items-center gap-1 sm:inline-flex">
                      <ShieldCheck className="h-3 w-3 text-[var(--accent-primary)]" />
                      {ver.sha256.slice(0, 8)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
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
          <Button
            type="button"
            size="sm"
            disabled={pickedVerObj.installed || isInstalling}
            onClick={() => void onConfirmInstall(pickedVerObj.version)}
          >
            {isPickedUpdate ? (
              <ArrowUpCircle className="h-3.5 w-3.5" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {pickedVerObj.installed
              ? `v${pickedVerObj.version} Already Installed`
              : isPickedUpdate
                ? `Update to v${pickedVerObj.version}`
                : `Install v${pickedVerObj.version}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
