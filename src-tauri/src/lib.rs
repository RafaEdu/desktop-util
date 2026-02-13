mod nfe;
mod pdf_utils;

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
pub struct CertInfo {
    subject: String,
    issuer: String,
    not_after: String,
    thumbprint: String,
    cnpj: String,
}

#[tauri::command]
fn get_certificates() -> Result<Vec<CertInfo>, String> {
    certs_impl()
}

// NOVO COMANDO: Excluir certificados
#[tauri::command]
fn delete_certificates(thumbprints: Vec<String>) -> Result<(), String> {
    delete_certs_impl(thumbprints)
}

#[cfg(windows)]
fn delete_certs_impl(thumbprints: Vec<String>) -> Result<(), String> {
    use windows_sys::Win32::Security::Cryptography::*;
    use std::ptr;

    let store_wide: Vec<u16> = "MY\0".encode_utf16().collect();

    unsafe {
        // Abre o store com permissão padrão (que permite exclusão no repositório do usuário)
        let store = CertOpenSystemStoreW(0, store_wide.as_ptr());
        if store.is_null() {
            return Err("Falha ao abrir repositório de certificados".into());
        }

        for thumb_str in thumbprints {
            // Remove os dois pontos da string (ex: "AA:BB" -> "AABB") e converte para bytes
            let clean_hex = thumb_str.replace(":", "");
            let mut hash_bytes = match hex::decode(&clean_hex) {
                Ok(b) => b,
                Err(_) => continue, // Se o hash for inválido, pula
            };

            let blob = CRYPT_INTEGER_BLOB {
                cbData: hash_bytes.len() as u32,
                pbData: hash_bytes.as_mut_ptr(),
            };

            // Busca o certificado pelo Hash SHA1
            let cert_ctx = CertFindCertificateInStore(
                store,
                X509_ASN_ENCODING | PKCS_7_ASN_ENCODING,
                0,
                CERT_FIND_SHA1_HASH,
                &blob as *const _ as *const _,
                ptr::null(),
            );

            if !cert_ctx.is_null() {
                // Tenta deletar. Nota: CertDeleteCertificateFromStore libera o contexto cert_ctx,
                // então não precisamos chamar CertFreeCertificateContext aqui se der certo.
                let result = CertDeleteCertificateFromStore(cert_ctx);
                if result == 0 {
                    // Se falhar deletar, libera o contexto manualmente para evitar leak
                    CertFreeCertificateContext(cert_ctx);
                }
            }
        }

        CertCloseStore(store, 0);
    }

    Ok(())
}

#[cfg(not(windows))]
fn delete_certs_impl(_thumbprints: Vec<String>) -> Result<(), String> {
    Err("Exclusão de certificados disponível apenas no Windows".into())
}


#[cfg(windows)]
fn certs_impl() -> Result<Vec<CertInfo>, String> {
    use windows_sys::Win32::Security::Cryptography::*;

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
            let rdn_subject = cert_rdn_string(cert);

            let info = &*(*cert).pCertInfo;
            let not_after = filetime_to_iso(info.NotAfter);
            let thumbprint = cert_thumbprint(cert);
            let cnpj = extract_cnpj_from_strings(&subject, &rdn_subject);

            results.push(CertInfo {
                subject,
                issuer,
                not_after,
                thumbprint,
                cnpj,
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

// ── CNPJ Extraction from Certificate ────────────────────────────

#[cfg(windows)]
unsafe fn cert_rdn_string(
    cert: *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT,
) -> String {
    use windows_sys::Win32::Security::Cryptography::*;

    const LOCAL_CERT_NAME_RDN_TYPE: u32 = 2;
    let mut buf = vec![0u16; 2048];
    let len = CertGetNameStringW(
        cert,
        LOCAL_CERT_NAME_RDN_TYPE,
        0,
        std::ptr::null(),
        buf.as_mut_ptr(),
        buf.len() as u32,
    );
    if len <= 1 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize - 1])
}

fn extract_cnpj_from_strings(simple_name: &str, rdn: &str) -> String {
    if let Some(cnpj) = find_cnpj_in_string(simple_name) {
        return cnpj;
    }
    if let Some(cnpj) = find_cnpj_in_string(rdn) {
        return cnpj;
    }
    String::new()
}

fn find_cnpj_in_string(s: &str) -> Option<String> {
    // Pattern 1: after colon (e.g., "EMPRESA LTDA:12345678000190")
    for part in s.split(':') {
        let trimmed = part.trim();
        if trimmed.len() == 14 && trimmed.chars().all(|c| c.is_ascii_digit()) {
            return Some(trimmed.to_string());
        }
    }
    // Pattern 2: any 14-digit contiguous sequence
    let mut buf = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() {
            buf.push(c);
        } else {
            if buf.len() == 14 {
                return Some(buf);
            }
            buf.clear();
        }
    }
    if buf.len() == 14 {
        return Some(buf);
    }
    None
}

