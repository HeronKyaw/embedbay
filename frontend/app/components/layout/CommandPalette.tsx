import * as React from "react";
import {
  Boxes,
  Database,
  Moon,
  PackagePlus,
  Power,
  Settings,
  Sun,
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
import { setAutostartEnabled } from "@/ipc/system";
import { useAppStore } from "@/stores/useAppStore";
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
      <CommandInput placeholder="Type a command or jump to a workspace view..." />
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
