#[cfg(windows)]
use serde::Deserialize;

#[cfg(windows)]
use std::{
    os::windows::process::CommandExt,
    path::PathBuf,
    process::Command,
};

#[cfg(windows)]
use tauri::Manager;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteActionResult {
    success: bool,
    code: String,
    message: String,
    affected_processes: Option<u32>,
    session_id: Option<u32>,
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptResult {
    success: bool,
    code: String,
    message: String,
    affected_processes: Option<u32>,
    session_id: Option<u32>,
}

#[tauri::command]
pub async fn close_dominio(app: tauri::AppHandle) -> Result<RemoteActionResult, String> {
    run_fixed_script(app, "Fechar-Dominio.ps1").await
}

#[tauri::command]
pub async fn logoff_remote_session(app: tauri::AppHandle) -> Result<RemoteActionResult, String> {
    run_fixed_script(app, "Encerrar-Sessao.ps1").await
}

#[cfg(windows)]
async fn run_fixed_script(
    app: tauri::AppHandle,
    script_name: &'static str,
) -> Result<RemoteActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_fixed_script_blocking(&app, script_name))
        .await
        .map_err(|error| format!("Falha interna ao executar a ação: {error}"))?
}

#[cfg(windows)]
fn run_fixed_script_blocking(
    app: &tauri::AppHandle,
    script_name: &str,
) -> Result<RemoteActionResult, String> {
    let script_path = resolve_script_path(app, script_name)?;
    let powershell_path = windows_system32()
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");

    if !powershell_path.is_file() {
        return Err("O Windows PowerShell não foi encontrado neste computador.".into());
    }

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = Command::new(powershell_path)
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script_path)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Não foi possível executar a ação no SRV-IBM: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .ok_or_else(|| {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.trim().is_empty() {
                "O script não retornou um resultado válido. Contate o suporte.".to_string()
            } else {
                format!("Falha ao executar o script: {}", stderr.trim())
            }
        })?;

    let result: ScriptResult = serde_json::from_str(json_line)
        .map_err(|_| "O script retornou uma resposta inválida. Contate o suporte.".to_string())?;

    Ok(RemoteActionResult {
        success: result.success,
        code: result.code,
        message: result.message,
        affected_processes: result.affected_processes,
        session_id: result.session_id,
    })
}

#[cfg(windows)]
fn resolve_script_path(app: &tauri::AppHandle, script_name: &str) -> Result<PathBuf, String> {
    if !matches!(script_name, "Fechar-Dominio.ps1" | "Encerrar-Sessao.ps1") {
        return Err("Ação remota inválida.".into());
    }

    let installed_path = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Não foi possível localizar os recursos do aplicativo: {error}"))?
        .join("remote-session-scripts")
        .join(script_name);

    if installed_path.is_file() {
        return Ok(installed_path);
    }

    #[cfg(debug_assertions)]
    {
        let development_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")))
            .join("remote-session-scripts")
            .join(script_name);
        if development_path.is_file() {
            return Ok(development_path);
        }
    }

    Err(format!(
        "O arquivo interno {script_name} não foi encontrado. Reinstale o Adcontec Útil."
    ))
}

#[cfg(windows)]
fn windows_system32() -> PathBuf {
    std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
}

#[cfg(not(windows))]
async fn run_fixed_script(
    _app: tauri::AppHandle,
    _script_name: &'static str,
) -> Result<RemoteActionResult, String> {
    Err("A recuperação da sessão do Domínio está disponível apenas no Windows.".into())
}
