use std::path::Path;

#[cfg(windows)]
use std::path::PathBuf;

const RDP_SHARE: &str = r"\\SRV-ADDS\Documentos$\RDP\SRV-IBM";
const CLOSE_DOMINIO_RDP: &str = "ADContec_Fechar_Dominio.rdp";
const LOGOFF_RDP: &str = "ADContec_Encerrar_Sessao.rdp";

#[tauri::command]
pub fn launch_close_dominio_remoteapp() -> Result<(), String> {
    launch_remote_app(CLOSE_DOMINIO_RDP)
}

#[tauri::command]
pub fn launch_logoff_remoteapp() -> Result<(), String> {
    launch_remote_app(LOGOFF_RDP)
}

#[cfg(windows)]
fn launch_remote_app(file_name: &str) -> Result<(), String> {
    let rdp_path = Path::new(RDP_SHARE).join(file_name);

    if !rdp_path.is_file() {
        return Err(format!(
            "O arquivo RemoteApp não foi encontrado em {}. Verifique a conexão com o SRV-ADDS ou contate o suporte.",
            rdp_path.display()
        ));
    }

    let mstsc_path = mstsc_path();
    if !mstsc_path.is_file() {
        return Err("O cliente de Área de Trabalho Remota (mstsc.exe) não foi encontrado neste computador.".into());
    }

    std::process::Command::new(&mstsc_path)
        .arg(&rdp_path)
        .spawn()
        .map_err(|error| format!("Não foi possível abrir o RemoteApp: {}", error))?;

    Ok(())
}

#[cfg(windows)]
fn mstsc_path() -> PathBuf {
    std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32")
        .join("mstsc.exe")
}

#[cfg(not(windows))]
fn launch_remote_app(_file_name: &str) -> Result<(), String> {
    Err("A recuperação da sessão do Domínio está disponível apenas no Windows.".into())
}
