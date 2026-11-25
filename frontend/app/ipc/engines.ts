import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/ipc/system";
import type { CatalogEngineView, InstalledEngine } from "@/types/runtime";

const PREVIEW_CATALOG: CatalogEngineView[] = [
  {
    engine_type: "qdrant",
    display_name: "Qdrant",
    description:
      "High-performance vector similarity engine written in Rust with rich payload filtering and HNSW indexing.",
    tier: 1,
    embedded: false,
    default_port: 6333,
    default_grpc_port: 6334,
    versions: [
      {
        version: "1.20.2",
        recommended: true,
        size_bytes: 32545356,
        sha256:
          "7a5290b9ef1b204b250a1626ddafec580647ba3cc62ba1630b3a8efdc2718b32",
        archive_type: "zip",
        installed: false,
        installed_id: null,
      },
    ],
  },
  {
    engine_type: "chroma",
    display_name: "Chroma",
    description:
      "Standalone Rust CLI server for Chroma local vector collections with zero Python or Docker dependencies.",
    tier: 1,
    embedded: false,
    default_port: 8000,
    default_grpc_port: null,
    versions: [
      {
        version: "1.4.4",
        recommended: true,
        size_bytes: 55364096,
        sha256:
          "8697d3f5f55c4f982c6e114ac01cf006daa0c68d87e791d9b5558b8670f89d05",
        archive_type: "binary",
        installed: false,
        installed_id: null,
      },
    ],
  },
];

export async function listEngineCatalog(): Promise<CatalogEngineView[]> {
  if (!isTauriRuntime()) return PREVIEW_CATALOG;
  return invoke<CatalogEngineView[]>("list_engine_catalog");
}

export async function listInstalledEngines(): Promise<InstalledEngine[]> {
  if (!isTauriRuntime()) return [];
  return invoke<InstalledEngine[]>("list_installed_engines");
}

export async function installEngine(
  engineType: string,
  version: string,
): Promise<InstalledEngine> {
  if (!isTauriRuntime()) {
    throw new Error("Engine download requires the Tauri desktop runtime.");
  }
  return invoke<InstalledEngine>("install_engine", {
    engineType,
    version,
  });
}

export async function uninstallEngine(id: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("uninstall_engine", { id });
}
