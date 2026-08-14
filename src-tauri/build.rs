use std::{
    collections::HashMap,
    env,
    fs,
    path::{Path, PathBuf},
};

const ENABLED_KEY: &str = "REMOTE_SESSION_ENABLED";
const SERVER_KEY: &str = "REMOTE_SESSION_SERVER";
const DOMAIN_KEY: &str = "REMOTE_SESSION_EXPECTED_DOMAIN";
const EXECUTABLE_KEY: &str = "REMOTE_SESSION_EXECUTABLE";
const CONFIG_KEYS: [&str; 4] = [ENABLED_KEY, SERVER_KEY, DOMAIN_KEY, EXECUTABLE_KEY];

fn main() {
    let manifest_dir = PathBuf::from(
        env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR não foi definido pelo Cargo"),
    );
    let repository_root = manifest_dir
        .parent()
        .expect("src-tauri deve estar dentro da raiz do repositório");
    let local_config_path = repository_root
        .join("deployment")
        .join("config.local.env");

    println!("cargo:rerun-if-changed={}", local_config_path.display());
    for key in CONFIG_KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }

    let mut values = if local_config_path.is_file() {
        parse_env_file(&local_config_path).unwrap_or_else(|error| panic!("{error}"))
    } else {
        HashMap::new()
    };

    // Environment variables override the local deployment file. This keeps the
    // same source compatible with a future CI build without changing runtime.
    for key in CONFIG_KEYS {
        if let Ok(value) = env::var(key) {
            values.insert(key.to_string(), value);
        }
    }

    let enabled = parse_bool(values.get(ENABLED_KEY).map(String::as_str).unwrap_or("false"))
        .unwrap_or_else(|error| panic!("{error}"));

    let server = value_or_empty(&values, SERVER_KEY);
    let expected_domain = value_or_empty(&values, DOMAIN_KEY);
    let executable = value_or_empty(&values, EXECUTABLE_KEY);

    if enabled {
        validate_hostish(&server, SERVER_KEY).unwrap_or_else(|error| panic!("{error}"));
        validate_hostish(&expected_domain, DOMAIN_KEY)
            .unwrap_or_else(|error| panic!("{error}"));
        validate_executable(&executable).unwrap_or_else(|error| panic!("{error}"));
    }

    write_generated_config(enabled, &server, &expected_domain, &executable)
        .unwrap_or_else(|error| panic!("{error}"));

    tauri_build::build()
}

fn parse_env_file(path: &Path) -> Result<HashMap<String, String>, String> {
    let content = fs::read_to_string(path)
        .map_err(|_| "Não foi possível ler deployment/config.local.env".to_string())?;
    let mut values = HashMap::new();

    for (index, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let Some((raw_key, raw_value)) = line.split_once('=') else {
            return Err(format!(
                "Linha {} inválida em deployment/config.local.env",
                index + 1
            ));
        };

        let key = raw_key.trim();
        if !CONFIG_KEYS.contains(&key) {
            return Err(format!(
                "Chave não reconhecida em deployment/config.local.env: {key}"
            ));
        }

        values.insert(key.to_string(), strip_optional_quotes(raw_value.trim()));
    }

    Ok(values)
}

fn strip_optional_quotes(value: &str) -> String {
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }

    value.to_string()
}

fn parse_bool(value: &str) -> Result<bool, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" | "" => Ok(false),
        _ => Err(format!(
            "{ENABLED_KEY} deve ser true/false, 1/0, yes/no ou on/off"
        )),
    }
}

fn value_or_empty(values: &HashMap<String, String>, key: &str) -> String {
    values
        .get(key)
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn validate_hostish(value: &str, key: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 255 {
        return Err(format!("{key} está vazio ou excede 255 caracteres"));
    }

    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err(format!(
            "{key} contém caracteres não permitidos; use somente letras, números, ponto, hífen e sublinhado"
        ));
    }

    Ok(())
}

fn validate_executable(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 255 {
        return Err(format!(
            "{EXECUTABLE_KEY} está vazio ou excede 255 caracteres"
        ));
    }

    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        || !value.to_ascii_lowercase().ends_with(".exe")
        || value.contains("..")
    {
        return Err(format!(
            "{EXECUTABLE_KEY} deve ser somente um nome de executável .exe, sem caminho"
        ));
    }

    Ok(())
}

fn write_generated_config(
    enabled: bool,
    server: &str,
    expected_domain: &str,
    executable: &str,
) -> Result<(), String> {
    let out_dir = PathBuf::from(
        env::var("OUT_DIR").map_err(|_| "OUT_DIR não foi definido pelo Cargo".to_string())?,
    );
    let output_path = out_dir.join("deployment_config.rs");

    // {:?} produces a valid escaped Rust string literal without printing values
    // to Cargo output or storing them in the public source tree.
    let generated = format!(
        "pub const REMOTE_SESSION_ENABLED: bool = {enabled};\n\
         pub const REMOTE_SESSION_SERVER: &str = {server:?};\n\
         pub const REMOTE_SESSION_EXPECTED_DOMAIN: &str = {expected_domain:?};\n\
         pub const REMOTE_SESSION_EXECUTABLE: &str = {executable:?};\n"
    );

    fs::write(output_path, generated)
        .map_err(|_| "Não foi possível gerar a configuração de deployment".to_string())
}
