pub mod adapters;
pub mod analytics;
pub mod commands;
pub mod db;
pub mod engines;
pub mod platform;
pub mod supervisor;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::db::Database;
use crate::engines::installer::DownloadManager;
use crate::engines::manifest::ManifestService;
use crate::supervisor::logs::InstanceLogStore;
use crate::supervisor::process_manager::ProcessManager;
use crate::supervisor::EventSink;

struct TauriEventSink(AppHandle);

impl EventSink for TauriEventSink {
    fn emit_json(&self, event: &str, payload: serde_json::Value) {
        let _ = self.0.emit(event, payload);
    }
}

pub struct AppState {
    pub db: Arc<Database>,
    pub manifest: Arc<ManifestService>,
    pub download_manager: Arc<DownloadManager>,
    pub logs: Arc<InstanceLogStore>,
    pub process_manager: Arc<ProcessManager>,
    pub event_sink: Arc<dyn EventSink>,
    pub is_quitting: AtomicBool,
    pub close_to_tray: AtomicBool,
    pub started_at: std::time::Instant,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let start_minimized = std::env::args().any(|arg| arg == "--minimized");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app_handle, args, _cwd| {
            // If a second launch happens without --minimized, open or focus the UI window.
            if !args.iter().any(|arg| arg == "--minimized") {
                let _ = supervisor::tray::open_or_focus_main_window(app_handle);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(move |app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

            let data_dir = app.path().app_local_data_dir()?;
            let db = Arc::new(
                Database::init(data_dir.clone())
                    .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?,
            );
            let manifest = Arc::new(
                ManifestService::load_or_init(&data_dir)
                    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?,
            );
            let logs = Arc::new(InstanceLogStore::default());
            let process_manager = Arc::new(ProcessManager::new(Arc::clone(&db), Arc::clone(&logs)));
            let event_sink: Arc<dyn EventSink> = Arc::new(TauriEventSink(app.handle().clone()));
            process_manager.set_event_sink(Arc::clone(&event_sink));

            let pm_bg = Arc::clone(&process_manager);
            tauri::async_runtime::spawn(async move {
                pm_bg.spawn_background_monitors().await;
            });

            let pm_boot = Arc::clone(&process_manager);
            let db_boot = Arc::clone(&db);
            tauri::async_runtime::spawn(async move {
                supervisor::autostart::run_autostart_sequence(pm_boot, db_boot).await;
            });

            let close_to_tray = db
                .get_app_setting("close_behavior")
                .ok()
                .flatten()
                .as_deref()
                != Some("quit");

            app.manage(AppState {
                db,
                manifest,
                download_manager: Arc::new(DownloadManager::default()),
                logs,
                process_manager,
                event_sink,
                is_quitting: AtomicBool::new(false),
                close_to_tray: AtomicBool::new(close_to_tray),
                started_at: std::time::Instant::now(),
            });

            // Re-register autostart on each launch so the entry always points at the
            // current executable (survives updates/moves) and includes --minimized.
            {
                use tauri_plugin_autostart::ManagerExt;
                let launcher = app.autolaunch();
                if launcher.is_enabled().unwrap_or(false) {
                    let _ = launcher.enable();
                }
            }

            supervisor::tray::setup_tray_with_retry(app.handle(), start_minimized);

            if !start_minimized {
                supervisor::tray::open_or_focus_main_window(app.handle())?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_platform_info,
            commands::get_app_status,
            commands::get_autostart_enabled,
            commands::set_autostart_enabled,
            commands::set_close_behavior,
            commands::get_diagnostics,
            commands::open_data_path,
            commands::open_external_url,
            commands::engines::list_engine_catalog,
            commands::engines::refresh_engine_catalog,
            commands::engines::list_installed_engines,
            commands::engines::list_active_installs,
            commands::engines::pause_engine_install,
            commands::engines::resume_engine_install,
            commands::engines::cancel_engine_install,
            commands::engines::get_storage_usage,
            commands::engines::cleanup_unused_engines,
            commands::engines::compact_database,
            commands::engines::install_engine,
            commands::engines::uninstall_engine,
            commands::instances::list_instances,
            commands::instances::create_instance,
            commands::instances::update_instance,
            commands::instances::delete_instance,
            commands::instances::start_instance,
            commands::instances::stop_instance,
            commands::instances::restart_instance,
            commands::instances::force_kill_instance,
            commands::instances::start_group_instances,
            commands::instances::stop_group_instances,
            commands::instances::stop_all_instances,
            commands::instances::stop_idle_instances,
            commands::instances::get_all_instance_metrics,
            commands::instances::get_instance_logs,
            commands::instances::subscribe_instance_logs,
            commands::instances::clear_instance_logs,
            commands::instances::check_port_available,
            commands::instances::suggest_available_port,
            commands::groups_tags::list_groups,
            commands::groups_tags::create_group,
            commands::groups_tags::update_group,
            commands::groups_tags::delete_group,
            commands::groups_tags::reorder_items,
            commands::groups_tags::list_tags,
            commands::groups_tags::create_tag,
            commands::groups_tags::update_tag,
            commands::groups_tags::delete_tag,
            commands::groups_tags::set_entity_tags,
            commands::connections::list_remote_connections,
            commands::connections::create_remote_connection,
            commands::connections::update_remote_connection,
            commands::connections::delete_remote_connection,
            commands::connections::list_embedding_profiles,
            commands::connections::create_embedding_profile,
            commands::connections::update_embedding_profile,
            commands::connections::delete_embedding_profile,
            commands::connections::test_embedding_profile,
            commands::connections::test_embedding_profile_draft,
            commands::connections::embed_texts,
            commands::explorer::test_connection,
            commands::explorer::list_collections,
            commands::explorer::get_collection_info,
            commands::explorer::create_collection,
            commands::explorer::delete_collection,
            commands::explorer::browse_records,
            commands::explorer::upsert_records,
            commands::explorer::delete_records,
            commands::explorer::search_vectors,
            commands::explorer::list_collection_indexes,
            commands::explorer::create_collection_index,
            commands::explorer::delete_collection_index,
            commands::search_meta::list_search_history,
            commands::search_meta::record_search_history,
            commands::search_meta::clear_search_history,
            commands::search_meta::list_search_presets,
            commands::search_meta::save_search_preset,
            commands::search_meta::delete_search_preset,
            commands::instances::backup_instance,
            commands::instances::restore_instance,
            commands::analytics::compute_embedding_projection,
            commands::transfer::import_records,
            commands::transfer::export_records,
            commands::transfer::migrate_collection,
            commands::transfer::export_search_results,
            commands::ingest::preview_document_chunks,
            commands::ingest::ingest_documents,
        ])
        .build(tauri::generate_context!())
        .expect("error while building EmbedBay Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                let is_quitting = state.is_quitting.load(Ordering::SeqCst);
                if !is_quitting {
                    if state.close_to_tray.load(Ordering::SeqCst) {
                        // Destroy-on-close: closing the WebView frees UI memory while keeping the
                        // Rust supervisor running in the System Tray until "Quit EmbedBay" is chosen.
                        api.prevent_exit();
                    } else {
                        // Quit mode: prevent immediate abrupt exit so managed DBs stop gracefully first.
                        api.prevent_exit();
                        state.is_quitting.store(true, Ordering::SeqCst);
                        let handle = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let st = handle.state::<AppState>();
                            let _ = st.process_manager.stop_all_instances().await;
                            handle.exit(0);
                        });
                    }
                }
            }
        }
    });
}
