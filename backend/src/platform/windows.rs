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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creation_flags_match_win32_constants() {
        assert_eq!(CREATE_NO_WINDOW, 0x0800_0000);
        assert_eq!(CREATE_NEW_PROCESS_GROUP, 0x0000_0200);
    }
}
