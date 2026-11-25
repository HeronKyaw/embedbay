import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/ipc/system";
import type {
  BatchActionResult,
  CreateInstancePayload,
  InstanceMetrics,
  InstanceRecord,
  LogEntry,
  SystemMetricsSummary,
  UpdateInstancePayload,
} from "@/types/runtime";

export async function listInstances(): Promise<InstanceRecord[]> {
  if (!isTauriRuntime()) return [];
  return invoke<InstanceRecord[]>("list_instances");
}

export async function createInstance(
  payload: CreateInstancePayload,
): Promise<InstanceRecord> {
  return invoke<InstanceRecord>("create_instance", { payload });
}

export async function updateInstance(
  id: string,
  payload: UpdateInstancePayload,
): Promise<InstanceRecord> {
  return invoke<InstanceRecord>("update_instance", { id, payload });
}

export async function deleteInstance(
  id: string,
  deleteData: boolean,
): Promise<void> {
  return invoke<void>("delete_instance", { id, deleteData });
}

export async function startInstance(id: string): Promise<InstanceMetrics> {
  return invoke<InstanceMetrics>("start_instance", { id });
}

export async function stopInstance(id: string): Promise<void> {
  return invoke<void>("stop_instance", { id });
}

export async function restartInstance(id: string): Promise<InstanceMetrics> {
  return invoke<InstanceMetrics>("restart_instance", { id });
}

export async function forceKillInstance(id: string): Promise<void> {
  return invoke<void>("force_kill_instance", { id });
}

export async function startGroupInstances(
  groupId: string,
): Promise<BatchActionResult[]> {
  return invoke<BatchActionResult[]>("start_group_instances", { groupId });
}

export async function stopGroupInstances(
  groupId: string,
): Promise<BatchActionResult[]> {
  return invoke<BatchActionResult[]>("stop_group_instances", { groupId });
}

export async function stopAllInstances(): Promise<BatchActionResult[]> {
  return invoke<BatchActionResult[]>("stop_all_instances");
}

export async function stopIdleInstances(
  idleMinutes?: number,
): Promise<BatchActionResult[]> {
  return invoke<BatchActionResult[]>("stop_idle_instances", { idleMinutes });
}

export async function getAllInstanceMetrics(): Promise<SystemMetricsSummary> {
  if (!isTauriRuntime()) {
    return { total_ram_bytes: 0, running_count: 0, instances: {} };
  }
  return invoke<SystemMetricsSummary>("get_all_instance_metrics");
}

export async function getInstanceLogs(
  id: string,
  limit = 500,
): Promise<LogEntry[]> {
  if (!isTauriRuntime()) return [];
  return invoke<LogEntry[]>("get_instance_logs", { id, limit });
}

export async function subscribeInstanceLogs(
  id: string,
  limit = 500,
): Promise<LogEntry[]> {
  if (!isTauriRuntime()) return [];
  return invoke<LogEntry[]>("subscribe_instance_logs", { id, limit });
}

export async function clearInstanceLogs(id: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke<void>("clear_instance_logs", { id });
}

export async function checkPortAvailable(
  port: number,
  host = "127.0.0.1",
): Promise<boolean> {
  if (!isTauriRuntime()) return true;
  return invoke<boolean>("check_port_available", { host, port });
}

export async function suggestAvailablePort(
  startPort: number,
  host = "127.0.0.1",
): Promise<number> {
  if (!isTauriRuntime()) return startPort;
  return invoke<number>("suggest_available_port", { host, startPort });
}
