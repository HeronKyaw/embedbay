use std::path::Path;

// Phase 6 (macOS Priority 2) stubs.
// Full implementation will set POSIX process groups, chmod +x (0o755),
// and send SIGTERM/SIGINT on graceful stop.

pub fn configure_std_command(_cmd: &mut std::process::Command) {}

pub fn configure_tokio_command(_cmd: &mut tokio::process::Command) {}

pub fn ensure_executable(_path: &Path) -> Result<(), String> {
    Err("macOS platform executable permission helper not yet implemented (Phase 6)".to_string())
}

pub fn graceful_stop_process(_pid: u32) -> Result<(), String> {
    Err("macOS graceful stop not yet implemented (Phase 6)".to_string())
}
