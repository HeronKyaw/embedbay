use std::sync::atomic::Ordering;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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

    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("EmbedBay")
        .inner_size(1280.0, 800.0)
        .min_inner_size(960.0, 640.0)
        .center()
        .decorations(false)
        .build()?;

    Ok(())
}

/// Initializes the persistent System Tray / Menu Bar supervisor icon and context menu.
pub fn setup_tray(app: &App) -> tauri::Result<()> {
    let icon = Image::from_bytes(TRAY_ICON_BYTES)?;

    let open_item = MenuItem::with_id(app, "open", "Open EmbedBay", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit EmbedBay", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])?;

    TrayIconBuilder::with_id("embedbay-tray")
        .icon(icon)
        .tooltip("EmbedBay")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "open" => {
                let _ = open_or_focus_main_window(app_handle);
            }
            "quit" => {
                let state = app_handle.state::<AppState>();
                state.is_quitting.store(true, Ordering::SeqCst);
                app_handle.exit(0);
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
