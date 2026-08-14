#[cfg(windows)]
use serde::Deserialize;

#[cfg(windows)]
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{self, Command},
};

#[cfg(windows)]
const FECHAR_DOMINIO_SCRIPT: &[u8] =
    include_bytes!("../../remote-session-scripts/Fechar-Dominio.ps1");

#[cfg(windows)]
const ENCERRAR_SESSAO_SCRIPT: &[u8] =
    include_bytes!("../../remote-session-scripts/Encerrar-Sessao.ps1");

#[cfg(windows)]
mod deployment_config {
    include!(concat!(env!("OUT_DIR"), "/deployment_config.rs"));
}

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

#[cfg(windows)]
#[derive(Clone, Copy)]
struct RemoteSessionConfig {
    server: &'static str,
    expected_domain: &'static str,
    executable_name: &'static str,
}

#[tauri::command]
pub async fn close_dominio() -> Result<RemoteActionResult, String> {
    run_fixed_script("Fechar-Dominio.ps1").await
}

#[tauri::command]
pub async fn logoff_remote_session() -> Result<RemoteActionResult, String> {
    run_fixed_script("Encerrar-Sessao.ps1").await
}

#[cfg(windows)]
async fn run_fixed_script(script_name: &'static str) -> Result<RemoteActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_fixed_script_blocking(script_name))
        .await
        .map_err(|_| "Falha interna ao executar a ação. Contate o suporte.".to_string())?
}

#[cfg(windows)]
fn run_fixed_script_blocking(script_name: &str) -> Result<RemoteActionResult, String> {
    let config = remote_session_config()?;
    let temporary_script = TemporaryScript::create(script_name)?;
    let powershell_path = windows_system32()
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");

    if !powershell_path.is_file() {
        return Err("O Windows PowerShell não foi encontrado neste computador.".into());
    }

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(powershell_path);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(temporary_script.path())
        .arg("-Server")
        .arg(config.server)
        .arg("-ExpectedDomain")
        .arg(config.expected_domain);

    if script_name == "Fechar-Dominio.ps1" {
        command
            .arg("-ExecutableName")
            .arg(config.executable_name);
    }

    let output = command
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|_| "Não foi possível iniciar a ação remota. Contate o suporte.".to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .ok_or_else(|| {
            // Never forward raw stderr to the WebView. Windows utilities can
            // include usernames, hostnames, paths and operational details.
            "A ação remota não retornou um resultado válido. Contate o suporte.".to_string()
        })?;

    let result: ScriptResult = serde_json::from_str(json_line)
        .map_err(|_| "A ação remota retornou uma resposta inválida. Contate o suporte.".to_string())?;

    Ok(RemoteActionResult {
        success: result.success,
        code: result.code,
        message: result.message,
        affected_processes: result.affected_processes,
        session_id: result.session_id,
    })
}

#[cfg(windows)]
fn remote_session_config() -> Result<RemoteSessionConfig, String> {
    if !deployment_config::REMOTE_SESSION_ENABLED {
        return Err(
            "A recuperação da sessão remota não está configurada nesta compilação.".into(),
        );
    }

    let config = RemoteSessionConfig {
        server: deployment_config::REMOTE_SESSION_SERVER,
        expected_domain: deployment_config::REMOTE_SESSION_EXPECTED_DOMAIN,
        executable_name: deployment_config::REMOTE_SESSION_EXECUTABLE,
    };

    validate_hostish(config.server)?;
    validate_hostish(config.expected_domain)?;
    validate_executable(config.executable_name)?;

    Ok(config)
}

#[cfg(windows)]
fn validate_hostish(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 255
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err("A configuração interna da sessão remota é inválida.".into());
    }

    Ok(())
}

#[cfg(windows)]
fn validate_executable(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 255
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        || !value.to_ascii_lowercase().ends_with(".exe")
        || value.contains("..")
    {
        return Err("A configuração interna da sessão remota é inválida.".into());
    }

    Ok(())
}

#[cfg(windows)]
fn embedded_script(script_name: &str) -> Result<&'static [u8], String> {
    match script_name {
        "Fechar-Dominio.ps1" => Ok(FECHAR_DOMINIO_SCRIPT),
        "Encerrar-Sessao.ps1" => Ok(ENCERRAR_SESSAO_SCRIPT),
        _ => Err("Ação remota inválida.".into()),
    }
}

#[cfg(windows)]
struct TemporaryScript {
    path: PathBuf,
    directory: PathBuf,
}

#[cfg(windows)]
impl TemporaryScript {
    fn create(script_name: &str) -> Result<Self, String> {
        let content = embedded_script(script_name)?;
        let base_directory = std::env::temp_dir()
            .join("AdcontecUtil")
            .join("remote-session");

        fs::create_dir_all(&base_directory)
            .map_err(|_| "Não foi possível preparar a ação de recuperação.".to_string())?;

        for _ in 0..8 {
            let nonce = rand::random::<u64>();
            let directory = base_directory.join(format!("{}-{nonce:016x}", process::id()));

            match fs::create_dir(&directory) {
                Ok(()) => {
                    let path = directory.join(script_name);
                    let write_result = write_embedded_script(&path, content);
                    if let Err(error) = write_result {
                        let _ = fs::remove_file(&path);
                        let _ = fs::remove_dir(&directory);
                        return Err(error);
                    }
                    return Ok(Self { path, directory });
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(
                        "Não foi possível criar a área temporária da recuperação.".to_string(),
                    );
                }
            }
        }

        Err("Não foi possível criar uma área temporária exclusiva para a recuperação.".into())
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(windows)]
impl Drop for TemporaryScript {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        let _ = fs::remove_dir(&self.directory);
    }
}

#[cfg(windows)]
fn write_embedded_script(path: &Path, content: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "Não foi possível criar o script temporário.".to_string())?;

    file.write_all(content)
        .map_err(|_| "Não foi possível gravar o script temporário.".to_string())?;
    file.flush()
        .map_err(|_| "Não foi possível finalizar o script temporário.".to_string())?;

    Ok(())
}

#[cfg(windows)]
fn windows_system32() -> PathBuf {
    std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
}

#[cfg(not(windows))]
async fn run_fixed_script(_script_name: &'static str) -> Result<RemoteActionResult, String> {
    Err("A recuperação da sessão do Domínio está disponível apenas no Windows.".into())
}
