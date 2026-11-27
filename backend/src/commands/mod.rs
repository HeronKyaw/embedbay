pub mod analytics;
pub mod connections;
pub mod engines;
pub mod explorer;
pub mod groups_tags;
pub mod ingest;
pub mod instances;
pub mod search_meta;
pub mod transfer;

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::Serialize;
use sysinfo::{CpuRefreshKind, RefreshKind, System};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::db::{Database, SqliteDiagnostics};
use crate::engines::manifest::ManifestDiagnostics;
use crate::platform::{self, PlatformInfo};
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct AppStatus {
    pub app_version: String,
    pub platform: PlatformInfo,
    pub data_dir: String,
    pub db_path: String,
    pub schema_version: i64,
    pub autostart_enabled: bool,
    pub close_behavior: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppRuntimeDiagnostics {
    pub version: String,
    pub uptime_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostDiagnostics {
    pub os_name: String,
    pub os_version: String,
    pub arch: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub cpu_percent: f32,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub disk_available_bytes: u64,
    pub disk_total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct KeyringDiagnostics {
    pub backend_name: String,
    pub stored_secret_refs: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticPaths {
    pub data_dir: String,
    pub db_path: String,
    pub bin_dir: String,
    pub instances_dir: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagnosticsReport {
    pub app: AppRuntimeDiagnostics,
    pub host: HostDiagnostics,
    pub database: SqliteDiagnostics,
    pub manifest: ManifestDiagnostics,
    pub keyring: KeyringDiagnostics,
    pub paths: DiagnosticPaths,
}

pub fn resolve_allowed_open_path(db: &Database, requested: Option<&str>) -> Result<PathBuf, String> {
    let raw = requested.map(str::trim).filter(|s| !s.is_empty());
    let data_root = db.data_root();
    let Some(req_str) = raw else {
        return Ok(data_root.to_path_buf());
    };

    let req_path = Path::new(req_str);
    if !req_path.exists() {
        return Err(format!("Path does not exist: {}", req_path.display()));
    }
    let canon_req = std::fs::canonicalize(req_path)
        .map_err(|e| format!("Failed to resolve path '{}': {}", req_path.display(), e))?;

    if let Ok(canon_root) = std::fs::canonicalize(data_root) {
        if canon_req.starts_with(&canon_root) {
            return Ok(canon_req);
        }
    }

    let instances = db.list_instances().map_err(|e| e.to_string())?;
    for inst in instances {
        if let Ok(canon_inst) = std::fs::canonicalize(Path::new(&inst.data_dir)) {
            if canon_req.starts_with(&canon_inst) {
                return Ok(canon_req);
            }
        }
    }

    Err("Access denied: path must reside inside EmbedBay data directory or a registered instance directory".to_string())
}

#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    platform::platform_info()
}

#[tauri::command]
pub fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.disable().map_err(|e| e.to_string())?;
    }
    autolaunch.is_enabled().map_err(|e| e.to_string())
}

pub fn normalize_close_behavior(raw: &str) -> Result<&'static str, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "tray" => Ok("tray"),
        "quit" => Ok("quit"),
        other => Err(format!(
            "Invalid close behavior '{}': expected 'tray' or 'quit'",
            other
        )),
    }
}

#[tauri::command]
pub fn set_close_behavior(
    state: State<'_, AppState>,
    behavior: String,
) -> Result<String, String> {
    let normalized = normalize_close_behavior(&behavior)?;
    state
        .db
        .set_app_setting("close_behavior", normalized)
        .map_err(|e| e.to_string())?;
    state
        .close_to_tray
        .store(normalized == "tray", Ordering::SeqCst);
    Ok(normalized.to_string())
}

#[tauri::command]
pub fn get_app_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppStatus, String> {
    let schema_version = state.db.schema_version().map_err(|e| e.to_string())?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let close_behavior = if state.close_to_tray.load(Ordering::SeqCst) {
        "tray".to_string()
    } else {
        "quit".to_string()
    };

    Ok(AppStatus {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: platform::platform_info(),
        data_dir: state.db.data_root().to_string_lossy().into_owned(),
        db_path: state.db.db_path().to_string_lossy().into_owned(),
        schema_version,
        autostart_enabled,
        close_behavior,
    })
}

#[tauri::command]
pub fn open_data_path(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), String> {
    let allowed = resolve_allowed_open_path(&state.db, path.as_deref())?;
    platform::open_path_in_file_manager(&allowed)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    platform::open_external_url(&url)
}

#[tauri::command]
pub async fn prepare_app_update_restart(state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.process_manager.stop_all_instances().await;
    state
        .db
        .set_app_setting("post_update_show_window", "1")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn consume_pending_open_about(state: State<'_, AppState>) -> Result<bool, String> {
    let pending = state
        .db
        .get_app_setting("open_about_on_launch")
        .ok()
        .flatten()
        .as_deref()
        == Some("1");
    if pending {
        let _ = state.db.set_app_setting("open_about_on_launch", "0");
    }
    Ok(pending)
}

pub fn sanitize_release_tag(raw_version: &str) -> Result<String, String> {
    let trimmed = raw_version.trim().trim_start_matches(['v', 'V']);
    if trimmed.is_empty()
        || trimmed.len() > 64
        || trimmed.contains("..")
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err(format!("Invalid release version '{raw_version}'"));
    }
    Ok(format!("v{trimmed}"))
}

