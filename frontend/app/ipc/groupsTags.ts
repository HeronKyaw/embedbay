import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/ipc/system";
import type { ConnectionGroup, ReorderItem, Tag } from "@/types/runtime";

export async function listGroups(): Promise<ConnectionGroup[]> {
  if (!isTauriRuntime()) return [];
  return invoke<ConnectionGroup[]>("list_groups");
}

export async function createGroup(payload: {
  name: string;
  color?: string | null;
  icon?: string | null;
}): Promise<ConnectionGroup> {
  return invoke<ConnectionGroup>("create_group", { payload });
}

export async function updateGroup(
  id: string,
  payload: {
    name?: string;
    color?: string | null;
    icon?: string | null;
    sort_order?: number;
    is_collapsed?: boolean;
  },
): Promise<ConnectionGroup> {
  return invoke<ConnectionGroup>("update_group", { id, payload });
}

export async function deleteGroup(id: string): Promise<boolean> {
  return invoke<boolean>("delete_group", { id });
}

export async function reorderItems(items: ReorderItem[]): Promise<void> {
  return invoke<void>("reorder_items", { items });
}

export async function listTags(): Promise<Tag[]> {
  if (!isTauriRuntime()) return [];
  return invoke<Tag[]>("list_tags");
}

export async function createTag(name: string, color: string): Promise<Tag> {
  return invoke<Tag>("create_tag", { name, color });
}

export async function updateTag(
  id: string,
  name?: string,
  color?: string,
): Promise<Tag> {
  return invoke<Tag>("update_tag", { id, name, color });
}

export async function deleteTag(id: string): Promise<boolean> {
  return invoke<boolean>("delete_tag", { id });
}

export async function setEntityTags(
  entityType: "instance" | "remote_connection",
  entityId: string,
  tagIds: string[],
): Promise<string[]> {
  return invoke<string[]>("set_entity_tags", {
    entityType,
    entityId,
    tagIds,
  });
}
