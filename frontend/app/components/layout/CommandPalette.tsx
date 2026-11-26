import * as React from "react";
import {
  Boxes,
  Check,
  Compass,
  Cpu,
  Database,
  HardDrive,
  Info,
  Monitor,
  Moon,
  PackagePlus,
  Play,
  Plus,
  Power,
  Settings,
  Sparkles,
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
import { useTabsStore } from "@/stores/useTabsStore";
import type { ActivitySection } from "@/types/system";

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const toggleCommandPalette = useAppStore((s) => s.toggleCommandPalette);
  const setActiveSection = useAppStore((s) => s.setActiveSection);
  const openSettings = useAppStore((s) => s.openSettings);
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const appStatus = useAppStore((s) => s.appStatus);
  const setAppStatus = useAppStore((s) => s.setAppStatus);

  const instances = useRuntimeStore((s) => s.instances);
  const metrics = useRuntimeStore((s) => s.metrics);
  const tags = useRuntimeStore((s) => s.tags);
  const toggleTagFilter = useRuntimeStore((s) => s.toggleTagFilter);
  const setSelectedConnectionKey = useRuntimeStore(
    (s) => s.setSelectedConnectionKey,
  );
  const openCreateInstanceModal = useRuntimeStore(
    (s) => s.openCreateInstanceModal,
  );
  const setActiveLogInstanceId = useRuntimeStore(
    (s) => s.setActiveLogInstanceId,
  );
  const refreshInstances = useRuntimeStore((s) => s.refreshInstances);
  const setActiveTabId = useTabsStore((s) => s.setActiveTabId);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (useAppStore.getState().onboardingOpen) return;
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
          <CommandItem
            value="nav-explorer-open-vector-explorer"
            onSelect={() => navigate("explorer")}
          >
            <Database className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
            <span>Open Vector Explorer</span>
            <CommandShortcut>Explorer</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="nav-runtimes-open-local-runtimes"
            onSelect={() => navigate("runtimes")}
          >
            <Boxes className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
            <span>Open Local Runtimes</span>
            <CommandShortcut>Runtimes</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="nav-store-open-engine-store"
            onSelect={() => navigate("store")}
          >
            <PackagePlus className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
            <span>Open Engine Store</span>
            <CommandShortcut>Store</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="nav-settings-open-workspace-settings"
            onSelect={() => {
              setOpen(false);
              openSettings("general");
            }}
          >
            <Settings className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <span>Open Settings</span>
            <CommandShortcut>Ctrl+,</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="nav-settings-embeddings"
            onSelect={() => {
              setOpen(false);
              openSettings("embeddings");
            }}
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
            <span>Settings: Embedding Profiles</span>
            <CommandShortcut>Settings</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="nav-settings-storage"
            onSelect={() => {
              setOpen(false);
              openSettings("storage");
            }}
          >
            <HardDrive className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
            <span>Settings: Storage</span>
            <CommandShortcut>Settings</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="nav-settings-diagnostics"
            onSelect={() => {
              setOpen(false);
              openSettings("diagnostics");
            }}
          >
            <Cpu className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
            <span>Settings: Diagnostics</span>
            <CommandShortcut>Settings</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="nav-settings-about"
            onSelect={() => {
              setOpen(false);
              openSettings("about");
            }}
          >
            <Info className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <span>Settings: About & Updates</span>
            <CommandShortcut>Settings</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="nav-onboarding-welcome-guide"
            onSelect={() => {
              setOpen(false);
              setOnboardingOpen(true);
            }}
          >
            <Compass className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
            <span>Open Welcome & Onboarding Guide</span>
            <CommandShortcut>Guide</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Runtime Actions">
          <CommandItem
            value="runtime-create-new-local-instance"
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
            value="runtime-stop-all-running-services"
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
                    value={`instance-toggle-${inst.id}-${inst.name}-${inst.engine_type}`}
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
                    value={`instance-logs-${inst.id}-${inst.name}-${inst.engine_type}`}
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
                  value={`tag-filter-${tag.id}-${tag.name}`}
                  onSelect={() => {
                    toggleTagFilter(tag.id);
                    setSelectedConnectionKey(null);
                    setActiveTabId(null);
                    setActiveSection("explorer");
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
            value="system-theme-light"
            onSelect={() => {
              setTheme("light");
              setOpen(false);
            }}
          >
            <Sun className="h-3.5 w-3.5 text-[var(--status-starting)]" />
            <span>Theme: Light</span>
            {theme === "light" && (
              <CommandShortcut>
                <Check className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              </CommandShortcut>
            )}
          </CommandItem>
          <CommandItem
            value="system-theme-dark"
            onSelect={() => {
              setTheme("dark");
              setOpen(false);
            }}
          >
            <Moon className="h-3.5 w-3.5 text-[var(--accent-ai)]" />
            <span>Theme: Dark</span>
            {theme === "dark" && (
              <CommandShortcut>
                <Check className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              </CommandShortcut>
            )}
          </CommandItem>
          <CommandItem
            value="system-theme-auto-system"
            onSelect={() => {
              setTheme("system");
              setOpen(false);
            }}
          >
            <Monitor className="h-3.5 w-3.5 text-[var(--accent-secondary)]" />
            <span>Theme: Auto (Match OS)</span>
            {theme === "system" && (
              <CommandShortcut>
                <Check className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
              </CommandShortcut>
            )}
          </CommandItem>
          <CommandItem
            value="system-toggle-os-startup-autostart"
            onSelect={() => void handleToggleAutostart()}
          >
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
