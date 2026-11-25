use std::path::Path;

// Phase 7 (Linux Priority 3) stubs.
// Full implementation will set POSIX process groups, chmod +x (0o755),
// and send SIGTERM/SIGINT on graceful stop.

pub fn configure_std_command(_cmd: &mut std::process::Command) {}

pub fn configure_tokio_command(_cmd: &mut tokio::process::Command) {}

pub fn ensure_executable(_path: &Path) -> Result<(), String> {
    Err("Linux platform executable permission helper not yet implemented (Phase 7)".to_string())
}

pub fn graceful_stop_process(_pid: u32) -> Result<(), String> {
    Err("Linux graceful stop not yet implemented (Phase 7)".to_string())
}
