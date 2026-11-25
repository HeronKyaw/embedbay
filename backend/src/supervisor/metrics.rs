use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize)]
pub struct SystemMetricsSummary {
    pub total_ram_bytes: u64,
    pub running_count: usize,
    pub instances: HashMap<String, InstanceMetrics>,
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
