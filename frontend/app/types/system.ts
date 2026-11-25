export type ThemeMode = "dark" | "light";

export type ActivitySection = "explorer" | "runtimes" | "store" | "settings";

export interface PlatformInfo {
  os: string;
  arch: string;
  target_triple: string;
}

export interface AppStatus {
  platform: PlatformInfo;
  data_dir: string;
  db_path: string;
  schema_version: number;
  autostart_enabled: boolean;
}

export interface SwatchPreset {
  id: string;
  label: string;
  hex: string;
}

export const SWATCH_PRESETS: readonly SwatchPreset[] = [
  { id: "teal", label: "Teal", hex: "#14B8A6" },
  { id: "sky", label: "Sky", hex: "#38BDF8" },
  { id: "indigo", label: "Indigo", hex: "#818CF8" },
  { id: "violet", label: "Violet", hex: "#A78BFA" },
  { id: "pink", label: "Pink", hex: "#F472B6" },
  { id: "orange", label: "Orange", hex: "#FB923C" },
  { id: "emerald", label: "Emerald", hex: "#10B981" },
  { id: "rose", label: "Rose", hex: "#F43F5E" },
] as const;
