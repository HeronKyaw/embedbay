use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sysinfo::Disks;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstanceStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
    Embedded,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceMetrics {
    pub instance_id: String,
    pub status: InstanceStatus,
    pub pid: Option<u32>,
    pub ram_bytes: u64,
    pub cpu_percent: f32,
    pub uptime_secs: u64,
    pub disk_bytes: u64,
    pub restart_count: u32,
    pub last_error: Option<String>,
    pub last_activity_at: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct HostResourceMetrics {
    pub cpu_percent: f32,
    pub cpu_cores: usize,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub disk_available_bytes: u64,
    pub disk_total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemMetricsSummary {
    pub total_ram_bytes: u64,
    pub total_cpu_percent: f32,
    pub total_disk_bytes: u64,
    pub running_count: usize,
    pub host: HostResourceMetrics,
    pub instances: HashMap<String, InstanceMetrics>,
}

fn normalize_mount_or_target(raw: &str) -> String {
    let mut normalized = raw.replace('\\', "/").to_lowercase();
    while normalized.len() > 1 && normalized.ends_with('/') {
        // Keep drive roots like "c:/" intact while trimming trailing slashes on subpaths.
        if normalized.len() == 3 && normalized.as_bytes()[1] == b':' {
            break;
        }
        normalized.pop();
    }
    normalized
}

pub fn select_best_mount_index(mounts: &[&str], target: &str) -> Option<usize> {
    let target_norm = normalize_mount_or_target(target);
    let mut best: Option<(usize, usize)> = None;

    for (idx, mount) in mounts.iter().enumerate() {
        let mount_norm = normalize_mount_or_target(mount);
        if mount_norm.is_empty() {
            continue;
        }
        let is_match = if mount_norm.ends_with('/') {
            target_norm.starts_with(&mount_norm)
        } else {
            target_norm == mount_norm
                || target_norm
                    .strip_prefix(&mount_norm)
                    .is_some_and(|rest| rest.starts_with('/'))
        };

        if is_match {
            let score = mount_norm.len();
            if best.is_none_or(|(_, best_len)| score > best_len) {
                best = Some((idx, score));
            }
        }
    }

    best.map(|(idx, _)| idx)
}

/// Returns `(available_bytes, total_bytes)` for the disk containing `target`,
/// falling back to the first reported disk when no mount prefix matches.
pub fn select_disk_space_for_path(disks: &Disks, target: &Path) -> (u64, u64) {
    let list = disks.list();
    if list.is_empty() {
        return (0, 0);
    }

    let mount_strings: Vec<String> = list
        .iter()
        .map(|d| d.mount_point().to_string_lossy().into_owned())
        .collect();
    let mount_refs: Vec<&str> = mount_strings.iter().map(String::as_str).collect();
    let target_str = target.to_string_lossy();

    let selected = select_best_mount_index(&mount_refs, &target_str)
        .and_then(|idx| list.get(idx))
        .unwrap_or(&list[0]);

    (selected.available_space(), selected.total_space())
}

pub fn dir_size_bytes(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    let mut total: u64 = 0;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if let Ok(m) = entry.metadata() {
            if m.is_file() {
                total = total.saturating_add(m.len());
            } else if m.is_dir() {
                total = total.saturating_add(dir_size_bytes(&p));
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_best_mount_index_handles_windows_and_unix_paths() {
        let win_mounts = ["C:\\", "D:\\", "D:\\FastNVMe"];
        assert_eq!(
            select_best_mount_index(&win_mounts, r"c:\Users\heron\AppData\Local\com.embedbay.app"),
            Some(0)
        );
        assert_eq!(
            select_best_mount_index(&win_mounts, r"D:\EmbedBay\instances"),
            Some(1)
        );
        assert_eq!(
            select_best_mount_index(&win_mounts, r"d:\fastnvme\vectors"),
            Some(2)
        );
        assert_eq!(select_best_mount_index(&win_mounts, r"E:\Other"), None);

        let unix_mounts = ["/", "/mnt/data"];
        assert_eq!(
            select_best_mount_index(&unix_mounts, "/mnt/data/embedbay"),
            Some(1)
        );
        // Should not match "/mnt/data" against "/mnt/database"
        assert_eq!(
            select_best_mount_index(&unix_mounts, "/mnt/database/embedbay"),
            Some(0)
        );
    }

    #[test]
    fn system_metrics_summary_serializes_host_and_totals() {
        let summary = SystemMetricsSummary {
            total_ram_bytes: 512 * 1024 * 1024,
            total_cpu_percent: 4.5,
            total_disk_bytes: 2 * 1024 * 1024 * 1024,
            running_count: 1,
            host: HostResourceMetrics {
                cpu_percent: 18.2,
                cpu_cores: 16,
                memory_used_bytes: 12 * 1024 * 1024 * 1024,
                memory_total_bytes: 32 * 1024 * 1024 * 1024,
                disk_available_bytes: 120 * 1024 * 1024 * 1024,
                disk_total_bytes: 500 * 1024 * 1024 * 1024,
            },
            instances: HashMap::new(),
        };

        let val = serde_json::to_value(&summary).expect("serialize SystemMetricsSummary");
        assert_eq!(val["total_ram_bytes"], 512 * 1024 * 1024);
        assert_eq!(val["total_disk_bytes"], 2u64 * 1024 * 1024 * 1024);
        assert_eq!(val["running_count"], 1);
        assert_eq!(val["host"]["cpu_cores"], 16);
        assert_eq!(val["host"]["memory_total_bytes"], 32u64 * 1024 * 1024 * 1024);
    }
}
