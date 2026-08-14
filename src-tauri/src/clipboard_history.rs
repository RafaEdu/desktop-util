use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, VecDeque},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

const HISTORY_EVENT: &str = "clipboard-history-changed";
const SETTINGS_FILE: &str = "clipboard-settings.json";
const HISTORY_FILE: &str = "clipboard-history.dat";
const HISTORY_FILE_TMP: &str = "clipboard-history.dat.tmp";
const HISTORY_VERSION: u8 = 1;
const MAX_HISTORY_ITEMS: usize = 50;
const DEFAULT_RETENTION_SECONDS: u64 = 8 * 60 * 60;
const ALLOWED_RETENTION_SECONDS: [u64; 4] = [60 * 60, 8 * 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60];

#[inline]
fn debug_safe_error(code: &str) {
    #[cfg(debug_assertions)]
    eprintln!("[{code}]");
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardMode {
    Disabled,
    Memory,
    Persistent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardSettings {
    pub mode: ClipboardMode,
    pub retention_seconds: u64,
}

impl Default for ClipboardSettings {
    fn default() -> Self {
        Self {
            mode: ClipboardMode::Disabled,
            retention_seconds: DEFAULT_RETENTION_SECONDS,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardSensitivity {
    Normal,
    Personal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: String,
    pub text: String,
    pub captured_at: i64,
    pub expires_at: i64,
    pub sensitivity: ClipboardSensitivity,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipboardSnapshot {
    pub settings: ClipboardSettings,
    pub history: Vec<ClipboardItem>,
    pub blocked_count_session: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredHistory {
    version: u8,
    items: Vec<ClipboardItem>,
}

#[derive(Clone)]
struct ClipboardState {
    settings: ClipboardSettings,
    history: VecDeque<ClipboardItem>,
    blocked_count_session: u64,
    last_seen_fingerprint: Option<u64>,
}

pub struct ClipboardService {
    state: Mutex<ClipboardState>,
    settings_path: PathBuf,
    history_path: PathBuf,
    history_tmp_path: PathBuf,
}

impl ClipboardService {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let base_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("Falha ao localizar diretório local do aplicativo: {e}"))?;

        fs::create_dir_all(&base_dir)
            .map_err(|e| format!("Falha ao preparar diretório do histórico: {e}"))?;

        let settings_path = base_dir.join(SETTINGS_FILE);
        let history_path = base_dir.join(HISTORY_FILE);
        let history_tmp_path = base_dir.join(HISTORY_FILE_TMP);

        let settings = load_settings(&settings_path).unwrap_or_default();
        let now = now_millis();

        let mut history = if settings.mode == ClipboardMode::Persistent {
            match load_protected_history(&history_path) {
                Ok(items) => VecDeque::from(items),
                Err(_) => {
                    let _ = fs::remove_file(&history_path);
                    VecDeque::new()
                }
            }
        } else {
            let _ = fs::remove_file(&history_path);
            let _ = fs::remove_file(&history_tmp_path);
            VecDeque::new()
        };

        normalize_history(&mut history, &settings, now);

        let service = Self {
            state: Mutex::new(ClipboardState {
                settings,
                history,
                blocked_count_session: 0,
                last_seen_fingerprint: None,
            }),
            settings_path,
            history_path,
            history_tmp_path,
        };

        if service.persist_if_needed().is_err() {
            debug_safe_error("CLIPBOARD_STARTUP_PERSIST_FAILED");
        }   
        Ok(service)
    }

    fn snapshot(&self) -> ClipboardSnapshot {
        let now = now_millis();
        let (snapshot, changed, persistent) = {
            let mut state = self.state.lock().unwrap();
            let before = state.history.len();
            purge_expired(&mut state.history, now);
            let changed = before != state.history.len();

            (
                ClipboardSnapshot {
                    settings: state.settings.clone(),
                    history: state.history.iter().cloned().collect(),
                    blocked_count_session: state.blocked_count_session,
                },
                changed,
                state.settings.mode == ClipboardMode::Persistent,
            )
        };

        if changed && persistent {
            if self.persist_if_needed().is_err() {
                debug_safe_error("CLIPBOARD_EXPIRY_PERSIST_FAILED");
            }
        }

        snapshot
    }

    fn is_enabled(&self) -> bool {
        self.state.lock().unwrap().settings.mode != ClipboardMode::Disabled
    }

    fn prime_last_seen(&self, fingerprint: Option<u64>) {
        self.state.lock().unwrap().last_seen_fingerprint = fingerprint;
    }

    fn process_text(&self, app: &AppHandle, text: String) {
        if text.trim().is_empty() {
            return;
        }

        let fingerprint = fingerprint(&text);
        let is_secret = is_potential_secret(&text);
        let sensitivity = if is_secret {
            ClipboardSensitivity::Normal
        } else {
            classify_non_secret(&text)
        };
        let now = now_millis();

        let (changed, persistent) = {
            let mut state = self.state.lock().unwrap();

            if state.settings.mode == ClipboardMode::Disabled {
                return;
            }

            if state.last_seen_fingerprint == Some(fingerprint) {
                return;
            }
            state.last_seen_fingerprint = Some(fingerprint);

            purge_expired(&mut state.history, now);

            if is_secret {
                state.blocked_count_session = state.blocked_count_session.saturating_add(1);
                (true, false)
            } else {
                if state.history.front().map(|item| item.text.as_str()) == Some(text.as_str()) {
                    return;
                }

                let retention_ms = retention_millis(&state.settings);
                state.history.push_front(ClipboardItem {
                    id: make_item_id(now, fingerprint),
                    text,
                    captured_at: now,
                    expires_at: now.saturating_add(retention_ms),
                    sensitivity,
                });

                while state.history.len() > MAX_HISTORY_ITEMS {
                    state.history.pop_back();
                }

                (
                    true,
                    state.settings.mode == ClipboardMode::Persistent,
                )
            }
        };

        if persistent {
            if self.persist_if_needed().is_err() {
                debug_safe_error("CLIPBOARD_PERSIST_FAILED");
            }
        }

        if changed {
            let _ = app.emit(HISTORY_EVENT, ());
        }
    }

    fn clear(&self, current_fingerprint: Option<u64>) -> Result<(), String> {
        {
            let mut state = self.state.lock().unwrap();
            state.history.clear();
            state.last_seen_fingerprint = current_fingerprint;
        }

        remove_if_exists(&self.history_path)
            .map_err(|e| format!("Falha ao remover histórico protegido: {e}"))?;
        remove_if_exists(&self.history_tmp_path)
            .map_err(|e| format!("Falha ao remover arquivo temporário do histórico: {e}"))?;
        Ok(())
    }

    fn update_settings(
        &self,
        app: &AppHandle,
        new_settings: ClipboardSettings,
    ) -> Result<ClipboardSnapshot, String> {
        validate_settings(&new_settings)?;

        let old_state = self.state.lock().unwrap().clone();
        let old_settings = old_state.settings.clone();
        let enabling_from_disabled = old_settings.mode == ClipboardMode::Disabled
            && new_settings.mode != ClipboardMode::Disabled;

        // A preferência contém apenas modo e retenção; nenhum conteúdo do clipboard.
        // Ela é salva antes da mutação em memória para que uma falha não gere estado ambíguo.
        save_settings(&self.settings_path, &new_settings)?;

        let baseline_fingerprint = if enabling_from_disabled {
            app.clipboard().read_text().ok().map(|text| fingerprint(&text))
        } else {
            None
        };

        {
            let mut state = self.state.lock().unwrap();
            state.settings = new_settings.clone();

            if enabling_from_disabled {
                // Não captura retroativamente o conteúdo que já estava no clipboard
                // antes do opt-in.
                state.last_seen_fingerprint = baseline_fingerprint;
            }

            if new_settings.mode == ClipboardMode::Disabled {
                state.history.clear();
                state.last_seen_fingerprint = None;
            } else {
                normalize_history(&mut state.history, &new_settings, now_millis());
            }
        }

        let apply_result = match new_settings.mode {
            ClipboardMode::Persistent => self.persist_if_needed(),
            ClipboardMode::Memory | ClipboardMode::Disabled => remove_if_exists(&self.history_path)
                .map_err(|e| format!("Falha ao remover histórico protegido: {e}"))
                .and_then(|_| {
                    remove_if_exists(&self.history_tmp_path).map_err(|e| {
                        format!("Falha ao remover arquivo temporário do histórico: {e}")
                    })
                }),
        };

        if let Err(err) = apply_result {
            // Não apresentar ao usuário um modo de privacidade que não foi efetivado.
            *self.state.lock().unwrap() = old_state;
            let _ = save_settings(&self.settings_path, &old_settings);
            return Err(err);
        }

        let snapshot = self.snapshot();
        let _ = app.emit(HISTORY_EVENT, ());
        Ok(snapshot)
    }

    fn copy_item(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        let text = {
            let mut state = self.state.lock().unwrap();
            purge_expired(&mut state.history, now_millis());
            state
                .history
                .iter()
                .find(|item| item.id == id)
                .map(|item| item.text.clone())
                .ok_or_else(|| "Item não encontrado ou já expirado".to_string())?
        };

        app.clipboard()
            .write_text(text)
            .map_err(|e| format!("Falha ao copiar item: {e}"))
    }

    fn purge_and_persist(&self) -> bool {
        let changed = {
            let mut state = self.state.lock().unwrap();
            let before = state.history.len();
            purge_expired(&mut state.history, now_millis());
            before != state.history.len()
        };

        if changed {
            if let Err(_err) = self.persist_if_needed() {
                debug_safe_error("CLIPBOARD_PURGE_PERSIST_FAILED");
            }
        }

        changed
    }

    fn persist_if_needed(&self) -> Result<(), String> {
        let items = {
            let state = self.state.lock().unwrap();
            if state.settings.mode != ClipboardMode::Persistent {
                return Ok(());
            }
            state.history.iter().cloned().collect::<Vec<_>>()
        };

        if items.is_empty() {
            remove_if_exists(&self.history_path)
                .map_err(|e| format!("Falha ao remover histórico protegido vazio: {e}"))?;
            remove_if_exists(&self.history_tmp_path)
                .map_err(|e| format!("Falha ao remover temporário protegido vazio: {e}"))?;
            return Ok(());
        }

        save_protected_history(&self.history_path, &self.history_tmp_path, &items)
    }
}

#[tauri::command]
pub fn clipboard_get_snapshot(service: State<'_, ClipboardService>) -> ClipboardSnapshot {
    service.snapshot()
}

#[tauri::command]
pub fn clipboard_set_settings(
    app: AppHandle,
    service: State<'_, ClipboardService>,
    settings: ClipboardSettings,
) -> Result<ClipboardSnapshot, String> {
    service.update_settings(&app, settings)
}

#[tauri::command]
pub fn clipboard_clear_history(
    app: AppHandle,
    service: State<'_, ClipboardService>,
) -> Result<ClipboardSnapshot, String> {
    let current_fingerprint = if service.is_enabled() {
        app.clipboard().read_text().ok().map(|text| fingerprint(&text))
    } else {
        None
    };
    service.clear(current_fingerprint)?;
    let snapshot = service.snapshot();
    let _ = app.emit(HISTORY_EVENT, ());
    Ok(snapshot)
}

#[tauri::command]
pub fn clipboard_copy_item(
    app: AppHandle,
    service: State<'_, ClipboardService>,
    id: String,
) -> Result<(), String> {
    service.copy_item(&app, &id)
}

pub fn start_monitor(app: AppHandle) {
    thread::spawn(move || {
        // Não captura retroativamente o conteúdo que já estava no clipboard
        // quando o aplicativo iniciou.
        if let Some(service) = app.try_state::<ClipboardService>() {
            if service.is_enabled() {
                let baseline = app.clipboard().read_text().ok().map(|text| fingerprint(&text));
                service.prime_last_seen(baseline);
            }
        }

        let mut maintenance_ticks: u16 = 0;

        loop {
            thread::sleep(Duration::from_secs(1));

            let Some(service) = app.try_state::<ClipboardService>() else {
                break;
            };

            if service.is_enabled() {
                if let Ok(text) = app.clipboard().read_text() {
                    service.process_text(&app, text);
                }

                maintenance_ticks = maintenance_ticks.wrapping_add(1);
                if maintenance_ticks >= 60 {
                    maintenance_ticks = 0;
                    if service.purge_and_persist() {
                        let _ = app.emit(HISTORY_EVENT, ());
                    }
                }
            } else {
                maintenance_ticks = 0;
            }
        }
    });
}

fn validate_settings(settings: &ClipboardSettings) -> Result<(), String> {
    if !ALLOWED_RETENTION_SECONDS.contains(&settings.retention_seconds) {
        return Err("Tempo de retenção inválido".into());
    }
    Ok(())
}

fn load_settings(path: &Path) -> Option<ClipboardSettings> {
    let bytes = fs::read(path).ok()?;
    let settings: ClipboardSettings = serde_json::from_slice(&bytes).ok()?;
    validate_settings(&settings).ok()?;
    Some(settings)
}

fn save_settings(path: &Path, settings: &ClipboardSettings) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(settings)
        .map_err(|e| format!("Falha ao serializar configurações do clipboard: {e}"))?;
    fs::write(path, bytes)
        .map_err(|e| format!("Falha ao salvar configurações do clipboard: {e}"))
}

fn normalize_history(
    history: &mut VecDeque<ClipboardItem>,
    settings: &ClipboardSettings,
    now: i64,
) {
    let retention_ms = retention_millis(settings);

    for item in history.iter_mut() {
        item.expires_at = item.captured_at.saturating_add(retention_ms);
    }

    history.retain(|item| {
        !item.text.trim().is_empty()
            && item.expires_at > now
            && !is_potential_secret(&item.text)
    });

    history.truncate(MAX_HISTORY_ITEMS);
}

fn purge_expired(history: &mut VecDeque<ClipboardItem>, now: i64) {
    history.retain(|item| item.expires_at > now);
}

fn retention_millis(settings: &ClipboardSettings) -> i64 {
    let seconds = settings.retention_seconds.min(i64::MAX as u64 / 1_000);
    (seconds as i64) * 1_000
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn fingerprint(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

fn make_item_id(now: i64, content_fingerprint: u64) -> String {
    format!("{now:x}-{content_fingerprint:016x}")
}

fn classify_non_secret(text: &str) -> ClipboardSensitivity {
    if looks_like_personal_document(text) {
        ClipboardSensitivity::Personal
    } else {
        ClipboardSensitivity::Normal
    }
}

fn looks_like_personal_document(text: &str) -> bool {
    let digits: String = text.chars().filter(|c| c.is_ascii_digit()).collect();
    matches!(digits.len(), 11 | 14 | 44)
}

fn is_potential_secret(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }

    let lower = trimmed.to_ascii_lowercase();

    if lower.contains("-----begin private key-----")
        || lower.contains("-----begin rsa private key-----")
        || lower.contains("-----begin ec private key-----")
        || lower.contains("-----begin openssh private key-----")
    {
        return true;
    }

    if lower.starts_with("bearer ") || lower.contains("authorization: bearer ") {
        return true;
    }

    const SECRET_LABELS: [&str; 13] = [
        "password",
        "passwd",
        "senha",
        "api_key",
        "api-key",
        "apikey",
        "client_secret",
        "client-secret",
        "access_token",
        "refresh_token",
        "secret_key",
        "secret-key",
        "token",
    ];

    if SECRET_LABELS
        .iter()
        .any(|label| contains_assigned_secret(&lower, label))
    {
        return true;
    }

    if looks_like_jwt(trimmed)
        || contains_known_token_prefix(trimmed)
        || looks_like_connection_uri_with_password(trimmed)
    {
        return true;
    }

    false
}

fn contains_assigned_secret(text: &str, label: &str) -> bool {
    let mut search_from = 0;

    while let Some(relative) = text[search_from..].find(label) {
        let start = search_from + relative;
        let after_label = start + label.len();
        let rest = &text[after_label..];
        let mut rest = rest.trim_start();

        // Suporta também JSON: {"password": "..."}.
        if matches!(rest.chars().next(), Some('"' | '\'')) {
            rest = rest[1..].trim_start();
        }

        if let Some(separator) = rest.chars().next() {
            if separator == ':' || separator == '=' {
                let value = rest[separator.len_utf8()..].trim_start();
                if !value.is_empty() {
                    return true;
                }
            }
        }

        search_from = after_label;
        if search_from >= text.len() {
            break;
        }
    }

    false
}

fn looks_like_jwt(text: &str) -> bool {
    let mut parts = text.split('.');
    let Some(header) = parts.next() else {
        return false;
    };
    let Some(payload) = parts.next() else {
        return false;
    };
    let Some(signature) = parts.next() else {
        return false;
    };

    if parts.next().is_some() || !header.starts_with("eyJ") {
        return false;
    }

    [header, payload, signature]
        .iter()
        .all(|part| part.len() >= 8 && part.chars().all(is_base64url_char))
}

fn is_base64url_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

fn contains_known_token_prefix(text: &str) -> bool {
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| {
            matches!(c, '"' | '\'' | ',' | ';' | '(' | ')' | '[' | ']' | '{' | '}')
        });

        let lower = cleaned.to_ascii_lowercase();

        if (lower.starts_with("ghp_")
            || lower.starts_with("gho_")
            || lower.starts_with("ghs_")
            || lower.starts_with("ghr_")
            || lower.starts_with("github_pat_")
            || lower.starts_with("xoxb-")
            || lower.starts_with("xoxp-")
            || lower.starts_with("sk-"))
            && cleaned.len() >= 20
        {
            return true;
        }

        if cleaned.len() == 20
            && cleaned.starts_with("AKIA")
            && cleaned.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        {
            return true;
        }
    }

    false
}

fn looks_like_connection_uri_with_password(text: &str) -> bool {
    const SCHEMES: [&str; 7] = [
        "postgres://",
        "postgresql://",
        "mysql://",
        "mariadb://",
        "mongodb://",
        "redis://",
        "amqp://",
    ];

    let lower = text.to_ascii_lowercase();

    for scheme in SCHEMES {
        if let Some(start) = lower.find(scheme) {
            let authority = &text[start + scheme.len()..];
            let authority = authority.split('/').next().unwrap_or(authority);

            if let Some(at_index) = authority.rfind('@') {
                let credentials = &authority[..at_index];
                if credentials.contains(':') {
                    return true;
                }
            }
        }
    }

    false
}

fn save_protected_history(
    path: &Path,
    tmp_path: &Path,
    items: &[ClipboardItem],
) -> Result<(), String> {
    let stored = StoredHistory {
        version: HISTORY_VERSION,
        items: items.to_vec(),
    };

    let plaintext = serde_json::to_vec(&stored)
        .map_err(|e| format!("Falha ao serializar histórico: {e}"))?;
    let protected = protect_current_user(&plaintext)?;

    fs::write(tmp_path, protected)
        .map_err(|e| format!("Falha ao gravar histórico temporário: {e}"))?;

    match fs::rename(tmp_path, path) {
        Ok(()) => Ok(()),
        Err(first_err) => {
            if path.exists() {
                fs::remove_file(path)
                    .map_err(|e| format!("Falha ao substituir histórico protegido: {e}"))?;
                fs::rename(tmp_path, path)
                    .map_err(|e| format!("Falha ao concluir gravação do histórico: {e}"))
            } else {
                Err(format!("Falha ao mover histórico protegido: {first_err}"))
            }
        }
    }
}

fn load_protected_history(path: &Path) -> Result<Vec<ClipboardItem>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let protected = fs::read(path).map_err(|e| format!("Falha ao ler histórico protegido: {e}"))?;
    let plaintext = unprotect_current_user(&protected)?;
    let stored: StoredHistory = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("Histórico protegido inválido: {e}"))?;

    if stored.version != HISTORY_VERSION {
        return Err("Versão do histórico protegido não suportada".into());
    }

    Ok(stored.items)
}

fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

#[cfg(windows)]
fn protect_current_user(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, ptr, slice};
    use windows_sys::Win32::{
        Foundation::{GetLastError, LocalFree},
        Security::Cryptography::{
            CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(data.len())
            .map_err(|_| "Conteúdo grande demais para DPAPI".to_string())?,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &mut input,
            ptr::null(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };

    if ok == 0 {
        return Err(format!("DPAPI/CryptProtectData falhou: {}", unsafe {
            GetLastError()
        }));
    }

    if output.pbData.is_null() {
        return Err("DPAPI retornou um buffer protegido vazio".into());
    }

    let result = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(output.pbData as *mut c_void);
    }
    Ok(result)
}

#[cfg(windows)]
fn unprotect_current_user(data: &[u8]) -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, ptr, slice};
    use windows_sys::Win32::{
        Foundation::{GetLastError, LocalFree},
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(data.len())
            .map_err(|_| "Conteúdo protegido grande demais para DPAPI".to_string())?,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };

    if ok == 0 {
        return Err(format!("DPAPI/CryptUnprotectData falhou: {}", unsafe {
            GetLastError()
        }));
    }

    if output.pbData.is_null() {
        return Err("DPAPI retornou um buffer descriptografado vazio".into());
    }

    let result = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(output.pbData as *mut c_void);
    }
    Ok(result)
}

