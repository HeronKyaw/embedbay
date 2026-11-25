import * as React from "react";
import {
  Boxes,
  Database,
  Moon,
  PackagePlus,
  Play,
  Plus,
  Power,
  Settings,
  Square,
  Sun,
  Terminal,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { toast } from "@/components/ui/toast";
import {
  startInstance,
  stopAllInstances,
  stopInstance,
} from "@/ipc/instances";
import { setAutostartEnabled } from "@/ipc/system";
import { useAppStore } from "@/stores/useAppStore";
import { useRuntimeStore } from "@/stores/useRuntimeStore";
import type { ActivitySection } from "@/types/system";

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const appStatus = useAppStore((s) => s.appStatus);
  const setAppStatus = useAppStore((s) => s.setAppStatus);

  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const tags = useRuntimeStore((s) => s.tags);
  const toggleTagFilter = useRuntimeStore((s) => s.toggleTagFilter);
  const openCreateInstanceModal = useRuntimeStore(
    (s) => s.openCreateInstanceModal,
  );
  const setActiveLogInstanceId = useRuntimeStore(
    (s) => s.setActiveLogInstanceId,
  );
  const refreshInstances = useRuntimeStore((s) => s.refreshInstances);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleCommandPalette();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleCommandPalette]);

  const navigate = (section: ActivitySection) => {
    setActiveSection(section);
    setOpen(false);
  };

  const handleToggleAutostart = async () => {
    if (!appStatus) return;
    const next = !appStatus.autostart_enabled;
    try {
      const confirmed = await setAutostartEnabled(next);
      setAppStatus({ ...appStatus, autostart_enabled: confirmed });
    } catch {
      // Errors surfaced in Settings status view
    }
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command, instance name, or tag..." />
      <CommandList>
        <CommandEmpty>No matching commands found.</CommandEmpty>
        <CommandGroup heading="Workspace Navigation">
          <CommandItem onSelect={() => navigate("explorer")}>
            <Database className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
            <span>Open Vector Explorer</span>
            <CommandShortcut>Explorer</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate("runtimes")}>
            <Boxes className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
            <span>Open Local Runtimes</span>
            <CommandShortcut>Runtimes</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate("store")}>
            <PackagePlus className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
            <span>Open Engine Store</span>
            <CommandShortcut>Store</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate("settings")}>
            <Settings className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <span>Open Settings</span>
            <CommandShortcut>Settings</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Runtime Actions">
          <CommandItem
            onSelect={() => {
              setOpen(false);
              openCreateInstanceModal();
            }}
          >
            <Plus className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
            <span>Create New Local Instance</span>
            <CommandShortcut>Wizard</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setOpen(false);
              void stopAllInstances()
                .then((res) => {
                  toast.info(`Stopped ${res.length} running service(s)`);
                  return refreshInstances();
                })
                .catch(() => {});
            }}
          >
            <Square className="h-3.5 w-3.5 text-[var(--status-error)]" />
            <span>Stop All Running Services</span>
            <CommandShortcut>Supervisor</CommandShortcut>
          </CommandItem>
          {instances.map((inst) => {
            const st = metrics[inst.id]?.status ?? "stopped";
            const running = st === "running";
            const embedded = st === "embedded" || inst.engine_type === "lancedb";
            return (
              <React.Fragment key={inst.id}>
                {!embedded && (
                  <CommandItem
                    onSelect={() => {
                      setOpen(false);
                      void (running
                        ? stopInstance(inst.id)
                        : startInstance(inst.id)
                      )
                        .then(() => {
                          toast.success(
                            `${running ? "Stopped" : "Started"} ${inst.name}`,
                          );
                          return refreshInstances();
                        })
                        .catch((err: unknown) => {
                          toast.error(
                            "Action failed",
                            err instanceof Error ? err.message : String(err),
                          );
                        });
                    }}
                  >
                    {running ? (
                      <Square className="h-3.5 w-3.5 text-[var(--status-error)]" />
                    ) : (
                      <Play className="h-3.5 w-3.5 text-[var(--status-running)]" />
                    )}
                    <span>
                      {running ? "Stop" : "Start"} {inst.name}
                    </span>
                    <CommandShortcut>
                      {inst.engine_type}:{inst.port}
                    </CommandShortcut>
                  </CommandItem>
                )}
                {!embedded && (
                  <CommandItem
                    onSelect={() => {
                      setActiveLogInstanceId(inst.id);
                      setActiveSection("runtimes");
                      setOpen(false);
                    }}
                  >
                    <Terminal className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                    <span>View Logs: {inst.name}</span>
                    <CommandShortcut>Logs</CommandShortcut>
                  </CommandItem>
                )}
              </React.Fragment>
            );
          })}
        </CommandGroup>

        {tags.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Filter by Tag">
              {tags.map((tag) => (
                <CommandItem
                  key={tag.id}
                  onSelect={() => {
                    toggleTagFilter(tag.id);
                    setOpen(false);
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span>Toggle Tag Filter: #{tag.name}</span>
                  <CommandShortcut>Tag</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        <CommandGroup heading="Appearance & System">
          <CommandItem
            onSelect={() => {
              toggleTheme();
              setOpen(false);
            }}
          >
            {theme === "dark" ? (
              <Sun className="h-3.5 w-3.5 text-[var(--status-starting)]" />
            ) : (
              <Moon className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
            )}
            <span>
              Switch to {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </span>
            <CommandShortcut>Theme</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => void handleToggleAutostart()}>
            <Power className="h-3.5 w-3.5 text-[var(--status-running)]" />
            <span>
              {appStatus?.autostart_enabled
                ? "Disable Launch EmbedBay on OS Startup"
                : "Enable Launch EmbedBay on OS Startup"}
            </span>
            <CommandShortcut>--minimized</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