// ── Screen Capture ──────────────────────────────────────────────
#[tauri::command]
fn start_screen_capture() -> Result<(), String> {
    screen_capture_impl()
}

#[tauri::command]
fn open_external_link(url: String, mode: Option<String>) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL inválida: use http:// ou https://".into());
    }

    let selected_mode = mode
        .as_deref()
        .unwrap_or("normal")
        .trim()
        .to_ascii_lowercase();

    match selected_mode.as_str() {
        "incognito" | "private" => open_link_incognito_impl(&url),
        _ => open_link_normal_impl(&url),
    }
}

#[cfg(windows)]
fn open_link_normal_impl(url: &str) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map_err(|e| format!("Falha ao abrir link: {}", e))?;
    Ok(())
}

#[cfg(not(windows))]
fn open_link_normal_impl(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Falha ao abrir link: {}", e))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Falha ao abrir link: {}", e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Abertura de links não suportada neste sistema".into())
}

#[cfg(windows)]
fn open_link_incognito_impl(url: &str) -> Result<(), String> {
    fn spawn_private(browser: &str, flag: &str, url: &str) -> bool {
        std::process::Command::new(browser)
            .arg(flag)
            .arg(url)
            .spawn()
            .is_ok()
    }

    // ... (restante da implementação existente de incognito)
    fn parse_reg_value(stdout: &str, value_name: &str) -> Option<String> {
        stdout
            .lines()
            .find(|line| line.trim_start().starts_with(value_name))
            .and_then(|line| {
                let mut parts = line.split_whitespace();
                let name = parts.next()?;
                if name != value_name {
                    return None;
                }
                let reg_type = parts.next()?;
                if !reg_type.starts_with("REG_") {
                    return None;
                }
                let value = parts.collect::<Vec<_>>().join(" ").trim().to_string();
                if value.is_empty() {
                    None
                } else {
                    Some(value)
                }
            })
    }

    fn extract_executable_from_command(command: &str) -> Option<String> {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return None;
        }

        if let Some(rest) = trimmed.strip_prefix('"') {
            let end = rest.find('"')?;
            return Some(rest[..end].to_string());
        }

        Some(trimmed.split_whitespace().next()?.to_string())
    }

    fn private_flag_for_exe(exe_path: &str) -> Option<&'static str> {
        let exe = std::path::Path::new(exe_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();

        if exe.contains("edge") {
            return Some("--inprivate");
        }
        if exe.contains("chrome") || exe.contains("brave") || exe.contains("vivaldi") {
            return Some("--incognito");
        }
        if exe.contains("firefox") {
            return Some("--private-window");
        }
        if exe.contains("opera") {
            return Some("--private");
        }
        None
    }

    fn default_browser_executable() -> Option<String> {
        let user_choice = std::process::Command::new("reg")
            .args([
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
                "/v",
                "ProgId",
            ])
            .output()
            .ok()?;
        if !user_choice.status.success() {
            return None;
        }

        let prog_id_output = String::from_utf8_lossy(&user_choice.stdout);
        let prog_id = parse_reg_value(&prog_id_output, "ProgId")?;

        let open_command = std::process::Command::new("reg")
            .args([
                "query",
                &format!("HKCR\\{}\\shell\\open\\command", prog_id),
                "/ve",
            ])
            .output()
            .ok()?;
        if !open_command.status.success() {
            return None;
        }

        let command_output = String::from_utf8_lossy(&open_command.stdout);
        let command_line = parse_reg_value(&command_output, "(Default)")?;
        extract_executable_from_command(&command_line)
    }

    if let Some(default_exe) = default_browser_executable() {
        if let Some(flag) = private_flag_for_exe(&default_exe) {
            if spawn_private(&default_exe, flag, url) {
                return Ok(());
            }
        } else {
            return Err(
                "Navegador padrão não reconhecido para modo anônimo. Defina Chrome, Edge, Brave, Firefox, Vivaldi ou Opera como padrão."
                    .into(),
            );
        }
    }

    let env_candidates = [
        ("PROGRAMFILES", "Microsoft\\Edge\\Application\\msedge.exe", "--inprivate"),
        ("PROGRAMFILES(X86)", "Microsoft\\Edge\\Application\\msedge.exe", "--inprivate"),
        ("LOCALAPPDATA", "Microsoft\\Edge\\Application\\msedge.exe", "--inprivate"),
        ("PROGRAMFILES", "Google\\Chrome\\Application\\chrome.exe", "--incognito"),
        ("PROGRAMFILES(X86)", "Google\\Chrome\\Application\\chrome.exe", "--incognito"),
        ("LOCALAPPDATA", "Google\\Chrome\\Application\\chrome.exe", "--incognito"),
        ("PROGRAMFILES", "BraveSoftware\\Brave-Browser\\Application\\brave.exe", "--incognito"),
        ("PROGRAMFILES(X86)", "BraveSoftware\\Brave-Browser\\Application\\brave.exe", "--incognito"),
        ("LOCALAPPDATA", "BraveSoftware\\Brave-Browser\\Application\\brave.exe", "--incognito"),
        ("PROGRAMFILES", "Mozilla Firefox\\firefox.exe", "--private-window"),
        ("PROGRAMFILES(X86)", "Mozilla Firefox\\firefox.exe", "--private-window"),
        ("LOCALAPPDATA", "Mozilla Firefox\\firefox.exe", "--private-window"),
    ];

    for (env_var, relative_path, flag) in env_candidates {
        if let Ok(base) = std::env::var(env_var) {
            let browser_path = std::path::Path::new(&base).join(relative_path);
            if browser_path.exists() && spawn_private(browser_path.to_string_lossy().as_ref(), flag, url) {
                return Ok(());
            }
        }
    }

    let path_candidates = [
        ("msedge", "--inprivate"),
        ("msedge.exe", "--inprivate"),
        ("chrome", "--incognito"),
        ("chrome.exe", "--incognito"),
        ("brave", "--incognito"),
        ("brave.exe", "--incognito"),
        ("firefox", "--private-window"),
        ("firefox.exe", "--private-window"),
    ];

    for (browser, flag) in path_candidates {
        if spawn_private(browser, flag, url) {
            return Ok(());
        }
    }

    Err(
        "Não foi possível abrir em modo anônimo no navegador padrão. Verifique o navegador padrão e se ele está instalado corretamente."
            .into(),
    )
}

#[cfg(not(windows))]
fn open_link_incognito_impl(url: &str) -> Result<(), String> {
    let browsers = [
        ("google-chrome", "--incognito"),
        ("chromium", "--incognito"),
        ("brave-browser", "--incognito"),
        ("firefox", "--private-window"),
    ];

    for (browser, flag) in browsers {
        if std::process::Command::new(browser)
            .arg(flag)
            .arg(url)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }

    Err("Não foi possível abrir em modo privado no sistema atual".into())
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
            delete_certificates,
            start_screen_capture,
            open_external_link,
            nfe::query_nfe,
            nfe::open_danfe,
            nfe::download_danfe,
            nfe::query_nfe_portal,
            pdf_utils::merge_pdfs,
            pdf_utils::split_pdf,
            pdf_utils::get_pdf_info,
            pdf_utils::compress_pdf,
        ])
        // ── Plugins ──────────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            // ... (setup existente)
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
        // ... (restante do código existente)
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