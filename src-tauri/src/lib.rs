use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Plugins ──────────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:todo.db",
                    vec![tauri_plugin_sql::Migration {
                        version: 1,
                        description: "create todos table",
                        sql: "CREATE TABLE IF NOT EXISTS todos (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            title TEXT NOT NULL,
                            done INTEGER NOT NULL DEFAULT 0,
                            created_at TEXT NOT NULL DEFAULT (datetime('now'))
                        );",
                        kind: tauri_plugin_sql::MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostarted"]),
        ))
        .plugin(tauri_plugin_notification::init())
        // ── System Tray Setup ────────────────────────────────────
        .setup(|app| {
            // Menu items
            let show_hide = MenuItemBuilder::with_id("toggle", "Mostrar/Ocultar")
                .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Sair").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_hide)
                .separator()
                .item(&quit)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("To-Do App")
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "toggle" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "quit" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Enable autostart
            let autostart_manager = app.handle().plugin_autostart();
            if !autostart_manager.is_enabled().unwrap_or(false) {
                let _ = autostart_manager.enable();
            }

            Ok(())
        })
        // ── Prevent close → hide instead ─────────────────────────
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Helper trait para acessar o plugin de autostart de forma limpa.
trait AutostartExt {
    fn plugin_autostart(&self) -> &tauri_plugin_autostart::AutoLaunchManager;
}

impl AutostartExt for tauri::AppHandle {
    fn plugin_autostart(&self) -> &tauri_plugin_autostart::AutoLaunchManager {
        self.state::<tauri_plugin_autostart::AutoLaunchManager>()
            .inner()
    }
}
