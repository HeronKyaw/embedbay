use std::sync::atomic::Ordering;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::AppState;

const TRAY_ICON_BYTES: &[u8] = include_bytes!("../../../installer/icons/tray.png");

/// Opens the main WebView window if destroyed, or focuses/unminimizes it if already open.
pub fn open_or_focus_main_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        window.set_focus()?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("EmbedBay")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .background_color(tauri::window::Color(9, 12, 18, 255))
        .center()
        .decorations(false)
        .build()?;

    let _ = window.show();
    let _ = window.set_focus();

    Ok(())
}

/// Initializes the persistent System Tray / Menu Bar supervisor icon and context menu.
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = Image::from_bytes(TRAY_ICON_BYTES)?;

    let open_item = MenuItem::with_id(app, "open", "Open EmbedBay", true, None::<&str>)?;
    let stop_all_item = MenuItem::with_id(
        app,
        "stop_all",
        "Stop All Running Services",
        true,
        None::<&str>,
    )?;
    let stop_idle_item = MenuItem::with_id(
        app,
        "stop_idle",
        "Stop Idle Services",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit EmbedBay", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&open_item, &stop_all_item, &stop_idle_item, &separator, &quit_item],
    )?;

    TrayIconBuilder::with_id("embedbay-tray")
        .icon(icon)
        .tooltip("EmbedBay")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "open" => {
                let _ = open_or_focus_main_window(app_handle);
            }
            "stop_all" => {
                let handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>();
                    let _ = state.process_manager.stop_all_instances().await;
                });
            }
            "stop_idle" => {
                let handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>();
                    let _ = state.process_manager.stop_idle_instances(5).await;
                });
            }
            "quit" => {
                let handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>();
                    let _ = state.process_manager.stop_all_instances().await;
                    state.is_quitting.store(true, Ordering::SeqCst);
                    handle.exit(0);
                });
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = open_or_focus_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Creates the tray icon, retrying in the background when the shell is not ready yet
/// (common right after logon, before Explorer's taskbar exists).
/// Returns `true` if the tray was created on the first attempt.
pub fn setup_tray_with_retry(app: &AppHandle, show_window_on_failure: bool) -> bool {
    if setup_tray(app).is_ok() {
        return true;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        for _ in 0..30 {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let h = handle.clone();
            let (tx, rx) = std::sync::mpsc::channel();
            let _ = handle.run_on_main_thread(move || {
                let _ = tx.send(setup_tray(&h).is_ok());
            });
            if rx.recv().unwrap_or(false) {
                return;
            }
        }
        // Tray never became available: show the UI so the app is not invisible.
        if show_window_on_failure {
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                let _ = open_or_focus_main_window(&h);
            });
        }
    });
    false
}
