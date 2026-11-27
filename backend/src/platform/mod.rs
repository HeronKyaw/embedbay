pub mod secrets;

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

/// Forcefully terminates a process and all of its descendant child processes.
pub fn force_kill_process_tree(pid: u32) -> Result<(), String> {
    os_impl::force_kill_process_tree(pid)
}

/// Validates that an external URL uses strict `https://` without control/whitespace injection.
pub fn validate_external_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL must not be empty".to_string());
    }
    if trimmed.len() > 2048 {
        return Err("URL exceeds maximum allowed length".to_string());
    }
    if !trimmed.starts_with("https://") {
        return Err("Only https:// external URLs are permitted".to_string());
    }
    if trimmed
        .chars()
        .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("URL contains invalid whitespace or control characters".to_string());
    }
    Ok(trimmed)
}

/// Opens an existing directory or file in the OS native file manager.
pub fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }
    os_impl::open_path_in_file_manager(path)
}

/// Opens a validated `https://` URL in the user's default browser.
pub fn open_external_url(url: &str) -> Result<(), String> {
    let valid = validate_external_url(url)?;
    os_impl::open_external_url(valid)
}

/// Returns the human-readable OS credential store name used by `keyring`.
pub fn keyring_backend_name() -> &'static str {
    os_impl::keyring_backend_name()
}

/// Shows a Windows toast notification that invokes `on_click` when activated by the user.
#[cfg(target_os = "windows")]
pub fn show_clickable_notification<F>(
    app_id: &str,
    title: &str,
    body: &str,
    on_click: F,
) -> Result<(), String>
where
    F: Fn() + Send + 'static,
{
    os_impl::show_clickable_notification(app_id, title, body, on_click)
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

    #[test]
    fn validate_external_url_allows_only_safe_https() {
        assert_eq!(
            validate_external_url("https://github.com/HeronKyaw/embedbay").expect("valid https"),
            "https://github.com/HeronKyaw/embedbay"
        );
        assert!(validate_external_url("").is_err());
        assert!(validate_external_url("http://example.com").is_err());
        assert!(validate_external_url("file:///C:/Windows/System32").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("https://example.com/path with spaces").is_err());
        assert!(validate_external_url("https://example.com/\nwhoami").is_err());
    }
}
