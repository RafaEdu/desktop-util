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
        .map_err(|error| format!("Falha interna ao executar a ação: {error}"))?
}

#[cfg(windows)]
fn run_fixed_script_blocking(script_name: &str) -> Result<RemoteActionResult, String> {
    let temporary_script = TemporaryScript::create(script_name)?;
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
        .arg(temporary_script.path())
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

        fs::create_dir_all(&base_directory).map_err(|error| {
            format!("Não foi possível preparar a ação de recuperação: {error}")
        })?;

        for _ in 0..8 {
            let nonce = rand::random::<u64>();
            let directory = base_directory.join(format!(
                "{}-{nonce:016x}",
                process::id()
            ));

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
                Err(error) => {
                    return Err(format!(
                        "Não foi possível criar a área temporária da recuperação: {error}"
                    ));
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
        .map_err(|error| format!("Não foi possível criar o script temporário: {error}"))?;

    file.write_all(content)
        .map_err(|error| format!("Não foi possível gravar o script temporário: {error}"))?;
    file.flush()
        .map_err(|error| format!("Não foi possível finalizar o script temporário: {error}"))?;

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
