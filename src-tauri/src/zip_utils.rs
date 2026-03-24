use std::fs::File;
use std::io::{self, BufReader};
use std::path::Path;
use zip::{write::SimpleFileOptions, ZipWriter};

#[tauri::command]
pub fn create_zip(file_paths: Vec<String>, output_path: String) -> Result<String, String> {
    if file_paths.is_empty() {
        return Err("Nenhum arquivo selecionado.".into());
    }

    let output_file =
        File::create(&output_path).map_err(|e| format!("Falha ao criar arquivo ZIP: {}", e))?;

    let mut zip = ZipWriter::new(output_file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for path_str in &file_paths {
        let path = Path::new(path_str);

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| format!("Nome de arquivo inválido: {}", path_str))?;

        let file = File::open(path).map_err(|e| format!("Falha ao abrir '{}': {}", path_str, e))?;
        let mut reader = BufReader::new(file);

        zip.start_file(file_name, options)
            .map_err(|e| format!("Falha ao adicionar '{}' ao ZIP: {}", file_name, e))?;

        io::copy(&mut reader, &mut zip)
            .map_err(|e| format!("Falha ao escrever '{}' no ZIP: {}", file_name, e))?;
    }

    zip.finish()
        .map_err(|e| format!("Falha ao finalizar arquivo ZIP: {}", e))?;

    Ok(output_path)
}
