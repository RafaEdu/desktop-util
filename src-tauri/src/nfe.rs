// ── NFe Query Module ───────────────────────────────────────────
use tauri::Manager;

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeParty {
    pub name: String,
    pub cnpj_cpf: String,
    pub ie: String,
    pub address: String,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeProduto {
    pub num: u32,
    pub code: String,
    pub description: String,
    pub ncm: String,
    pub cfop: String,
    pub unit: String,
    pub qty: String,
    pub unit_price: String,
    pub total: String,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeTotais {
    pub bc_icms: String,
    pub icms: String,
    pub bc_icms_st: String,
    pub icms_st: String,
    pub freight: String,
    pub insurance: String,
    pub discount: String,
    pub other: String,
    pub ipi: String,
    pub total_products: String,
    pub total_nfe: String,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeData {
    pub chave: String,
    pub numero: String,
    pub serie: String,
    pub data_emissao: String,
    pub emitente: NfeParty,
    pub destinatario: NfeParty,
    pub produtos: Vec<NfeProduto>,
    pub totais: NfeTotais,
    pub protocolo: String,
}

#[tauri::command]
pub async fn query_nfe(
    thumbprint: String,
    access_key: String,
) -> Result<String, String> {
    query_nfe_impl(thumbprint, access_key).await
}

#[cfg(windows)]
async fn query_nfe_impl(
    thumbprint: String,
    access_key: String,
) -> Result<String, String> {
    // Validate access key
    if access_key.len() != 44 || !access_key.chars().all(|c| c.is_ascii_digit()) {
        return Err("Chave de acesso deve conter exatamente 44 dígitos numéricos".into());
    }

    // Extract UF code from access key (first 2 digits)
    let uf_code: u32 = access_key[..2]
        .parse()
        .map_err(|_| "Código UF inválido na chave de acesso".to_string())?;

    // 1. Export certificate as PFX and extract CNPJ
    let (mut pfx_bytes, password, cnpj) = export_cert_pfx(&thumbprint)?;

    if cnpj.is_empty() {
        pfx_bytes.fill(0);
        return Err("Não foi possível extrair o CNPJ do certificado selecionado. Verifique se é um e-CNPJ (A1).".into());
    }

    // 2. Build SOAP envelope (always production)
    let soap_xml = build_soap_request(&access_key, &cnpj, uf_code, "1");

    // 3. Send request to SEFAZ (production endpoint)
    let endpoint = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";

    let identity = reqwest::Identity::from_pkcs12_der(&pfx_bytes, &password)
        .map_err(|e| format!("Falha ao criar identidade TLS: {}", e))?;

    // Zero out PFX bytes for security
    pfx_bytes.fill(0);

    let client = reqwest::Client::builder()
        .identity(identity)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Falha ao criar cliente HTTP: {}", e))?;

    let response = client
        .post(endpoint)
        .header("Content-Type", "application/soap+xml; charset=utf-8")
        .body(soap_xml)
        .send()
        .await
        .map_err(|e| format!("Falha na comunicação com SEFAZ: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Falha ao ler resposta: {}", e))?;

    if !status.is_success() {
        let preview = if body.len() > 500 { &body[..500] } else { &body };
        return Err(format!("SEFAZ retornou status {}: {}", status, preview));
    }

    // 4. Parse SEFAZ SOAP response
    let nfe_data = parse_sefaz_response(&body, &access_key)?;

    // 5. Generate DANFE HTML
    let html = generate_danfe_html(&nfe_data);

    // 6. Save to temp file and return path
    let path = save_html_to_temp(&html)?;

    Ok(path)
}

#[cfg(not(windows))]
async fn query_nfe_impl(
    _thumbprint: String,
    _access_key: String,
) -> Result<String, String> {
    Err("Consulta NFe disponível apenas no Windows".into())
}

#[tauri::command]
pub fn open_danfe(file_path: String) -> Result<(), String> {
    open_danfe_impl(&file_path)
}

#[cfg(windows)]
fn open_danfe_impl(file_path: &str) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", file_path])
        .spawn()
        .map_err(|e| format!("Falha ao abrir navegador: {}", e))?;
    Ok(())
}

#[cfg(not(windows))]
fn open_danfe_impl(file_path: &str) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(file_path)
        .spawn()
        .map_err(|e| format!("Falha ao abrir navegador: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn download_danfe(source_path: String, access_key: String) -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Não foi possível localizar a pasta do usuário".to_string())?;
    let downloads = std::path::PathBuf::from(home).join("Downloads");
    if !downloads.exists() {
        std::fs::create_dir_all(&downloads)
            .map_err(|e| format!("Falha ao criar pasta Downloads: {}", e))?;
    }
    let filename = format!("DANFE_{}.html", &access_key[..20.min(access_key.len())]);
    let dest = downloads.join(filename);
    std::fs::copy(&source_path, &dest)
        .map_err(|e| format!("Falha ao salvar arquivo: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

// ── Portal-Based Query (WebView with Captcha) ──────────────────

#[tauri::command]
pub async fn query_nfe_portal(
    app: tauri::AppHandle,
    access_key: String,
) -> Result<(), String> {
    // Close existing consultation window if open
    if let Some(existing) = app.get_webview_window("sefaz-nfe") {
        let _: Result<(), _> = existing.close();
    }

    let url = "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=completa&tipoConteudo=XbSeqxE8pl8=";

    let init_script = build_portal_init_script(&access_key);

    tauri::WebviewWindowBuilder::new(
        &app,
        "sefaz-nfe",
        tauri::WebviewUrl::External(url.parse().unwrap()),
    )
    .title("Consulta NFe - SEFAZ")
    .inner_size(620.0, 740.0)
    .center()
    .initialization_script(&init_script)
    .build()
    .map_err(|e| format!("Falha ao abrir janela de consulta: {}", e))?;

    Ok(())
}

fn build_portal_init_script(access_key: &str) -> String {
    format!(
        r#"(function() {{
    'use strict';

    var FILLED = false;
    var ACTION_BAR_ADDED = false;

    function prefillKey() {{
        if (FILLED) return;
        var key = '{access_key}';
        var inputs = document.querySelectorAll('input[type="text"]');
        for (var i = 0; i < inputs.length; i++) {{
            var el = inputs[i];
            var id = (el.id || '').toLowerCase();
            var name = (el.name || '').toLowerCase();
            if (id.indexOf('chave') !== -1 || name.indexOf('chave') !== -1) {{
                el.value = key;
                el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                FILLED = true;
                return;
            }}
        }}
    }}

    function hasNfeResults() {{
        // Look for NFe-specific content that only appears after captcha
        var body = document.body ? document.body.innerText : '';
        if (body.indexOf('Chave de Acesso') !== -1 && body.indexOf('Emitente') !== -1) return true;
        if (body.indexOf('DANFE') !== -1) return true;
        if (document.querySelector('[id*="Emitente"]')) return true;
        if (document.querySelector('[id*="Destinatario"]')) return true;
        // Look for fieldsets about NFe data (these only appear in results)
        var legends = document.querySelectorAll('legend, fieldset');
        for (var i = 0; i < legends.length; i++) {{
            var t = legends[i].innerText || '';
            if (t.indexOf('Emitente') !== -1 || t.indexOf('Produto') !== -1 || t.indexOf('Total') !== -1) return true;
        }}
        return false;
    }}

    function addActionBar() {{
        if (ACTION_BAR_ADDED) return;
        if (!hasNfeResults()) return;
        ACTION_BAR_ADDED = true;

        var bar = document.createElement('div');
        bar.id = 'uh-actions';
        bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:12px 20px;background:#1e293b;border-top:1px solid #334155;display:flex;gap:10px;justify-content:center;z-index:99999;box-shadow:0 -4px 16px rgba(0,0,0,0.4);';

        var printBtn = document.createElement('button');
        printBtn.textContent = 'Imprimir';
        printBtn.style.cssText = 'background:#4f46e5;color:white;border:none;border-radius:8px;padding:10px 28px;cursor:pointer;font-weight:600;font-size:14px;min-width:140px;';
        printBtn.onmouseenter = function() {{ this.style.background='#6366f1'; }};
        printBtn.onmouseleave = function() {{ this.style.background='#4f46e5'; }};
        printBtn.onclick = function() {{ window.print(); }};

        bar.appendChild(printBtn);
        document.body.appendChild(bar);
        document.body.style.paddingBottom = '60px';
    }}

    function init() {{
        // Prefill access key with retries (ASP.NET may render late)
        prefillKey();
        setTimeout(prefillKey, 500);
        setTimeout(prefillKey, 1500);
        setTimeout(prefillKey, 3000);

        // Watch for NFe results after captcha is solved
        if (document.body) {{
            var observer = new MutationObserver(function() {{
                addActionBar();
            }});
            observer.observe(document.body, {{ childList: true, subtree: true }});
            addActionBar();
        }}
    }}

    if (document.readyState === 'loading') {{
        document.addEventListener('DOMContentLoaded', init);
    }} else {{
        init();
    }}
}})();"#,
        access_key = access_key,
    )
}

#[cfg(windows)]
fn export_cert_pfx(thumbprint: &str) -> Result<(Vec<u8>, String, String), String> {
    use windows_sys::Win32::Security::Cryptography::*;
    use rand::Rng;

    let password: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();

    unsafe {
        // Open MY store
        let store_name: Vec<u16> = "MY\0".encode_utf16().collect();
        let store = CertOpenSystemStoreW(0, store_name.as_ptr());
        if store.is_null() {
            return Err("Falha ao abrir repositório de certificados".into());
        }

        // Find cert by thumbprint
        let cert = find_cert_by_thumbprint_raw(store, thumbprint);
        if cert.is_null() {
            CertCloseStore(store, 0);
            return Err("Certificado não encontrado com o thumbprint informado".into());
        }

        // Extract CNPJ from certificate subject
        let cnpj = extract_cnpj_from_cert(cert);

        // Create in-memory store for PFX export
        let mem_store = CertOpenStore(
            CERT_STORE_PROV_MEMORY,
            0,
            0,
            0,
            std::ptr::null(),
        );
        if mem_store.is_null() {
            CertCloseStore(store, 0);
            return Err("Falha ao criar repositório temporário".into());
        }

        // Add cert to memory store
        const LOCAL_CERT_STORE_ADD_ALWAYS: u32 = 4;
        let added = CertAddCertificateContextToStore(
            mem_store,
            cert,
            LOCAL_CERT_STORE_ADD_ALWAYS,
            std::ptr::null_mut(),
        );
        if added == 0 {
            CertCloseStore(mem_store, 0);
            CertCloseStore(store, 0);
            return Err("Falha ao adicionar certificado ao repositório temporário".into());
        }

        // Prepare PFX export
        let password_wide: Vec<u16> = password
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        const LOCAL_EXPORT_PRIVATE_KEYS: u32 = 0x0004;
        const LOCAL_REPORT_NOT_ABLE_TO_EXPORT: u32 = 0x0002;

        let mut pfx_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };

        // First call: get required size
        let ok = PFXExportCertStoreEx(
            mem_store,
            &mut pfx_blob,
            password_wide.as_ptr(),
            std::ptr::null_mut(),
            LOCAL_EXPORT_PRIVATE_KEYS | LOCAL_REPORT_NOT_ABLE_TO_EXPORT,
        );
        if ok == 0 {
            CertCloseStore(mem_store, 0);
            CertCloseStore(store, 0);
            return Err(
                "Falha ao exportar certificado. A chave privada pode não ser exportável.".into(),
            );
        }

        // Allocate buffer and export
        let mut pfx_data = vec![0u8; pfx_blob.cbData as usize];
        pfx_blob.pbData = pfx_data.as_mut_ptr();

        let ok = PFXExportCertStoreEx(
            mem_store,
            &mut pfx_blob,
            password_wide.as_ptr(),
            std::ptr::null_mut(),
            LOCAL_EXPORT_PRIVATE_KEYS | LOCAL_REPORT_NOT_ABLE_TO_EXPORT,
        );

        CertCloseStore(mem_store, 0);
        CertCloseStore(store, 0);

        if ok == 0 {
            return Err("Falha ao exportar certificado como PFX".into());
        }

        Ok((pfx_data, password, cnpj))
    }
}

#[cfg(windows)]
unsafe fn find_cert_by_thumbprint_raw(
    store: *mut std::ffi::c_void,
    thumbprint: &str,
) -> *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT {
    use windows_sys::Win32::Security::Cryptography::*;

    let mut prev: *const CERT_CONTEXT = std::ptr::null();
    loop {
        let cert = CertEnumCertificatesInStore(store, prev);
        if cert.is_null() {
            return std::ptr::null();
        }

        let tp = get_cert_thumbprint(cert);
        if tp.eq_ignore_ascii_case(thumbprint) {
            return cert;
        }

        prev = cert;
    }
}

#[cfg(windows)]
unsafe fn get_cert_thumbprint(
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

#[cfg(windows)]
unsafe fn extract_cnpj_from_cert(
    cert: *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT,
) -> String {
    use windows_sys::Win32::Security::Cryptography::*;

    // Get simple display name (often "COMPANY:CNPJ")
    let mut buf = vec![0u16; 512];
    let len = CertGetNameStringW(
        cert,
        CERT_NAME_SIMPLE_DISPLAY_TYPE,
        0,
        std::ptr::null(),
        buf.as_mut_ptr(),
        buf.len() as u32,
    );
    let simple = if len > 1 {
        String::from_utf16_lossy(&buf[..len as usize - 1])
    } else {
        String::new()
    };

    // Get full RDN subject
    const LOCAL_CERT_NAME_RDN_TYPE: u32 = 2;
    let mut rdn_buf = vec![0u16; 2048];
    let rdn_len = CertGetNameStringW(
        cert,
        LOCAL_CERT_NAME_RDN_TYPE,
        0,
        std::ptr::null(),
        rdn_buf.as_mut_ptr(),
        rdn_buf.len() as u32,
    );
    let rdn = if rdn_len > 1 {
        String::from_utf16_lossy(&rdn_buf[..rdn_len as usize - 1])
    } else {
        String::new()
    };

    // Extract CNPJ from either string
    if let Some(cnpj) = find_cnpj_in_str(&simple) {
        return cnpj;
    }
    if let Some(cnpj) = find_cnpj_in_str(&rdn) {
        return cnpj;
    }
    String::new()
}

fn find_cnpj_in_str(s: &str) -> Option<String> {
    // Pattern 1: after colon (e.g., "EMPRESA:12345678000190")
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

// ── SOAP Request Builder ───────────────────────────────────────

fn build_soap_request(access_key: &str, cnpj: &str, uf_code: u32, tp_amb: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <cUF>{uf}</cUF>
      <versaoDados>1.01</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>{tp_amb}</tpAmb>
          <cUFAutor>{uf}</cUFAutor>
          <CNPJ>{cnpj}</CNPJ>
          <consChNFe>
            <chNFe>{key}</chNFe>
          </consChNFe>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>"#,
        uf = uf_code,
        tp_amb = tp_amb,
        cnpj = cnpj,
        key = access_key,
    )
}

// ── Response Parsing ───────────────────────────────────────────

fn parse_sefaz_response(soap_xml: &str, access_key: &str) -> Result<NfeData, String> {
    // Extract cStat and xMotivo from response
    let cstat = extract_tag_content(soap_xml, "cStat")
        .unwrap_or_default()
        .trim()
        .to_string();
    let xmotivo = extract_tag_content(soap_xml, "xMotivo")
        .unwrap_or_default()
        .trim()
        .to_string();

    if cstat != "138" {
        return Err(format!("SEFAZ: {} - {}", cstat, xmotivo));
    }

    // Find docZip elements
    let doc_zips = extract_all_doc_zips(soap_xml);
    if doc_zips.is_empty() {
        return Err("Nenhum documento encontrado na resposta da SEFAZ".into());
    }

    // Find the procNFe document (full NFe XML), else use first docZip
    let mut nfe_xml = None;
    for (schema, b64_content) in &doc_zips {
        if schema.contains("procNFe") {
            let compressed = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                b64_content,
            )
            .map_err(|e| format!("Falha ao decodificar base64: {}", e))?;

            nfe_xml = Some(decompress_doc_zip(&compressed)?);
            break;
        }
    }

    let nfe_xml = match nfe_xml {
        Some(xml) => xml,
        None => {
            let (_, b64_content) = &doc_zips[0];
            let compressed = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                b64_content,
            )
            .map_err(|e| format!("Falha ao decodificar base64: {}", e))?;
            decompress_doc_zip(&compressed)?
        }
    };

    parse_nfe_xml(&nfe_xml, access_key)
}

