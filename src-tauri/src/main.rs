// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::time::{SystemTime, Duration};

fn main() {
    // Limpeza de arquivos temporários ao iniciar
    if let Ok(temp_dir) = env::temp_dir().canonicalize() {
        clean_old_files(&temp_dir);
    }

    adcontec_util_lib::run()
}

fn clean_old_files(temp_dir: &std::path::Path) {
    let output_prefix = "danfe_";
    
    if let Ok(entries) = fs::read_dir(temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                if filename.starts_with(output_prefix) && (filename.ends_with(".html") || filename.ends_with(".xml")) {
                    if let Ok(metadata) = fs::metadata(&path) {
                        if let Ok(modified) = metadata.modified() {
                            if let Ok(age) = SystemTime::now().duration_since(modified) {
                                if age > Duration::from_secs(86400) {
                                    let _ = fs::remove_file(path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}