import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/ipc/system";
import type {
  CreateEmbeddingProfilePayload,
  CreateRemoteConnectionPayload,
  EmbeddingProfile,
  EmbeddingTestResult,
  RemoteConnection,
  UpdateEmbeddingProfilePayload,
  UpdateRemoteConnectionPayload,
} from "@/types/explorer";

export async function listRemoteConnections(): Promise<RemoteConnection[]> {
  if (!isTauriRuntime()) return [];
  return invoke<RemoteConnection[]>("list_remote_connections");
}

export async function createRemoteConnection(
  payload: CreateRemoteConnectionPayload,
): Promise<RemoteConnection> {
  return invoke<RemoteConnection>("create_remote_connection", { payload });
}

export async function updateRemoteConnection(
  id: string,
  payload: UpdateRemoteConnectionPayload,
): Promise<RemoteConnection> {
  return invoke<RemoteConnection>("update_remote_connection", { id, payload });
}

export async function deleteRemoteConnection(id: string): Promise<boolean> {
  return invoke<boolean>("delete_remote_connection", { id });
}

export async function listEmbeddingProfiles(): Promise<EmbeddingProfile[]> {
  if (!isTauriRuntime()) return [];
  return invoke<EmbeddingProfile[]>("list_embedding_profiles");
}

export async function createEmbeddingProfile(
  payload: CreateEmbeddingProfilePayload,
): Promise<EmbeddingProfile> {
  return invoke<EmbeddingProfile>("create_embedding_profile", { payload });
}

export async function updateEmbeddingProfile(
  id: string,
  payload: UpdateEmbeddingProfilePayload,
): Promise<EmbeddingProfile> {
  return invoke<EmbeddingProfile>("update_embedding_profile", { id, payload });
}

export async function deleteEmbeddingProfile(id: string): Promise<boolean> {
  return invoke<boolean>("delete_embedding_profile", { id });
}

export async function testEmbeddingProfile(
  id: string,
): Promise<EmbeddingTestResult> {
  return invoke<EmbeddingTestResult>("test_embedding_profile", { id });
}

export async function embedTexts(
  profileId: string,
  texts: string[],
): Promise<[number[][], number]> {
  return invoke<[number[][], number]>("embed_texts", { profileId, texts });
}
