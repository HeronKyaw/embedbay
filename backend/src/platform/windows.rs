use std::os::windows::process::CommandExt;
use std::path::Path;
use windows_sys::Win32::System::Console::{GenerateConsoleCtrlEvent, CTRL_BREAK_EVENT};

/// Prevents console windows from flashing when spawning background DB processes.
pub const CREATE_NO_WINDOW: u32 = 0x08000000;
/// Isolates child processes in their own process group so CTRL_BREAK_EVENT can target them.
pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

pub fn configure_std_command(cmd: &mut std::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

pub fn configure_tokio_command(cmd: &mut tokio::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

pub fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn graceful_stop_process(pid: u32) -> Result<(), String> {
    // SAFETY: Calling Win32 GenerateConsoleCtrlEvent with CTRL_BREAK_EVENT targeting
    // the child process group created with CREATE_NEW_PROCESS_GROUP.
    let ok = unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid) };
    if ok == 0 {
        return Err(format!(
            "GenerateConsoleCtrlEvent failed for PID {}: {}",
            pid,
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

pub fn force_kill_process_tree(pid: u32) -> Result<(), String> {
    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    configure_std_command(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to invoke taskkill for PID {}: {}", pid, e))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{} {}", stdout, stderr).to_ascii_lowercase();
    if combined.contains("not found") || combined.contains("no running instance") {
        return Ok(());
    }
    Err(format!(
        "taskkill failed for PID {} ({}): {}",
        pid,
        output.status,
        stderr.trim()
    ))
}

pub fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    let mut cmd = std::process::Command::new("explorer.exe");
    if path.is_file() {
        cmd.arg("/select,").arg(path);
    } else {
        cmd.arg(path);
    }
    configure_std_command(&mut cmd);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch explorer.exe: {}", e))
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    let mut cmd = std::process::Command::new("rundll32.exe");
    cmd.args(["url.dll,FileProtocolHandler", url]);
    configure_std_command(&mut cmd);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open URL in browser: {}", e))
}

pub fn keyring_backend_name() -> &'static str {
    "Windows Credential Manager"
}

pub fn show_clickable_notification<F>(
    app_id: &str,
    title: &str,
    body: &str,
    on_click: F,
) -> Result<(), String>
where
    F: Fn() + Send + 'static,
{
    tauri_winrt_notification::Toast::new(app_id)
        .title(title)
        .text1(body)
        .on_activated(move |_action| {
            on_click();
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creation_flags_match_win32_constants() {
        assert_eq!(CREATE_NO_WINDOW, 0x0800_0000);
        assert_eq!(CREATE_NEW_PROCESS_GROUP, 0x0000_0200);
    }
}
