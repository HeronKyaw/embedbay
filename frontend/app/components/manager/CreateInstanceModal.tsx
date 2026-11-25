import * as React from "react";
import { AlertTriangle, CheckCircle2, FolderOpen, Wand2 } from "lucide-react";
import { TagPicker } from "@/components/sidebar/TagPicker";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  checkPortAvailable,
  createInstance,
  suggestAvailablePort,
  updateInstance,
} from "@/ipc/instances";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import { SWATCH_PRESETS } from "@/types/system";

function suggestUniqueInstanceName(
  baseName: string,
  existingNames: string[],
): string {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  if (!taken.has(baseName.trim().toLowerCase())) {
    return baseName;
  }
  let suffix = 2;
  while (taken.has(`${baseName} ${suffix}`.trim().toLowerCase())) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

export function CreateInstanceModal({
  onPickDirectory,
}: {
  onPickDirectory?: (current: string) => Promise<string | null>;
}) {
  const open = useRuntimeStore((s) => s.createModalOpen);
  const editing = useRuntimeStore((s) => s.editingInstance);
  const defaultEngine = useRuntimeStore((s) => s.createModalDefaultEngine);
  const closeModal = useRuntimeStore((s) => s.closeInstanceModal);
  const catalog = useRuntimeStore((s) => s.catalog);
  const installedEngines = useRuntimeStore((s) => s.installedEngines);
  const instances = useRuntimeStore((s) => s.instances);
  const groups = useRuntimeStore((s) => s.groups);
  const refreshInstances = useRuntimeStore((s) => s.refreshInstances);
  const setActiveSection = useAppStore((s) => s.setActiveSection);

  const [engineType, setEngineType] = React.useState("qdrant");
  const [engineVersion, setEngineVersion] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [color, setColor] = React.useState<string>(SWATCH_PRESETS[0].hex);
  const [groupId, setGroupId] = React.useState<string>("");
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [host, setHost] = React.useState("127.0.0.1");
  const [port, setPort] = React.useState(6333);
  const [grpcPort, setGrpcPort] = React.useState<string>("6334");
  const [dataDir, setDataDir] = React.useState("");
  const [configJson, setConfigJson] = React.useState("{}");
  const [autoStart, setAutoStart] = React.useState(false);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = React.useState(0);
  const [portAvailable, setPortAvailable] = React.useState<boolean | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);

  const installedForEngine = installedEngines.filter(
    (e) => e.engine_type === engineType,
  );
  const catalogEntry = catalog.find((c) => c.engine_type === engineType);
  const isEmbedded = catalogEntry?.embedded ?? engineType === "lancedb";
  const trimmedName = name.trim();
  const nameConflict =
    trimmedName.length > 0 &&
    instances.some(
      (i) => i.id !== editing?.id && i.name.trim() === trimmedName,
    );

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setEngineType(editing.engine_type);
      setEngineVersion(editing.engine_version);
      setName(editing.name);
      setDescription(editing.description ?? "");
      setColor(editing.color ?? SWATCH_PRESETS[0].hex);
      setGroupId(editing.group_id ?? "");
      setSelectedTags(editing.tag_ids);
      setHost(editing.host);
      setPort(editing.port);
      setGrpcPort(editing.grpc_port ? String(editing.grpc_port) : "");
      setDataDir(editing.data_dir);
      setConfigJson(editing.config_json || "{}");
      setAutoStart(editing.auto_start);
      setIdleTimeoutMinutes(editing.idle_timeout_minutes ?? 0);
      setPortAvailable(null);
      return;
    }

    const chosenEngine =
      defaultEngine ??
      installedEngines[0]?.engine_type ??
      catalog[0]?.engine_type ??
      "qdrant";
    const entry = catalog.find((c) => c.engine_type === chosenEngine);
    const matchingInstalled = installedEngines.filter(
      (i) => i.engine_type === chosenEngine,
    );

    setEngineType(chosenEngine);
    setEngineVersion(matchingInstalled[0]?.version ?? "");
    const existingNames = useRuntimeStore
      .getState()
      .instances.map((i) => i.name);
    setName(
      suggestUniqueInstanceName(
        `Local ${entry?.display_name ?? chosenEngine}`,
        existingNames,
      ),
    );
    setDescription("");
    setColor(SWATCH_PRESETS[0].hex);
    setGroupId("");
    setSelectedTags([]);
    setHost("127.0.0.1");
    setDataDir("");
    setConfigJson("{}");
    setAutoStart(false);
    setIdleTimeoutMinutes(0);

    const basePort = entry?.default_port ?? 6333;
    setPort(basePort);
    setGrpcPort(
      entry?.default_grpc_port ? String(entry.default_grpc_port) : "",
    );
    if (!entry?.embedded) {
      void suggestAvailablePort(basePort, "127.0.0.1").then((free) => {
        setPort(free);
        if (entry?.default_grpc_port) {
          void suggestAvailablePort(free + 1, "127.0.0.1").then((gFree) => {
            setGrpcPort(String(gFree));
          });
        }
      });
    }
  }, [open, editing, defaultEngine, installedEngines, catalog]);

  const handleEngineChange = (nextEngine: string) => {
    setEngineType(nextEngine);
    const entry = catalog.find((c) => c.engine_type === nextEngine);
    const matching = installedEngines.filter(
      (i) => i.engine_type === nextEngine,
    );
    setEngineVersion(matching[0]?.version ?? "");
    if (!editing) {
      setName(
        suggestUniqueInstanceName(
          `Local ${entry?.display_name ?? nextEngine}`,
          instances.map((i) => i.name),
        ),
      );
      const basePort = entry?.default_port ?? 6333;
      setPort(basePort);
      setGrpcPort(
        entry?.default_grpc_port ? String(entry.default_grpc_port) : "",
      );
      if (!entry?.embedded) {
        void suggestAvailablePort(basePort, host).then(setPort);
      }
    }
  };

  React.useEffect(() => {
    if (!open || isEmbedded || port <= 0) {
      setPortAvailable(null);
      return;
    }
    let active = true;
    void checkPortAvailable(port, host).then((ok) => {
      if (active) setPortAvailable(ok);
    });
    return () => {
      active = false;
    };
  }, [open, host, port, isEmbedded]);

  const handleAutoPickPort = async () => {
    try {
      const free = await suggestAvailablePort(Math.max(1024, port), host);
      setPort(free);
      setPortAvailable(true);
    } catch (err: unknown) {
      toast.error(
        "Port scan failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;

    if (nameConflict) {
      toast.error(
        "Instance name already exists",
        "Choose a unique name for this instance.",
      );
      return;
    }

    if (!isEmbedded && !engineVersion) {
      toast.error(
        "No installed engine version",
        "Install this engine in the Engine Store first.",
      );
      return;
    }

    try {
      JSON.parse(configJson || "{}");
    } catch {
      toast.error("Invalid config JSON", "Fix JSON syntax before saving.");
      return;
    }

    setBusy(true);
    try {
      const parsedGrpc =
        !isEmbedded && grpcPort.trim() ? Number(grpcPort.trim()) : null;

      if (editing) {
        await updateInstance(editing.id, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          group_id: groupId || null,
          engine_version: engineVersion || editing.engine_version,
          host: host.trim() || "127.0.0.1",
          port: isEmbedded ? 0 : port,
          grpc_port: parsedGrpc,
          data_dir: dataDir.trim() || undefined,
          config_json: configJson.trim() || "{}",
          auto_start: autoStart,
          idle_timeout_minutes: idleTimeoutMinutes,
          tag_ids: selectedTags,
        });
        toast.success(`Updated instance "${name.trim()}"`);
      } else {
        await createInstance({
          name: name.trim(),
          description: description.trim() || null,
          color,
          group_id: groupId || null,
          engine_type: engineType,
          engine_version:
            engineVersion ||
            catalogEntry?.versions[0]?.version ||
            "embedded-1.0",
          host: host.trim() || "127.0.0.1",
          port: isEmbedded ? 0 : port,
          grpc_port: parsedGrpc,
          data_dir: dataDir.trim() || null,
          config_json: configJson.trim() || "{}",
          auto_start: autoStart,
          idle_timeout_minutes: idleTimeoutMinutes,
          tag_ids: selectedTags,
        });
        toast.success(`Created instance "${name.trim()}"`);
      }

      await refreshInstances();
      closeModal();
    } catch (err: unknown) {
      toast.error(
        "Failed to save instance",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeModal();
      }}
      title={editing ? `Edit Instance: ${editing.name}` : "New Local Instance"}
      description="Configure isolated data storage, network ports, group assignment, tags, and boot startup."
      maxWidthClass="w-[580px]"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* Engine & Version */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Database Engine
            </label>
            <select
              value={engineType}
              disabled={Boolean(editing)}
              onChange={(e) => handleEngineChange(e.target.value)}
              className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] disabled:opacity-60 focus:border-[var(--accent-primary)] focus:outline-none"
            >
              {catalog.map((c) => (
                <option key={c.engine_type} value={c.engine_type}>
                  {c.display_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Installed Version
            </label>
            {isEmbedded ? (
              <div className="flex h-8 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--accent-primary)]">
                embedded-1.0 (Zero Daemon)
              </div>
            ) : installedForEngine.length > 0 ? (
              <select
                value={engineVersion}
                onChange={(e) => setEngineVersion(e.target.value)}
                className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              >
                {installedForEngine.map((v) => (
                  <option key={v.id} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex h-8 items-center justify-between gap-2 rounded-md border border-[var(--status-starting)]/40 bg-[var(--status-starting)]/10 px-2.5 text-[11px] text-[var(--status-starting)]">
                <span>Not installed</span>
                <button
                  type="button"
                  onClick={() => {
                    closeModal();
                    setActiveSection("store");
                  }}
                  className="font-semibold underline cursor-pointer"
                >
                  Open Store
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Name & Group */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
              Instance Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Local Qdrant Dev"
              className={cn(
                "h-8 w-full rounded-md border bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:outline-none",
                nameConflict
                  ? "border-[var(--status-error)] focus:border-[var(--status-error)]"
                  : "border-[var(--border-strong)] focus:border-[var(--accent-primary)]",
              )}
            />
            {nameConflict && (
              <p className="mt-1 text-[11px] text-[var(--status-error)]">
                An instance with this name already exists.
              </p>
            )}
          </div>

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
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Description / Notes (Optional)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Embeddings store for local documentation RAG"
            className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        {/* Host & Ports */}
        {!isEmbedded && (
          <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                  Bind Host
                </label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 flex items-center justify-between text-[11px] font-medium text-[var(--text-secondary)]">
                  <span>HTTP Port</span>
                  {portAvailable === true && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--status-running)]">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Free
                    </span>
                  )}
                  {portAvailable === false && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--status-error)]">
                      <AlertTriangle className="h-2.5 w-2.5" /> In Use
                    </span>
                  )}
                </label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    title="Auto-Pick Free Port"
                    onClick={() => void handleAutoPickPort()}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
                  gRPC Port (Optional)
                </label>
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={grpcPort}
                  onChange={(e) => setGrpcPort(e.target.value)}
                  placeholder="None"
                  className="h-8 w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
              </div>
            </div>

            {host.trim() === "0.0.0.0" && (
              <p className="flex items-center gap-1.5 text-[11px] text-[var(--status-starting)]">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Binding to 0.0.0.0 exposes this local DB over your LAN. Keep
                127.0.0.1 for local-only access.
              </p>
            )}
          </div>
        )}

        {/* Data Directory (especially useful for LanceDB local .lance folders) */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Data Directory{" "}
            <span className="text-[var(--text-muted)]">
              (leave blank for managed default)
            </span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={dataDir}
              onChange={(e) => setDataDir(e.target.value)}
              placeholder={
                isEmbedded
                  ? "Select or enter path to local .lance folder..."
                  : "%LOCALAPPDATA%\\EmbedBay\\instances\\<id>\\data"
              }
              className="h-8 flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2.5 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            {onPickDirectory && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void onPickDirectory(dataDir).then((picked) => {
                    if (picked) setDataDir(picked);
                  });
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Browse
              </Button>
            )}
          </div>
        </div>

        {/* Swatch Color + Tags */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-[var(--text-secondary)]">
              Badge Color
            </label>
            <div className="flex flex-wrap gap-1.5">
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

          <TagPicker
            selectedTagIds={selectedTags}
            onChange={setSelectedTags}
          />
        </div>

        {/* Boot Autostart & Idle Auto-Stop */}
        {!isEmbedded && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => setAutoStart(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
              />
              <span>Start automatically on OS boot</span>
            </label>

            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] text-[var(--text-secondary)]">
                Idle Auto-Stop:
              </label>
              <select
                value={idleTimeoutMinutes}
                onChange={(e) => setIdleTimeoutMinutes(Number(e.target.value))}
                className="h-7 rounded border border-[var(--border-strong)] bg-[var(--bg-canvas)] px-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              >
                <option value={0}>Disabled</option>
                <option value={5}>5 min idle</option>
                <option value={15}>15 min idle</option>
                <option value={30}>30 min idle</option>
                <option value={60}>60 min idle</option>
                <option value={120}>120 min idle</option>
              </select>
            </div>
          </div>
        )}

        {/* Engine Config JSON Overrides */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            Engine Config Overrides (JSON)
          </label>
          <textarea
            rows={2}
            value={configJson}
            onChange={(e) => setConfigJson(e.target.value)}
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-canvas)] p-2 font-mono text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            {editing ? "Save Instance" : "Create Instance"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
