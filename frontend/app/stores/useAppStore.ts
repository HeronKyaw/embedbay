import { create } from "zustand";
import type { ActivitySection, AppStatus, ThemeMode } from "@/types/system";

const THEME_STORAGE_KEY = "embedbay-theme";

function readInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Ignore storage read errors in restricted contexts
  }
  return "dark";
}

export function applyThemeToDom(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.remove("dark", "light");
  root.classList.add(theme);
}

interface AppState {
  theme: ThemeMode;
  activeSection: ActivitySection;
  settingsOpen: boolean;
  commandPaletteOpen: boolean;
  appStatus: AppStatus | null;
  statusLoading: boolean;
  statusError: string | null;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setActiveSection: (section: ActivitySection) => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSettings: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setAppStatus: (status: AppStatus | null) => void;
  setStatusLoading: (loading: boolean) => void;
  setStatusError: (error: string | null) => void;
}

const initialTheme = readInitialTheme();
applyThemeToDom(initialTheme);

export const useAppStore = create<AppState>((set) => ({
  theme: initialTheme,
  activeSection: "explorer",
  settingsOpen: false,
  commandPaletteOpen: false,
  appStatus: null,
  statusLoading: true,
  statusError: null,
  setTheme: (theme) => {
    applyThemeToDom(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage write errors
    }
    set({ theme });
  },
  toggleTheme: () =>
    set((state) => {
      const next: ThemeMode = state.theme === "dark" ? "light" : "dark";
      applyThemeToDom(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Ignore storage write errors
      }
      return { theme: next };
    }),
  setActiveSection: (activeSection) => set({ activeSection }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  toggleSettings: () =>
    set((state) => ({ settingsOpen: !state.settingsOpen })),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setAppStatus: (appStatus) => set({ appStatus }),
  setStatusLoading: (statusLoading) => set({ statusLoading }),
  setStatusError: (statusError) => set({ statusError }),
}));
