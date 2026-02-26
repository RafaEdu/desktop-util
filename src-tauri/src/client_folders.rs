// ── Client Folders Module ───────────────────────────────────────
use std::path::PathBuf;

const NETWORK_BASE_PATH: &str = r"\\SRV-ADDS\Clientes$";

#[derive(serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
    pub extension: String,
}

/// Validates that the requested path is within NETWORK_BASE_PATH.
fn validate_path(requested: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(requested);

    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("Caminho inválido ou inacessível: {}", e))?;

    // Normalize UNC prefix: \\?\UNC\server\share → \\server\share
    let canonical_str = canonical.to_string_lossy().to_string();
    let normalized = if canonical_str.starts_with(r"\\?\UNC\") {
        format!(r"\\{}", &canonical_str[8..])
    } else if canonical_str.starts_with(r"\\?\") {
        canonical_str[4..].to_string()
    } else {
        canonical_str
    };

    let base_lower = NETWORK_BASE_PATH.to_lowercase();
    let norm_lower = normalized.to_lowercase();

    if !norm_lower.starts_with(&base_lower) {
        return Err("Acesso negado: caminho fora do diretório permitido".into());
    }

    Ok(PathBuf::from(normalized))
}

fn format_system_time(time: std::time::SystemTime) -> String {
    let duration = time
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs() as i64;

    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;

    // Simple date calculation from days since epoch
    let mut y = 1970i64;
    let mut remaining_days = days;

    loop {
        let days_in_year = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
            366
        } else {
            365
        };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }

    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];

    let mut m = 0usize;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining_days < md {
            m = i;
            break;
        }
        remaining_days -= md;
    }

    let d = remaining_days + 1;

    format!(
        "{:02}/{:02}/{:04} {:02}:{:02}",
        d,
        m + 1,
        y,
        hours,
        minutes
    )
}

#[tauri::command]
pub fn list_network_folders() -> Result<Vec<String>, String> {
    let base = PathBuf::from(NETWORK_BASE_PATH);

    let entries = std::fs::read_dir(&base)
        .map_err(|e| format!("Falha ao acessar {}: {}", NETWORK_BASE_PATH, e))?;

    let mut folders: Vec<String> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            if entry.file_type().ok()?.is_dir() {
                Some(entry.file_name().to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();

    folders.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(folders)
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let validated = validate_path(&path)?;

    let entries = std::fs::read_dir(&validated)
        .map_err(|e| format!("Falha ao listar diretório: {}", e))?;

    let mut items: Vec<DirEntry> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let metadata = entry.metadata().ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = metadata.is_dir();
            let size = if is_dir { 0 } else { metadata.len() };
            let modified = metadata
                .modified()
                .map(format_system_time)
                .unwrap_or_default();
            let extension = if is_dir {
                String::new()
            } else {
                std::path::Path::new(&name)
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default()
            };

            Some(DirEntry {
                name,
                is_dir,
                size,
                modified,
                extension,
            })
        })
        .collect();

    // Sort: directories first, then alphabetically
    items.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(items)
}

#[tauri::command]
pub fn rename_entry(old_path: String, new_name: String) -> Result<(), String> {
    let validated_old = validate_path(&old_path)?;

    if new_name.contains('\\') || new_name.contains('/') || new_name.contains('\0') {
        return Err("Nome inválido: não pode conter barras ou caracteres nulos".into());
    }

    let parent = validated_old
        .parent()
        .ok_or("Não foi possível determinar o diretório pai")?;
    let new_path = parent.join(&new_name);

    // Validate new path is still within base
    let new_path_str = new_path.to_string_lossy().to_string();
    let base_lower = NETWORK_BASE_PATH.to_lowercase();
    if !new_path_str.to_lowercase().starts_with(&base_lower) {
        return Err("Acesso negado: caminho de destino fora do diretório permitido".into());
    }

    if new_path.exists() {
        return Err(format!("Já existe um item com o nome '{}'", new_name));
    }

    std::fs::rename(&validated_old, &new_path)
        .map_err(|e| format!("Falha ao renomear: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn move_entry(source_path: String, dest_folder: String) -> Result<(), String> {
    let validated_source = validate_path(&source_path)?;
    let validated_dest = validate_path(&dest_folder)?;

    if !validated_dest.is_dir() {
        return Err("Destino não é um diretório válido".into());
    }

    let file_name = validated_source
        .file_name()
        .ok_or("Não foi possível determinar o nome do arquivo")?;
    let dest_path = validated_dest.join(file_name);

    if dest_path.exists() {
        return Err(format!(
            "Já existe um item com o nome '{}' no destino",
            file_name.to_string_lossy()
        ));
    }

    std::fs::rename(&validated_source, &dest_path)
        .map_err(|e| format!("Falha ao mover: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_entry(path: String, is_dir: bool) -> Result<(), String> {
    let validated = validate_path(&path)?;

    if is_dir {
        std::fs::remove_dir_all(&validated)
            .map_err(|e| format!("Falha ao excluir pasta: {}", e))?;
    } else {
        std::fs::remove_file(&validated)
            .map_err(|e| format!("Falha ao excluir arquivo: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    let validated = validate_path(&path)?;

    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &validated.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Falha ao abrir arquivo: {}", e))?;
    }

    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&validated)
            .spawn()
            .map_err(|e| format!("Falha ao abrir arquivo: {}", e))?;
    }

    Ok(())
}