#[cfg(not(windows))]
fn protect_current_user(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Persistência protegida do clipboard está disponível apenas no Windows".into())
}

#[cfg(not(windows))]
fn unprotect_current_user(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Persistência protegida do clipboard está disponível apenas no Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_high_confidence_secrets() {
        let samples = [
            "senha: MinhaSenha123",
            "password=super-secret",
            r#"{"token":"abc12345678901234567890"}"#,
            "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
            "-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----",
            "ghp_123456789012345678901234567890123456",
            "postgres://admin:secret@server.local/database",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
        ];

        for sample in samples {
            assert!(is_potential_secret(sample), "deveria bloquear: {sample}");
        }
    }

    #[test]
    fn does_not_block_common_accounting_content() {
        let samples = [
            "94.684.818/0001-14",
            "123.456.789-09",
            "43260894684818000114550010000000011000000001",
            "1550038807",
            "RS051601",
            "Cliente solicitou retorno amanhã às 10h",
            "CFOP 5409 / CST 060 / acumulador 2043",
        ];

        for sample in samples {
            assert!(!is_potential_secret(sample), "não deveria bloquear: {sample}");
        }
    }

    #[test]
    fn classifies_document_numbers_as_personal_without_blocking() {
        assert_eq!(
            classify_non_secret("94.684.818/0001-14"),
            ClipboardSensitivity::Personal
        );
        assert_eq!(
            classify_non_secret("123.456.789-09"),
            ClipboardSensitivity::Personal
        );
        assert_eq!(
            classify_non_secret("43260894684818000114550010000000011000000001"),
            ClipboardSensitivity::Personal
        );
    }

    #[test]
    fn retention_recalculates_and_removes_expired_items() {
        let settings = ClipboardSettings {
            mode: ClipboardMode::Memory,
            retention_seconds: 60 * 60,
        };
        let now = 10_000_000_i64;
        let mut history = VecDeque::from(vec![
            ClipboardItem {
                id: "old".into(),
                text: "conteudo antigo".into(),
                captured_at: now - (2 * 60 * 60 * 1_000),
                expires_at: i64::MAX,
                sensitivity: ClipboardSensitivity::Normal,
            },
            ClipboardItem {
                id: "new".into(),
                text: "conteudo recente".into(),
                captured_at: now - 1_000,
                expires_at: 0,
                sensitivity: ClipboardSensitivity::Normal,
            },
        ]);

        normalize_history(&mut history, &settings, now);

        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "new");
        assert_eq!(history[0].expires_at, now - 1_000 + 60 * 60 * 1_000);
    }

    #[test]
    fn normalization_removes_a_secret_even_if_it_exists_in_old_storage() {
        let settings = ClipboardSettings {
            mode: ClipboardMode::Persistent,
            retention_seconds: DEFAULT_RETENTION_SECONDS,
        };
        let now = now_millis();
        let mut history = VecDeque::from(vec![ClipboardItem {
            id: "legacy-secret".into(),
            text: "password=ShouldNotSurvive".into(),
            captured_at: now,
            expires_at: i64::MAX,
            sensitivity: ClipboardSensitivity::Normal,
        }]);

        normalize_history(&mut history, &settings, now);
        assert!(history.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_round_trip_uses_current_user_context() {
        let plain = b"SEC-002 DPAPI round trip";
        let protected = protect_current_user(plain).expect("deveria proteger");
        assert_ne!(protected, plain);

        let restored = unprotect_current_user(&protected).expect("deveria descriptografar");
        assert_eq!(restored, plain);
    }
}