#[tauri::command]
pub async fn fetch_github_release_notes(version: String) -> Result<Option<String>, String> {
    let tag = sanitize_release_tag(&version)?;
    let url = format!("https://api.github.com/repos/HeronKyaw/embedbay/releases/tags/{tag}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent(format!("EmbedBay/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = match client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(None),
    };

    let payload: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    let body = payload
        .get("body")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    Ok(body)
}

#[tauri::command]
pub async fn get_diagnostics(state: State<'_, AppState>) -> Result<DiagnosticsReport, String> {
    let metrics_summary = state.process_manager.get_all_instance_metrics().await?;
    let database = state.db.sqlite_diagnostics().map_err(|e| e.to_string())?;
    let manifest = state.manifest.diagnostics_info()?;
    let plat = platform::platform_info();

    let sys = System::new_with_specifics(
        RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing()),
    );
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());

    let os_name = System::name().unwrap_or_else(|| plat.os.clone());
    let os_version = System::long_os_version().unwrap_or_else(|| plat.os.clone());

    Ok(DiagnosticsReport {
        app: AppRuntimeDiagnostics {
            version: env!("CARGO_PKG_VERSION").to_string(),
            uptime_secs: state.started_at.elapsed().as_secs(),
        },
        host: HostDiagnostics {
            os_name,
            os_version,
            arch: plat.arch,
            cpu_brand,
            cpu_cores: metrics_summary.host.cpu_cores,
            cpu_percent: metrics_summary.host.cpu_percent,
            memory_used_bytes: metrics_summary.host.memory_used_bytes,
            memory_total_bytes: metrics_summary.host.memory_total_bytes,
            disk_available_bytes: metrics_summary.host.disk_available_bytes,
            disk_total_bytes: metrics_summary.host.disk_total_bytes,
        },
        keyring: KeyringDiagnostics {
            backend_name: platform::keyring_backend_name().to_string(),
            stored_secret_refs: database.stored_secret_refs,
        },
        database,
        manifest,
        paths: DiagnosticPaths {
            data_dir: state.db.data_root().to_string_lossy().into_owned(),
            db_path: state.db.db_path().to_string_lossy().into_owned(),
            bin_dir: state.db.bin_dir().to_string_lossy().into_owned(),
            instances_dir: state
                .db
                .data_root()
                .join("instances")
                .to_string_lossy()
                .into_owned(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::CreateInstancePayload;

    #[test]
    fn resolve_allowed_open_path_enforces_root_boundaries() {
        let root_dir = tempfile::tempdir().expect("root temp dir");
        let custom_inst_dir = tempfile::tempdir().expect("custom inst temp dir");
        let outside_dir = tempfile::tempdir().expect("outside temp dir");

        let db = Database::init(root_dir.path().to_path_buf()).expect("db init");
        let nested_in_root = root_dir.path().join("bin");
        std::fs::create_dir_all(&nested_in_root).expect("mkdir nested");

        db.create_instance(CreateInstancePayload {
            name: "Custom Dir Qdrant".to_string(),
            description: None,
            color: None,
            group_id: None,
            engine_type: "qdrant".to_string(),
            engine_version: "1.20.2".to_string(),
            host: None,
            port: 16555,
            grpc_port: None,
            data_dir: Some(custom_inst_dir.path().to_string_lossy().into_owned()),
            config_json: None,
            auto_start: None,
            idle_timeout_minutes: None,
            tag_ids: None,
        })
        .expect("create instance");

        assert_eq!(
            resolve_allowed_open_path(&db, None).expect("default root"),
            root_dir.path()
        );
        assert!(resolve_allowed_open_path(&db, Some(&nested_in_root.to_string_lossy())).is_ok());
        assert!(
            resolve_allowed_open_path(&db, Some(&custom_inst_dir.path().to_string_lossy()))
                .is_ok()
        );
        assert!(
            resolve_allowed_open_path(&db, Some(&outside_dir.path().to_string_lossy())).is_err()
        );
    }

    #[test]
    fn normalize_close_behavior_validates_values() {
        assert_eq!(normalize_close_behavior("tray").expect("tray"), "tray");
        assert_eq!(normalize_close_behavior(" QUIT ").expect("quit"), "quit");
        assert!(normalize_close_behavior("minimize").is_err());
        assert!(normalize_close_behavior("").is_err());
    }

    #[test]
    fn sanitize_release_tag_accepts_semver_and_rejects_traversal() {
        assert_eq!(sanitize_release_tag("0.1.2").expect("semver"), "v0.1.2");
        assert_eq!(sanitize_release_tag("v0.1.2-beta.1").expect("prefixed"), "v0.1.2-beta.1");
        assert!(sanitize_release_tag("").is_err());
        assert!(sanitize_release_tag("../0.1.2").is_err());
        assert!(sanitize_release_tag("0.1.2/foo").is_err());
        assert!(sanitize_release_tag("0.1.2?x=1").is_err());
    }
}
