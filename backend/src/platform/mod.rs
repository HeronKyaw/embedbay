use std::path::Path;
use serde::Serialize;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "windows")]
use windows as os_impl;
#[cfg(target_os = "macos")]
use macos as os_impl;
#[cfg(target_os = "linux")]
use linux as os_impl;

#[derive(Debug, Clone, Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub target_triple: String,
}

/// Returns the Rust target triple used to key native engine binary downloads.
pub fn target_triple() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "aarch64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-gnu"
    }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
    )))]
    {
        "unsupported"
    }
}

pub fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        target_triple: target_triple().to_string(),
    }
}

/// Applies OS-specific process spawn settings (e.g. `CREATE_NO_WINDOW` on Windows).
pub fn configure_std_command(cmd: &mut std::process::Command) {
    os_impl::configure_std_command(cmd);
}

/// Applies OS-specific async process spawn settings (e.g. `CREATE_NO_WINDOW` on Windows).
pub fn configure_tokio_command(cmd: &mut tokio::process::Command) {
    os_impl::configure_tokio_command(cmd);
}

/// Ensures an extracted binary has executable permissions on Unix systems.
pub fn ensure_executable(path: &Path) -> Result<(), String> {
    os_impl::ensure_executable(path)
}

/// Sends a graceful termination signal to a managed child process PID.
pub fn graceful_stop_process(pid: u32) -> Result<(), String> {
    os_impl::graceful_stop_process(pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_triple_is_supported_on_host() {
        let info = platform_info();
        assert!(!info.target_triple.is_empty());
        assert_ne!(info.target_triple, "unsupported");
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        assert_eq!(info.target_triple, "x86_64-pc-windows-msvc");
    }
}
