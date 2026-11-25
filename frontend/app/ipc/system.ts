import { invoke } from "@tauri-apps/api/core";
import type { AppStatus, PlatformInfo } from "@/types/system";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (!isTauriRuntime()) {
    return {
      os: "browser",
      arch: "x86_64",
      target_triple: "browser-preview",
    };
  }
  return invoke<PlatformInfo>("get_platform_info");
}

export async function getAppStatus(): Promise<AppStatus> {
  if (!isTauriRuntime()) {
    return {
      platform: {
        os: "browser",
        arch: "x86_64",
        target_triple: "browser-preview",
      },
      data_dir: "%LOCALAPPDATA%\\EmbedBay",
      db_path: "%LOCALAPPDATA%\\EmbedBay\\app.db",
      schema_version: 1,
      autostart_enabled: false,
    };
  }
  return invoke<AppStatus>("get_app_status");
}

export async function getAutostartEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("get_autostart_enabled");
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return enabled;
  return invoke<boolean>("set_autostart_enabled", { enabled });
}
