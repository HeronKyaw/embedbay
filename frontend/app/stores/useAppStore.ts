import { create } from "zustand";
import type {
  ActivitySection,
  AppStatus,
  ResolvedTheme,
  SettingsTabId,
  ThemeMode,
  WorkspacePreferences,
} from "@/types/system";

const THEME_STORAGE_KEY = "embedbay-theme";
const PREFS_STORAGE_KEY = "embedbay-preferences";
const ONBOARDING_STORAGE_KEY = "embedbay-onboarding-completed";

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  defaultSection: "explorer",
  defaultPageSize: 50,
  defaultSearchTopK: 10,
  defaultIdleTimeoutMinutes: 0,
  defaultEmbeddingProfileId: null,
};

function readInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Ignore storage read errors in restricted contexts
  }
  return "system";
}

function readInitialOnboardingCompleted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getSystemResolvedTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(theme: ThemeMode): ResolvedTheme {
  return theme === "system" ? getSystemResolvedTheme() : theme;
}

export function applyThemeToDom(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.classList.remove("dark", "light");
  root.classList.add(resolved);
}

function readInitialPreferences(): WorkspacePreferences {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<WorkspacePreferences>;
    return {
      defaultSection:
        parsed.defaultSection === "explorer" ||
        parsed.defaultSection === "runtimes" ||
        parsed.defaultSection === "store" ||
        parsed.defaultSection === "migrations"
          ? parsed.defaultSection
          : DEFAULT_WORKSPACE_PREFERENCES.defaultSection,
      defaultPageSize:
        parsed.defaultPageSize === 25 ||
        parsed.defaultPageSize === 50 ||
        parsed.defaultPageSize === 100 ||
        parsed.defaultPageSize === 200
          ? parsed.defaultPageSize
          : DEFAULT_WORKSPACE_PREFERENCES.defaultPageSize,
      defaultSearchTopK:
        parsed.defaultSearchTopK === 5 ||
        parsed.defaultSearchTopK === 10 ||
        parsed.defaultSearchTopK === 20 ||
        parsed.defaultSearchTopK === 50
          ? parsed.defaultSearchTopK
          : DEFAULT_WORKSPACE_PREFERENCES.defaultSearchTopK,
      defaultIdleTimeoutMinutes:
        parsed.defaultIdleTimeoutMinutes === 0 ||
        parsed.defaultIdleTimeoutMinutes === 15 ||
        parsed.defaultIdleTimeoutMinutes === 30 ||
        parsed.defaultIdleTimeoutMinutes === 60
          ? parsed.defaultIdleTimeoutMinutes
          : DEFAULT_WORKSPACE_PREFERENCES.defaultIdleTimeoutMinutes,
      defaultEmbeddingProfileId:
        typeof parsed.defaultEmbeddingProfileId === "string" ||
        parsed.defaultEmbeddingProfileId === null
          ? parsed.defaultEmbeddingProfileId
          : null,
    };
  } catch {
    return DEFAULT_WORKSPACE_PREFERENCES;
  }
}

interface AppState {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  preferences: WorkspacePreferences;
  onboardingCompleted: boolean;
  onboardingOpen: boolean;
  activeSection: ActivitySection;
  selectedStoreEngine: string | null;
  settingsOpen: boolean;
  settingsTab: SettingsTabId;
  commandPaletteOpen: boolean;
  appStatus: AppStatus | null;
  statusLoading: boolean;
  statusError: string | null;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  updatePreferences: (patch: Partial<WorkspacePreferences>) => void;
  setOnboardingOpen: (open: boolean) => void;
  completeOnboarding: () => void;
  setActiveSection: (section: ActivitySection) => void;
  setSelectedStoreEngine: (engineType: string | null) => void;
  openStoreEngine: (engineType: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  openSettings: (tab?: SettingsTabId) => void;
  toggleSettings: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setAppStatus: (status: AppStatus | null) => void;
  setStatusLoading: (loading: boolean) => void;
  setStatusError: (error: string | null) => void;
}

const initialTheme = readInitialTheme();
const initialResolved = resolveTheme(initialTheme);
const initialPreferences = readInitialPreferences();
const initialOnboardingCompleted = readInitialOnboardingCompleted();
applyThemeToDom(initialResolved);

export const useAppStore = create<AppState>((set) => ({
  theme: initialTheme,
  resolvedTheme: initialResolved,
  preferences: initialPreferences,
  onboardingCompleted: initialOnboardingCompleted,
  onboardingOpen: false,
  activeSection: initialPreferences.defaultSection,
  selectedStoreEngine: null,
  settingsOpen: false,
  settingsTab: "general",
  commandPaletteOpen: false,
  appStatus: null,
  statusLoading: true,
  statusError: null,
  setTheme: (theme) => {
    const resolvedTheme = resolveTheme(theme);
    applyThemeToDom(resolvedTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage write errors
    }
    set({ theme, resolvedTheme });
  },
  toggleTheme: () =>
    set((state) => {
      const next: ThemeMode =
        state.theme === "light"
          ? "dark"
          : state.theme === "dark"
            ? "system"
            : "light";
      const resolvedTheme = resolveTheme(next);
      applyThemeToDom(resolvedTheme);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Ignore storage write errors
      }
      return { theme: next, resolvedTheme };
    }),
  updatePreferences: (patch) =>
    set((state) => {
      const next = { ...state.preferences, ...patch };
      try {
        window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage write errors
      }
      return { preferences: next };
    }),
  setOnboardingOpen: (onboardingOpen) => set({ onboardingOpen }),
  completeOnboarding: () => {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    } catch {
      // Ignore storage write errors
    }
    set({ onboardingCompleted: true, onboardingOpen: false });
  },
  setActiveSection: (activeSection) => set({ activeSection }),
  setSelectedStoreEngine: (selectedStoreEngine) => set({ selectedStoreEngine }),
  openStoreEngine: (engineType) =>
    set({ activeSection: "store", selectedStoreEngine: engineType }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  openSettings: (tab) =>
    set((state) => ({
      settingsOpen: true,
      settingsTab: tab ?? state.settingsTab,
    })),
  toggleSettings: () =>
    set((state) => ({ settingsOpen: !state.settingsOpen })),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setAppStatus: (appStatus) => set({ appStatus }),
  setStatusLoading: (statusLoading) => set({ statusLoading }),
  setStatusError: (statusError) => set({ statusError }),
}));

if (typeof window !== "undefined" && window.matchMedia) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemThemeChange = () => {
    const state = useAppStore.getState();
    if (state.theme !== "system") return;
    const nextResolved: ResolvedTheme = media.matches ? "dark" : "light";
    applyThemeToDom(nextResolved);
    useAppStore.setState({ resolvedTheme: nextResolved });
  };
  media.addEventListener("change", onSystemThemeChange);
}
