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

pub fn force_kill_process_tree(_pid: u32) -> Result<(), String> {
    Err("Linux process tree kill not yet implemented (Phase 7)".to_string())
}

pub fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    let target = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(target);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch file manager: {}", e))
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(url);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open URL: {}", e))
}

pub fn keyring_backend_name() -> &'static str {
    "Linux Secret Service"
}
