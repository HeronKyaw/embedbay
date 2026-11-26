import { invoke } from "@tauri-apps/api/core";
import type {
  AppStatus,
  CloseBehavior,
  DiagnosticsReport,
  PlatformInfo,
} from "@/types/system";

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
      app_version: "0.1.0",
      platform: {
        os: "browser",
        arch: "x86_64",
        target_triple: "browser-preview",
      },
      data_dir: "%LOCALAPPDATA%\\com.embedbay.app",
      db_path: "%LOCALAPPDATA%\\com.embedbay.app\\app.db",
      schema_version: 4,
      autostart_enabled: false,
      close_behavior: "tray",
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

export async function setCloseBehavior(
  behavior: CloseBehavior,
): Promise<CloseBehavior> {
  if (!isTauriRuntime()) return behavior;
  return invoke<CloseBehavior>("set_close_behavior", { behavior });
}

export async function getDiagnostics(): Promise<DiagnosticsReport> {
  if (!isTauriRuntime()) {
    return {
      app: {
        version: "0.1.0",
        tauri_version: "2.x",
        build_profile: "browser-preview",
        pid: 0,
        uptime_secs: 0,
        autostart_enabled: false,
        tray_mode: "Destroy-on-Close (Browser Preview)",
      },
      host: {
        os_name: "Browser",
        os_version: typeof navigator !== "undefined" ? navigator.platform : "Web",
        kernel_version: "-",
        arch: "x86_64",
        target_triple: "browser-preview",
        cpu_brand: "WebView Host",
        cpu_cores:
          typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4,
        cpu_percent: 0,
        memory_used_bytes: 0,
        memory_total_bytes: 0,
        disk_available_bytes: 0,
        disk_total_bytes: 0,
      },
      supervisor: {
        total_instances: 0,
        running_count: 0,
        embedded_count: 0,
        stopped_count: 0,
        error_count: 0,
        total_ram_bytes: 0,
        total_cpu_percent: 0,
        total_disk_bytes: 0,
        total_restarts: 0,
        instances: [],
      },
      database: {
        schema_version: 3,
        sqlite_version: "3.x",
        journal_mode: "wal",
        foreign_keys: true,
        quick_check: "ok",
        db_bytes: 0,
        wal_bytes: 0,
        shm_bytes: 0,
        table_counts: {
          installed_engines: 0,
          instances: 0,
          remote_connections: 0,
          connection_groups: 0,
          tags: 0,
          embedding_profiles: 0,
          search_history: 0,
          search_presets: 0,
        },
        stored_secret_refs: 0,
      },
      manifest: {
        path: "%LOCALAPPDATA%\\com.embedbay.app\\manifest.json",
        schema_version: 1,
        updated_at: "-",
        engine_count: 0,
      },
      keyring: {
        backend_name: "OS Keyring (Browser Preview)",
        service_name: "com.embedbay.app",
        stored_secret_refs: 0,
      },
      paths: {
        data_dir: "%LOCALAPPDATA%\\com.embedbay.app",
        db_path: "%LOCALAPPDATA%\\com.embedbay.app\\app.db",
        bin_dir: "%LOCALAPPDATA%\\com.embedbay.app\\bin",
        instances_dir: "%LOCALAPPDATA%\\com.embedbay.app\\instances",
        manifest_path: "%LOCALAPPDATA%\\com.embedbay.app\\manifest.json",
      },
    };
  }
  return invoke<DiagnosticsReport>("get_diagnostics");
}

export async function openDataPath(path?: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("open_data_path", { path: path ?? null });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  return invoke<void>("open_external_url", { url });
}
