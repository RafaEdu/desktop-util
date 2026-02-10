mod nfe;

use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

// ── Managed State ───────────────────────────────────────────────
struct AppState {
    movable_mode: Mutex<bool>,
}

#[tauri::command]
fn set_movable_mode(state: tauri::State<'_, AppState>, enabled: bool) {
    *state.movable_mode.lock().unwrap() = enabled;
}

// ── Certificate Types ───────────────────────────────────────────
#[derive(serde::Serialize)]
struct CertInfo {
    subject: String,
    issuer: String,
    not_after: String,
    thumbprint: String,
}

#[tauri::command]
fn get_certificates() -> Result<Vec<CertInfo>, String> {
    certs_impl()
}

#[cfg(windows)]
fn certs_impl() -> Result<Vec<CertInfo>, String> {
    use windows_sys::Win32::Security::Cryptography::*;
    //use windows_sys::Win32::Foundation::FILETIME;

    let mut results = Vec::new();
    let store_wide: Vec<u16> = "MY\0".encode_utf16().collect();

    unsafe {
        let store = CertOpenSystemStoreW(0, store_wide.as_ptr());
        if store.is_null() {
            return Err("Falha ao abrir repositório de certificados".into());
        }

        let mut prev: *const CERT_CONTEXT = std::ptr::null();
        loop {
            let cert = CertEnumCertificatesInStore(store, prev);
            if cert.is_null() {
                break;
            }

            let subject = cert_name_string(cert, 0);
            let issuer = cert_name_string(cert, CERT_NAME_ISSUER_FLAG);

            let info = &*(*cert).pCertInfo;
            let not_after = filetime_to_iso(info.NotAfter);
            let thumbprint = cert_thumbprint(cert);

            results.push(CertInfo {
                subject,
                issuer,
                not_after,
                thumbprint,
            });

            prev = cert;
        }

        let _ = CertCloseStore(store, 0);
    }

    Ok(results)
}

#[cfg(windows)]
unsafe fn cert_name_string(
    cert: *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT,
    flags: u32,
) -> String {
    use windows_sys::Win32::Security::Cryptography::*;

    let mut buf = vec![0u16; 512];
    let len = CertGetNameStringW(
        cert,
        CERT_NAME_SIMPLE_DISPLAY_TYPE,
        flags,
        std::ptr::null(),
        buf.as_mut_ptr(),
        buf.len() as u32,
    );
    if len <= 1 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize - 1])
}

#[cfg(windows)]
fn filetime_to_iso(ft: windows_sys::Win32::Foundation::FILETIME) -> String {
    use windows_sys::Win32::Foundation::SYSTEMTIME;
    use windows_sys::Win32::System::Time::FileTimeToSystemTime;

    let mut st = SYSTEMTIME {
        wYear: 0,
        wMonth: 0,
        wDayOfWeek: 0,
        wDay: 0,
        wHour: 0,
        wMinute: 0,
        wSecond: 0,
        wMilliseconds: 0,
    };

    let ok = unsafe { FileTimeToSystemTime(&ft as *const _, &mut st as *mut _) };
    if ok == 0 {
        return "N/A".to_string();
    }

    format!("{:04}-{:02}-{:02}", st.wYear, st.wMonth, st.wDay)
}

#[cfg(windows)]
unsafe fn cert_thumbprint(
    cert: *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT,
) -> String {
    use windows_sys::Win32::Security::Cryptography::CertGetCertificateContextProperty;

    const CERT_SHA1_HASH_PROP_ID: u32 = 3;
    let mut hash_size: u32 = 20;
    let mut hash = vec![0u8; 20];

    let ok = CertGetCertificateContextProperty(
        cert,
        CERT_SHA1_HASH_PROP_ID,
        hash.as_mut_ptr() as *mut _,
        &mut hash_size,
    );
    if ok == 0 {
        return String::new();
    }

    hash[..hash_size as usize]
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(not(windows))]
fn certs_impl() -> Result<Vec<CertInfo>, String> {
    Err("Listagem de certificados disponível apenas no Windows".into())
}

// ── Screen Capture ──────────────────────────────────────────────
#[tauri::command]
fn start_screen_capture() -> Result<(), String> {
    screen_capture_impl()
}

#[cfg(windows)]
fn screen_capture_impl() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "ms-screenclip:"])
        .spawn()
        .map_err(|e| format!("Falha ao iniciar captura de tela: {}", e))?;
    Ok(())
}

#[cfg(not(windows))]
fn screen_capture_impl() -> Result<(), String> {
    Err("Captura de tela disponível apenas no Windows".into())
}

// ── App Entry ───────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            movable_mode: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            set_movable_mode,
            get_certificates,
            start_screen_capture,
            nfe::query_nfe,
        ])
        // ── Plugins ──────────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:todo.db",
                    vec![
                        tauri_plugin_sql::Migration {
                            version: 1,
                            description: "create todos table",
                            sql: "CREATE TABLE IF NOT EXISTS todos (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                title TEXT NOT NULL,
                                done INTEGER NOT NULL DEFAULT 0,
                                created_at TEXT NOT NULL DEFAULT (datetime('now'))
                            );",
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 2,
                            description: "add completed_at column",
                            sql: "ALTER TABLE todos ADD COLUMN completed_at TEXT;",
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 3,
                            description: "add sort_order column",
                            sql: "ALTER TABLE todos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;",
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 4,
                            description: "initialize sort_order from id",
                            sql: "UPDATE todos SET sort_order = id;",
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                        tauri_plugin_sql::Migration {
                            version: 5,
                            description: "create quick_links table",
                            sql: "CREATE TABLE IF NOT EXISTS quick_links (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                title TEXT NOT NULL,
                                url TEXT NOT NULL,
                                created_at TEXT NOT NULL DEFAULT (datetime('now'))
                            );",
                            kind: tauri_plugin_sql::MigrationKind::Up,
                        },
                    ],
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
                .tooltip("Util")
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
                        rect,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                // Check movable mode
                                let movable = app_handle
                                    .try_state::<AppState>()
                                    .map(|s| *s.movable_mode.lock().unwrap())
                                    .unwrap_or(false);

                                if !movable {
                                    // Position window centered above the tray icon
                                    if let Ok(win_size) = window.outer_size() {
                                        let scale = window
                                            .scale_factor()
                                            .unwrap_or(1.0);
                                        let pos = rect.position.to_physical::<i32>(scale);
                                        let size = rect.size.to_physical::<u32>(scale);
                                        let x = pos.x
                                            + (size.width as i32 / 2)
                                            - (win_size.width as i32 / 2);
                                        let y = pos.y - win_size.height as i32 - 8;
                                        let _ = window.set_position(
                                            tauri::PhysicalPosition::new(x, y),
                                        );
                                    }
                                }
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