fn extract_tag_content(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)?;
    let tag_end = xml[start..].find('>')? + start + 1;
    let end = xml[tag_end..].find(&close)? + tag_end;
    Some(xml[tag_end..end].to_string())
}

fn extract_block(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)?;
    let end = xml[start..].find(&close)? + start + close.len();
    Some(xml[start..end].to_string())
}

fn extract_all_doc_zips(xml: &str) -> Vec<(String, String)> {
    let mut results = Vec::new();
    let mut search_from = 0;

    while let Some(start) = xml[search_from..].find("<docZip") {
        let abs_start = search_from + start;

        // Extract schema attribute
        let tag_section = &xml[abs_start..abs_start + xml[abs_start..].find('>').unwrap_or(200).min(200)];
        let schema = if let Some(schema_start) = tag_section.find("schema=\"") {
            let s = schema_start + 8;
            if let Some(schema_end) = tag_section[s..].find('"') {
                tag_section[s..s + schema_end].to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        // Extract content
        if let Some(tag_end) = xml[abs_start..].find('>') {
            let content_start = abs_start + tag_end + 1;
            if let Some(close) = xml[content_start..].find("</docZip>") {
                let content = xml[content_start..content_start + close].trim().to_string();
                results.push((schema, content));
                search_from = content_start + close + 9;
                continue;
            }
        }

        search_from = abs_start + 7;
    }

    results
}

fn decompress_doc_zip(data: &[u8]) -> Result<String, String> {
    use std::io::Read;

    // Try gzip first
    {
        let mut decoder = flate2::read::GzDecoder::new(data);
        let mut result = String::new();
        if decoder.read_to_string(&mut result).is_ok() && !result.is_empty() {
            return Ok(result);
        }
    }

    // Fall back to raw deflate
    {
        let mut decoder = flate2::read::DeflateDecoder::new(data);
        let mut result = String::new();
        if decoder.read_to_string(&mut result).is_ok() && !result.is_empty() {
            return Ok(result);
        }
    }

    // Try zlib
    {
        let mut decoder = flate2::read::ZlibDecoder::new(data);
        let mut result = String::new();
        if decoder.read_to_string(&mut result).is_ok() && !result.is_empty() {
            return Ok(result);
        }
    }

    Err("Falha ao descomprimir documento (tentou gzip, deflate e zlib)".into())
}

fn parse_nfe_xml(xml: &str, access_key: &str) -> Result<NfeData, String> {
    let mut data = NfeData {
        chave: access_key.to_string(),
        ..Default::default()
    };

    // -- ide section
    data.numero = extract_tag_content(xml, "nNF").unwrap_or_default();
    data.serie = extract_tag_content(xml, "serie").unwrap_or_default();
    data.data_emissao = extract_tag_content(xml, "dhEmi").unwrap_or_default();

    // -- emitente
    if let Some(emit_block) = extract_block(xml, "emit") {
        data.emitente.name = extract_tag_content(&emit_block, "xNome").unwrap_or_default();
        data.emitente.cnpj_cpf = extract_tag_content(&emit_block, "CNPJ")
            .or_else(|| extract_tag_content(&emit_block, "CPF"))
            .unwrap_or_default();
        data.emitente.ie = extract_tag_content(&emit_block, "IE").unwrap_or_default();

        let lgr = extract_tag_content(&emit_block, "xLgr").unwrap_or_default();
        let nro = extract_tag_content(&emit_block, "nro").unwrap_or_default();
        let bairro = extract_tag_content(&emit_block, "xBairro").unwrap_or_default();
        let mun = extract_tag_content(&emit_block, "xMun").unwrap_or_default();
        let uf = extract_tag_content(&emit_block, "UF").unwrap_or_default();
        let cep = extract_tag_content(&emit_block, "CEP").unwrap_or_default();
        data.emitente.address = format!(
            "{}, {} - {} - {}/{} - CEP: {}",
            lgr, nro, bairro, mun, uf, cep
        );
    }

    // -- destinatario
    if let Some(dest_block) = extract_block(xml, "dest") {
        data.destinatario.name = extract_tag_content(&dest_block, "xNome").unwrap_or_default();
        data.destinatario.cnpj_cpf = extract_tag_content(&dest_block, "CNPJ")
            .or_else(|| extract_tag_content(&dest_block, "CPF"))
            .unwrap_or_default();
        data.destinatario.ie = extract_tag_content(&dest_block, "IE").unwrap_or_default();

        let lgr = extract_tag_content(&dest_block, "xLgr").unwrap_or_default();
        let nro = extract_tag_content(&dest_block, "nro").unwrap_or_default();
        let bairro = extract_tag_content(&dest_block, "xBairro").unwrap_or_default();
        let mun = extract_tag_content(&dest_block, "xMun").unwrap_or_default();
        let uf = extract_tag_content(&dest_block, "UF").unwrap_or_default();
        let cep = extract_tag_content(&dest_block, "CEP").unwrap_or_default();
        data.destinatario.address = format!(
            "{}, {} - {} - {}/{} - CEP: {}",
            lgr, nro, bairro, mun, uf, cep
        );
    }

    // -- produtos
    data.produtos = parse_products(xml);

    // -- totais (ICMSTot)
    if let Some(tot_block) = extract_block(xml, "ICMSTot") {
        data.totais.bc_icms = extract_tag_content(&tot_block, "vBC").unwrap_or_default();
        data.totais.icms = extract_tag_content(&tot_block, "vICMS").unwrap_or_default();
        data.totais.bc_icms_st = extract_tag_content(&tot_block, "vBCST").unwrap_or_default();
        data.totais.icms_st = extract_tag_content(&tot_block, "vST").unwrap_or_default();
        data.totais.freight = extract_tag_content(&tot_block, "vFrete").unwrap_or_default();
        data.totais.insurance = extract_tag_content(&tot_block, "vSeg").unwrap_or_default();
        data.totais.discount = extract_tag_content(&tot_block, "vDesc").unwrap_or_default();
        data.totais.other = extract_tag_content(&tot_block, "vOutro").unwrap_or_default();
        data.totais.ipi = extract_tag_content(&tot_block, "vIPI").unwrap_or_default();
        data.totais.total_products = extract_tag_content(&tot_block, "vProd").unwrap_or_default();
        data.totais.total_nfe = extract_tag_content(&tot_block, "vNF").unwrap_or_default();
    }

    // -- protocolo
    if let Some(prot_block) = extract_block(xml, "infProt") {
        let nprot = extract_tag_content(&prot_block, "nProt").unwrap_or_default();
        let dh = extract_tag_content(&prot_block, "dhRecbto").unwrap_or_default();
        data.protocolo = format!("{} - {}", nprot, dh);
    }

    Ok(data)
}

fn parse_products(xml: &str) -> Vec<NfeProduto> {
    let mut products = Vec::new();
    let mut search_from = 0;
    let mut item_num = 1u32;

    while let Some(det_start) = xml[search_from..].find("<det ") {
        let abs_start = search_from + det_start;

        if let Some(det_end) = xml[abs_start..].find("</det>") {
            let det_block = &xml[abs_start..abs_start + det_end + 6];

            // Extract nItem attribute
            let num = if let Some(nitem_pos) = det_block.find("nItem=\"") {
                let s = nitem_pos + 7;
                if let Some(end) = det_block[s..].find('"') {
                    det_block[s..s + end].parse().unwrap_or(item_num)
                } else {
                    item_num
                }
            } else {
                item_num
            };

            if let Some(prod_block) = extract_block(det_block, "prod") {
                products.push(NfeProduto {
                    num,
                    code: extract_tag_content(&prod_block, "cProd").unwrap_or_default(),
                    description: extract_tag_content(&prod_block, "xProd").unwrap_or_default(),
                    ncm: extract_tag_content(&prod_block, "NCM").unwrap_or_default(),
                    cfop: extract_tag_content(&prod_block, "CFOP").unwrap_or_default(),
                    unit: extract_tag_content(&prod_block, "uCom").unwrap_or_default(),
                    qty: extract_tag_content(&prod_block, "qCom").unwrap_or_default(),
                    unit_price: extract_tag_content(&prod_block, "vUnCom").unwrap_or_default(),
                    total: extract_tag_content(&prod_block, "vProd").unwrap_or_default(),
                });
            }

            search_from = abs_start + det_end + 6;
            item_num += 1;
        } else {
            break;
        }
    }

    products
}

// ── DANFE HTML Generator ───────────────────────────────────────

fn generate_danfe_html(data: &NfeData) -> String {
    let chave_formatada = data
        .chave
        .chars()
        .collect::<Vec<_>>()
        .chunks(4)
        .map(|c| c.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join(" ");

    let cnpj_emit = format_cnpj_cpf(&data.emitente.cnpj_cpf);
    let cnpj_dest = format_cnpj_cpf(&data.destinatario.cnpj_cpf);

    let data_emissao_fmt = if data.data_emissao.len() >= 10 {
        let parts: Vec<&str> = data.data_emissao[..10].split('-').collect();
        if parts.len() == 3 {
            format!("{}/{}/{}", parts[2], parts[1], parts[0])
        } else {
            data.data_emissao.clone()
        }
    } else {
        data.data_emissao.clone()
    };

    let mut products_html = String::new();
    for p in &data.produtos {
        products_html.push_str(&format!(
            "<tr>\
                <td style=\"text-align:center\">{}</td>\
                <td>{}</td>\
                <td>{}</td>\
                <td>{}</td>\
                <td>{}</td>\
                <td>{}</td>\
                <td style=\"text-align:right\">{}</td>\
                <td style=\"text-align:right\">{}</td>\
                <td style=\"text-align:right\">{}</td>\
            </tr>",
            p.num, p.code, p.description, p.ncm, p.cfop, p.unit, p.qty, p.unit_price, p.total
        ));
    }

    format!(
        r#"<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DANFE - NF-e {numero}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: Arial, Helvetica, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; color: #1a1a1a; background: #fff; }}
        .header {{ text-align: center; border: 2px solid #000; padding: 15px; margin-bottom: 2px; }}
        .header h1 {{ font-size: 22px; margin-bottom: 4px; }}
        .header .subtitle {{ font-size: 12px; color: #555; }}
        .key-box {{ border: 2px solid #000; padding: 10px; text-align: center; margin-bottom: 2px; }}
        .key-box .label {{ font-size: 10px; color: #555; text-transform: uppercase; }}
        .key-box .key {{ font-family: 'Courier New', monospace; font-size: 15px; letter-spacing: 1px; margin-top: 4px; }}
        .section {{ border: 2px solid #000; padding: 10px; margin-bottom: 2px; }}
        .section-title {{ font-size: 11px; text-transform: uppercase; color: #555; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 8px; font-weight: bold; }}
        .field-row {{ display: flex; gap: 15px; margin-bottom: 6px; flex-wrap: wrap; }}
        .field {{ flex: 1; min-width: 120px; }}
        .field .label {{ font-size: 9px; text-transform: uppercase; color: #777; }}
        .field .value {{ font-size: 12px; font-weight: 500; }}
        table {{ width: 100%; border-collapse: collapse; }}
        th {{ background: #f0f0f0; font-size: 10px; text-transform: uppercase; padding: 5px 6px; border: 1px solid #999; text-align: left; }}
        td {{ font-size: 11px; padding: 4px 6px; border: 1px solid #ccc; }}
        .totals-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; }}
        .total-item {{ padding: 6px; border: 1px solid #ccc; }}
        .total-item .label {{ font-size: 9px; text-transform: uppercase; color: #777; }}
        .total-item .value {{ font-size: 13px; font-weight: bold; }}
        .total-highlight {{ background: #f5f5f5; }}
        .total-highlight .value {{ font-size: 16px; color: #000; }}
        .protocol {{ border: 2px solid #000; padding: 8px; margin-bottom: 2px; text-align: center; font-size: 11px; }}
        .footer {{ text-align: center; margin-top: 15px; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 10px; }}
        @media print {{ body {{ padding: 10px; }} }}
    </style>
</head>
<body>
    <div class="header">
        <h1>DANFE</h1>
        <div class="subtitle">Documento Auxiliar da Nota Fiscal Eletr&ocirc;nica</div>
        <div style="margin-top: 8px; font-size: 14px;">
            <strong>NF-e N.&ordm; {numero}</strong> &mdash; S&eacute;rie {serie} &mdash; {data_emissao}
        </div>
    </div>

    <div class="key-box">
        <div class="label">Chave de Acesso</div>
        <div class="key">{chave}</div>
    </div>

    <div class="protocol">
        <strong>Protocolo de Autoriza&ccedil;&atilde;o:</strong> {protocolo}
    </div>

    <div class="section">
        <div class="section-title">Emitente</div>
        <div class="field-row">
            <div class="field" style="flex:2">
                <div class="label">Raz&atilde;o Social</div>
                <div class="value">{emit_nome}</div>
            </div>
            <div class="field">
                <div class="label">CNPJ/CPF</div>
                <div class="value">{emit_cnpj}</div>
            </div>
            <div class="field">
                <div class="label">IE</div>
                <div class="value">{emit_ie}</div>
            </div>
        </div>
        <div class="field-row">
            <div class="field" style="flex:3">
                <div class="label">Endere&ccedil;o</div>
                <div class="value">{emit_addr}</div>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Destinat&aacute;rio</div>
        <div class="field-row">
            <div class="field" style="flex:2">
                <div class="label">Raz&atilde;o Social</div>
                <div class="value">{dest_nome}</div>
            </div>
            <div class="field">
                <div class="label">CNPJ/CPF</div>
                <div class="value">{dest_cnpj}</div>
            </div>
            <div class="field">
                <div class="label">IE</div>
                <div class="value">{dest_ie}</div>
            </div>
        </div>
        <div class="field-row">
            <div class="field" style="flex:3">
                <div class="label">Endere&ccedil;o</div>
                <div class="value">{dest_addr}</div>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Produtos / Servi&ccedil;os</div>
        <table>
            <thead>
                <tr>
                    <th style="width:30px">#</th>
                    <th style="width:70px">C&oacute;digo</th>
                    <th>Descri&ccedil;&atilde;o</th>
                    <th style="width:70px">NCM</th>
                    <th style="width:50px">CFOP</th>
                    <th style="width:40px">Un.</th>
                    <th style="width:60px;text-align:right">Qtd.</th>
                    <th style="width:70px;text-align:right">Vl. Unit.</th>
                    <th style="width:80px;text-align:right">Vl. Total</th>
                </tr>
            </thead>
            <tbody>
                {products}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">Totais</div>
        <div class="totals-grid">
            <div class="total-item">
                <div class="label">BC ICMS</div>
                <div class="value">{bc_icms}</div>
            </div>
            <div class="total-item">
                <div class="label">ICMS</div>
                <div class="value">{icms}</div>
            </div>
            <div class="total-item">
                <div class="label">BC ICMS ST</div>
                <div class="value">{bc_icms_st}</div>
            </div>
            <div class="total-item">
                <div class="label">ICMS ST</div>
                <div class="value">{icms_st}</div>
            </div>
            <div class="total-item">
                <div class="label">Frete</div>
                <div class="value">{freight}</div>
            </div>
            <div class="total-item">
                <div class="label">Seguro</div>
                <div class="value">{insurance}</div>
            </div>
            <div class="total-item">
                <div class="label">Desconto</div>
                <div class="value">{discount}</div>
            </div>
            <div class="total-item">
                <div class="label">Outras Desp.</div>
                <div class="value">{other}</div>
            </div>
            <div class="total-item">
                <div class="label">IPI</div>
                <div class="value">{ipi}</div>
            </div>
            <div class="total-item">
                <div class="label">Total Produtos</div>
                <div class="value">{total_products}</div>
            </div>
            <div class="total-item total-highlight" style="grid-column: span 2;">
                <div class="label">Valor Total da NF-e</div>
                <div class="value">R$ {total_nfe}</div>
            </div>
        </div>
    </div>

    <div class="footer">
        Gerado por Util Hub &mdash; Documento auxiliar para visualiza&ccedil;&atilde;o. N&atilde;o possui valor fiscal.
    </div>
</body>
</html>"#,
        numero = data.numero,
        serie = data.serie,
        data_emissao = data_emissao_fmt,
        chave = chave_formatada,
        protocolo = data.protocolo,
        emit_nome = data.emitente.name,
        emit_cnpj = cnpj_emit,
        emit_ie = data.emitente.ie,
        emit_addr = data.emitente.address,
        dest_nome = data.destinatario.name,
        dest_cnpj = cnpj_dest,
        dest_ie = data.destinatario.ie,
        dest_addr = data.destinatario.address,
        products = products_html,
        bc_icms = data.totais.bc_icms,
        icms = data.totais.icms,
        bc_icms_st = data.totais.bc_icms_st,
        icms_st = data.totais.icms_st,
        freight = data.totais.freight,
        insurance = data.totais.insurance,
        discount = data.totais.discount,
        other = data.totais.other,
        ipi = data.totais.ipi,
        total_products = data.totais.total_products,
        total_nfe = data.totais.total_nfe,
    )
}

fn format_cnpj_cpf(value: &str) -> String {
    if value.len() == 14 {
        format!(
            "{}.{}.{}/{}-{}",
            &value[0..2],
            &value[2..5],
            &value[5..8],
            &value[8..12],
            &value[12..14]
        )
    } else if value.len() == 11 {
        format!(
            "{}.{}.{}-{}",
            &value[0..3],
            &value[3..6],
            &value[6..9],
            &value[9..11]
        )
    } else {
        value.to_string()
    }
}

// ── Save HTML to Temp ────────────────────────────────────────────

fn save_html_to_temp(html: &str) -> Result<String, String> {
    use std::io::Write;
    use rand::Rng;

    let random: u64 = rand::thread_rng().gen();
    let filename = format!("danfe_{}.html", random);
    let path = std::env::temp_dir().join(filename);

    let mut file = std::fs::File::create(&path)
        .map_err(|e| format!("Falha ao criar arquivo DANFE: {}", e))?;
    file.write_all(html.as_bytes())
        .map_err(|e| format!("Falha ao escrever arquivo DANFE: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}
