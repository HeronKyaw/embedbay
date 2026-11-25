use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::supervisor::EventSink;

pub const MAX_MEMORY_LOG_LINES: usize = 1000;
pub const DEFAULT_MAX_LOG_FILE_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_LOG_ROTATIONS: usize = 3;

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp_ms: i64,
    pub stream: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstanceLogEvent {
    pub instance_id: String,
    pub entry: LogEntry,
}

struct InstanceLogBuffer {
    entries: VecDeque<LogEntry>,
    max_file_bytes: u64,
}

pub struct InstanceLogStore {
    buffers: Mutex<HashMap<String, InstanceLogBuffer>>,
    default_max_file_bytes: u64,
}

impl Default for InstanceLogStore {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_LOG_FILE_BYTES)
    }
}

impl InstanceLogStore {
    pub fn new(default_max_file_bytes: u64) -> Self {
        Self {
            buffers: Mutex::new(HashMap::new()),
            default_max_file_bytes,
        }
    }

    pub fn append(
        &self,
        instance_id: &str,
        log_dir: &Path,
        stream: &str,
        message: &str,
        sink: Option<&dyn EventSink>,
    ) {
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let entry = LogEntry {
            timestamp_ms,
            stream: stream.to_string(),
            message: message.trim_end_matches(&['\r', '\n'][..]).to_string(),
        };

        let line = format!("[{}][{}] {}\n", entry.timestamp_ms, entry.stream, entry.message);

        {
            let mut map = match self.buffers.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            let buf = map
                .entry(instance_id.to_string())
                .or_insert_with(|| InstanceLogBuffer {
                    entries: VecDeque::with_capacity(MAX_MEMORY_LOG_LINES),
                    max_file_bytes: self.default_max_file_bytes,
                });

            if buf.entries.len() >= MAX_MEMORY_LOG_LINES {
                buf.entries.pop_front();
            }
            buf.entries.push_back(entry.clone());

            let _ = write_rotating_log(log_dir, &line, buf.max_file_bytes);
        }

        if let Some(s) = sink {
            if let Ok(val) = serde_json::to_value(InstanceLogEvent {
                instance_id: instance_id.to_string(),
                entry,
            }) {
                s.emit_json("instance-log", val);
            }
        }
    }

    pub fn get_logs(&self, instance_id: &str, log_dir: &Path, limit: usize) -> Vec<LogEntry> {
        let cap = limit.clamp(1, MAX_MEMORY_LOG_LINES);
        if let Ok(mut map) = self.buffers.lock() {
            if let Some(buf) = map.get(instance_id) {
                if !buf.entries.is_empty() {
                    let start = buf.entries.len().saturating_sub(cap);
                    return buf.entries.iter().skip(start).cloned().collect();
                }
            }

            // Cold read from disk if buffer is empty (e.g. after app restart)
            let disk_entries = read_tail_from_disk(log_dir, cap);
            if !disk_entries.is_empty() {
                let buf = map
                    .entry(instance_id.to_string())
                    .or_insert_with(|| InstanceLogBuffer {
                        entries: VecDeque::with_capacity(MAX_MEMORY_LOG_LINES),
                        max_file_bytes: self.default_max_file_bytes,
                    });
                for entry in &disk_entries {
                    if buf.entries.len() >= MAX_MEMORY_LOG_LINES {
                        buf.entries.pop_front();
                    }
                    buf.entries.push_back(entry.clone());
                }
            }
            return disk_entries;
        }
        Vec::new()
    }

    pub fn clear_logs(&self, instance_id: &str, log_dir: &Path) -> Result<(), String> {
        if let Ok(mut map) = self.buffers.lock() {
            if let Some(buf) = map.get_mut(instance_id) {
                buf.entries.clear();
            }
        }
        let active = log_dir.join("instance.log");
        if active.exists() {
            fs::write(&active, b"").map_err(|e| e.to_string())?;
        }
        for i in 1..MAX_LOG_ROTATIONS {
            let rotated = log_dir.join(format!("instance.log.{}", i));
            if rotated.exists() {
                let _ = fs::remove_file(rotated);
            }
        }
        Ok(())
    }
}

fn write_rotating_log(log_dir: &Path, line: &str, max_file_bytes: u64) -> std::io::Result<()> {
    fs::create_dir_all(log_dir)?;
    let active_path = log_dir.join("instance.log");

    if active_path.exists() {
        let len = fs::metadata(&active_path)?.len();
        if len + (line.len() as u64) > max_file_bytes {
            rotate_files(log_dir)?;
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&active_path)?;
    file.write_all(line.as_bytes())?;
    Ok(())
}

fn rotate_files(log_dir: &Path) -> std::io::Result<()> {
    for idx in (1..MAX_LOG_ROTATIONS).rev() {
        let src: PathBuf = if idx == 1 {
            log_dir.join("instance.log")
        } else {
            log_dir.join(format!("instance.log.{}", idx - 1))
        };
        let dst = log_dir.join(format!("instance.log.{}", idx));
        if dst.exists() {
            let _ = fs::remove_file(&dst);
        }
        if src.exists() {
            fs::rename(&src, &dst)?;
        }
    }
    Ok(())
}

fn parse_log_line(raw: &str) -> LogEntry {
    if let Some(rest) = raw.strip_prefix('[') {
        if let Some((ts_str, after_ts)) = rest.split_once("][") {
            if let Some((stream, msg)) = after_ts.split_once("] ") {
                if let Ok(ts) = ts_str.parse::<i64>() {
                    return LogEntry {
                        timestamp_ms: ts,
                        stream: stream.to_string(),
                        message: msg.to_string(),
                    };
                }
            }
        }
    }
    LogEntry {
        timestamp_ms: 0,
        stream: "stdout".to_string(),
        message: raw.to_string(),
    }
}

fn read_tail_from_disk(log_dir: &Path, limit: usize) -> Vec<LogEntry> {
    let active = log_dir.join("instance.log");
    let Ok(file) = fs::File::open(active) else {
        return Vec::new();
    };
    let reader = BufReader::new(file);
    let mut ring = VecDeque::with_capacity(limit);
    for line in reader.lines().map_while(Result::ok) {
        if ring.len() >= limit {
            ring.pop_front();
        }
        ring.push_back(parse_log_line(&line));
    }
    ring.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_caps_at_1000_lines() {
        let dir = tempfile::tempdir().expect("temp dir");
        let log_dir = dir.path().join("logs");
        let store = InstanceLogStore::default();

        for i in 0..1250 {
            store.append("inst-1", &log_dir, "stdout", &format!("line {}", i), None);
        }

        let entries = store.get_logs("inst-1", &log_dir, 2000);
        assert_eq!(entries.len(), 1000);
        assert_eq!(entries.first().expect("first").message, "line 250");
        assert_eq!(entries.last().expect("last").message, "line 1249");
    }

    #[test]
    fn rotates_log_files_beyond_max_bytes() {
        let dir = tempfile::tempdir().expect("temp dir");
        let log_dir = dir.path().join("logs");
        let store = InstanceLogStore::new(150);

        for i in 0..20 {
            store.append(
                "inst-rot",
                &log_dir,
                "stdout",
                &format!("rotation test payload line number {}", i),
                None,
            );
        }

        assert!(log_dir.join("instance.log").exists());
        assert!(log_dir.join("instance.log.1").exists());
        assert!(log_dir.join("instance.log.2").exists());
        assert!(!log_dir.join("instance.log.3").exists());
    }
}
