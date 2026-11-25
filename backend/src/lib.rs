pub mod commands;
pub mod db;
pub mod platform;
pub mod supervisor;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

use crate::db::Database;

pub struct AppState {
    pub db: Database,
    pub is_quitting: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let start_minimized = std::env::args().any(|arg| arg == "--minimized");

    let app = tauri::Builder::default()
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
            let data_dir = app.path().app_local_data_dir()?;
            let db = Database::init(data_dir)
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

            app.manage(AppState {
                db,
                is_quitting: AtomicBool::new(false),
            });

            supervisor::tray::setup_tray(app)?;

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
        ])
        .build(tauri::generate_context!())
        .expect("error while building EmbedBay Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let is_quitting = app_handle
                .try_state::<AppState>()
                .map(|s| s.is_quitting.load(Ordering::SeqCst))
                .unwrap_or(false);

            // Destroy-on-close: closing the WebView frees UI memory while keeping the
            // Rust supervisor running in the System Tray until "Quit EmbedBay" is chosen.
            if !is_quitting {
                api.prevent_exit();
            }
        }
    });
}
