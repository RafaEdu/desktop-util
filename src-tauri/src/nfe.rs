// ── NFe Query Module ───────────────────────────────────────────
use tauri::Manager;
use std::io::Write;

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeParty {
    pub name: String,
    pub cnpj_cpf: String,
    pub ie: String,
    pub address: NfeAddress,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeAddress {
    pub logradouro: String,
    pub nro: String,
    pub bairro: String,
    pub municipio: String,
    pub uf: String,
    pub cep: String,
    pub fone: String,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeProduto {
    pub num: u32,
    pub code: String,
    pub description: String,
    pub ncm: String,
    pub cst: String,
    pub cfop: String,
    pub unit: String,
    pub qty: String,
    pub unit_price: String,
    pub total: String,
    pub bc_icms: String,
    pub v_icms: String,
    pub v_ipi: String,
    pub aliq_icms: String,
    pub aliq_ipi: String,
    pub v_tot_trib: String,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeTotais {
    pub bc_icms: String,
    pub icms: String,
    pub bc_icms_st: String,
    pub icms_st: String,
    pub total_products: String,
    pub freight: String,
    pub insurance: String,
    pub discount: String,
    pub other: String,
    pub ipi: String,
    pub pis: String,
    pub cofins: String,
    pub total_nfe: String,
    pub v_tot_trib: String,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeTransporte {
    pub mod_frete: String,
    pub transportadora: NfeParty,
    pub veiculo_placa: String,
    pub veiculo_uf: String,
    pub veiculo_rntrc: String,
    pub vol_qvol: String,
    pub vol_esp: String,
    pub vol_marca: String,
    pub vol_nvol: String,
    pub vol_peso_b: String,
    pub vol_peso_l: String,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeInfoAdicional {
    pub inf_cpl: String,
    pub inf_fisco: String,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeFatura {
    pub duplicatas: Vec<NfeDuplicata>,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeDuplicata {
    pub n_dup: String,
    pub d_venc: String,
    pub v_dup: String,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct NfeData {
    pub chave: String,
    pub numero: String,
    pub serie: String,
    pub data_emissao: String,
    pub data_saida_entrada: String,
    pub hora_saida_entrada: String,
    pub tipo_nf: String,
    pub nat_op: String,
    pub emitente: NfeParty,
    pub destinatario: NfeParty,
    pub produtos: Vec<NfeProduto>,
    pub totais: NfeTotais,
    pub transporte: NfeTransporte,
    pub info_adicional: NfeInfoAdicional,
    pub fatura: Option<NfeFatura>,
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

    // 4. Parse SEFAZ SOAP response and return NfeData AND raw XML string
    let (nfe_data, raw_xml) = parse_sefaz_response(&body, &access_key)?;

    // 5. Generate DANFE HTML (Novo Layout Otimizado)
    let html = generate_danfe_html(&nfe_data);

    // 6. Save both XML and HTML to temp file and return path
    let path = save_files_to_temp(&html, &raw_xml, &access_key)?;

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
    
    // Salva HTML
    let filename_html = format!("DANFE_{}.html", &access_key[..20.min(access_key.len())]);
    let dest_html = downloads.join(filename_html);
    std::fs::copy(&source_path, &dest_html)
        .map_err(|e| format!("Falha ao salvar arquivo HTML: {}", e))?;

    // Tenta salvar o XML se existir (assumindo que está na mesma pasta temp com extensão .xml)
    let source_xml = std::path::PathBuf::from(&source_path).with_extension("xml");
    if source_xml.exists() {
        let filename_xml = format!("NFe_{}.xml", &access_key);
        let dest_xml = downloads.join(filename_xml);
        let _ = std::fs::copy(source_xml, dest_xml);
    }

    Ok(dest_html.to_string_lossy().to_string())
}

// ── Portal-Based Query (WebView with Captcha) ──────────────────

#[tauri::command]
pub async fn query_nfe_portal(
    app: tauri::AppHandle,
    access_key: String,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("sefaz-nfe") {
        let _: Result<(), _> = existing.close();
    }

    let url = "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=";
    let init_script = build_portal_init_script(&access_key);

    tauri::WebviewWindowBuilder::new(
        &app,
        "sefaz-nfe",
        tauri::WebviewUrl::External(url.parse().unwrap()),
    )
    .title("Consulta NFe - SEFAZ (Resumo)")
    .inner_size(1024.0, 800.0)
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
    var KEY = '{access_key}';
    function fillKey() {{
        var el = document.getElementById('ctl00_ContentPlaceHolder1_txtChaveAcessoResumo');
        if (!el) el = document.querySelector('input[name*="txtChaveAcesso"]');
        if (el) {{ el.value = KEY; }}
    }}
    setTimeout(fillKey, 500);
    setTimeout(fillKey, 1500);
}})();"#,
        access_key = access_key,
    )
}

// ── Cert Helpers ──────────────────────────────────────────────

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
        let store_name: Vec<u16> = "MY\0".encode_utf16().collect();
        let store = CertOpenSystemStoreW(0, store_name.as_ptr());
        if store.is_null() { return Err("Falha ao abrir repositório".into()); }
        
        let cert = find_cert_by_thumbprint_raw(store, thumbprint);
        if cert.is_null() {
            CertCloseStore(store, 0);
            return Err("Certificado não encontrado".into());
        }

        let cnpj = extract_cnpj_from_cert(cert);
        let mem_store = CertOpenStore(CERT_STORE_PROV_MEMORY, 0, 0, 0, std::ptr::null());
        
        CertAddCertificateContextToStore(mem_store, cert, 4, std::ptr::null_mut());
        
        let password_wide: Vec<u16> = password.encode_utf16().chain(std::iter::once(0)).collect();
        let mut pfx_blob = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        
        PFXExportCertStoreEx(mem_store, &mut pfx_blob, password_wide.as_ptr(), std::ptr::null_mut(), 0x0004 | 0x0002);
        
        let mut pfx_data = vec![0u8; pfx_blob.cbData as usize];
        pfx_blob.pbData = pfx_data.as_mut_ptr();
        
        let ok = PFXExportCertStoreEx(mem_store, &mut pfx_blob, password_wide.as_ptr(), std::ptr::null_mut(), 0x0004 | 0x0002);

        CertCloseStore(mem_store, 0);
        CertCloseStore(store, 0);

        if ok == 0 { return Err("Falha ao exportar PFX".into()); }
        Ok((pfx_data, password, cnpj))
    }
}

#[cfg(windows)]
unsafe fn find_cert_by_thumbprint_raw(store: *mut std::ffi::c_void, thumbprint: &str) -> *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT {
    use windows_sys::Win32::Security::Cryptography::*;
    let mut prev: *const CERT_CONTEXT = std::ptr::null();
    loop {
        let cert = CertEnumCertificatesInStore(store, prev);
        if cert.is_null() { return std::ptr::null(); }
        let tp = get_cert_thumbprint(cert);
        if tp.eq_ignore_ascii_case(thumbprint) { return cert; }
        prev = cert;
    }
}

#[cfg(windows)]
unsafe fn get_cert_thumbprint(cert: *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT) -> String {
    use windows_sys::Win32::Security::Cryptography::CertGetCertificateContextProperty;
    let mut hash_size: u32 = 20;
    let mut hash = vec![0u8; 20];
    if CertGetCertificateContextProperty(cert, 3, hash.as_mut_ptr() as *mut _, &mut hash_size) == 0 {
        return String::new();
    }
    hash[..hash_size as usize].iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(":")
}

#[cfg(windows)]
unsafe fn extract_cnpj_from_cert(cert: *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT) -> String {
    use windows_sys::Win32::Security::Cryptography::*;
    let mut buf = vec![0u16; 512];
    let len = CertGetNameStringW(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, std::ptr::null(), buf.as_mut_ptr(), buf.len() as u32);
    let simple = if len > 1 { String::from_utf16_lossy(&buf[..len as usize - 1]) } else { String::new() };
    if let Some(cnpj) = find_cnpj_in_str(&simple) { return cnpj; }
    String::new()
}

fn find_cnpj_in_str(s: &str) -> Option<String> {
    for part in s.split(':') {
        let trimmed = part.trim();
        if trimmed.len() == 14 && trimmed.chars().all(|c| c.is_ascii_digit()) { return Some(trimmed.to_string()); }
    }
    let mut buf = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() { buf.push(c); } else { if buf.len() == 14 { return Some(buf); } buf.clear(); }
    }
    if buf.len() == 14 { return Some(buf); }
    None
}

// ── SOAP Request Builder ───────────────────────────────────────

fn build_soap_request(access_key: &str, cnpj: &str, uf_code: u32, tp_amb: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap12:Header><nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><cUF>{uf}</cUF><versaoDados>1.01</versaoDados></nfeCabecMsg></soap12:Header><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>{tp_amb}</tpAmb><cUFAutor>{uf}</cUFAutor><CNPJ>{cnpj}</CNPJ><consChNFe><chNFe>{key}</chNFe></consChNFe></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>"#,
        uf = uf_code, tp_amb = tp_amb, cnpj = cnpj, key = access_key,
    )
}

// ── Response Parsing ───────────────────────────────────────────

fn parse_sefaz_response(soap_xml: &str, access_key: &str) -> Result<(NfeData, String), String> {
    let cstat = extract_tag_content(soap_xml, "cStat").unwrap_or_default().trim().to_string();
    if cstat != "138" {
        let xmotivo = extract_tag_content(soap_xml, "xMotivo").unwrap_or_default();
        return Err(format!("SEFAZ: {} - {}", cstat, xmotivo));
    }

    let doc_zips = extract_all_doc_zips(soap_xml);
    if doc_zips.is_empty() { return Err("Nenhum documento encontrado na resposta da SEFAZ".into()); }

    let mut nfe_xml_raw = String::new();
    
    // Procura procNFe (XML Completo)
    for (schema, b64_content) in &doc_zips {
        if schema.contains("procNFe") {
            let compressed = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64_content)
                .map_err(|e| format!("Falha decode base64: {}", e))?;
            nfe_xml_raw = decompress_doc_zip(&compressed)?;
            break;
        }
    }

    // Fallback se não achar procNFe explícito
    if nfe_xml_raw.is_empty() {
        let (_, b64_content) = &doc_zips[0];
        let compressed = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64_content)
            .map_err(|e| format!("Falha decode base64: {}", e))?;
        nfe_xml_raw = decompress_doc_zip(&compressed)?;
    }

    let data = parse_nfe_xml(&nfe_xml_raw, access_key)?;
    Ok((data, nfe_xml_raw))
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
        let tag_section = &xml[abs_start..abs_start + xml[abs_start..].find('>').unwrap_or(200).min(200)];
        let schema = if let Some(schema_start) = tag_section.find("schema=\"") {
            let s = schema_start + 8;
            if let Some(schema_end) = tag_section[s..].find('"') { tag_section[s..s + schema_end].to_string() } else { String::new() }
        } else { String::new() };
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
    {
        let mut decoder = flate2::read::GzDecoder::new(data);
        let mut result = String::new();
        if decoder.read_to_string(&mut result).is_ok() && !result.is_empty() { return Ok(result); }
    }
    Err("Falha ao descomprimir documento".into())
}

fn parse_nfe_xml(xml: &str, access_key: &str) -> Result<NfeData, String> {
    let mut data = NfeData { chave: access_key.to_string(), ..Default::default() };
    if let Some(ide) = extract_block(xml, "ide") {
        data.numero = extract_tag_content(&ide, "nNF").unwrap_or_default();
        data.serie = extract_tag_content(&ide, "serie").unwrap_or_default();
        data.data_emissao = extract_tag_content(&ide, "dhEmi").unwrap_or_default();
        data.data_saida_entrada = extract_tag_content(&ide, "dhSaiEnt").or_else(|| extract_tag_content(&ide, "dSaiEnt")).unwrap_or_default();
        data.hora_saida_entrada = extract_tag_content(&ide, "hSaiEnt").unwrap_or_default();
        data.nat_op = extract_tag_content(&ide, "natOp").unwrap_or_default();
        data.tipo_nf = extract_tag_content(&ide, "tpNF").unwrap_or_default();
    }
    if let Some(emit_block) = extract_block(xml, "emit") {
        data.emitente.name = extract_tag_content(&emit_block, "xNome").unwrap_or_default();
        data.emitente.cnpj_cpf = extract_tag_content(&emit_block, "CNPJ").or_else(|| extract_tag_content(&emit_block, "CPF")).unwrap_or_default();
        data.emitente.ie = extract_tag_content(&emit_block, "IE").unwrap_or_default();
        if let Some(addr) = extract_block(&emit_block, "enderEmit") { data.emitente.address = parse_address(&addr); }
    }
    if let Some(dest_block) = extract_block(xml, "dest") {
        data.destinatario.name = extract_tag_content(&dest_block, "xNome").unwrap_or_default();
        data.destinatario.cnpj_cpf = extract_tag_content(&dest_block, "CNPJ").or_else(|| extract_tag_content(&dest_block, "CPF")).unwrap_or_default();
        data.destinatario.ie = extract_tag_content(&dest_block, "IE").unwrap_or_default();
        if let Some(addr) = extract_block(&dest_block, "enderDest") { data.destinatario.address = parse_address(&addr); }
    }
    data.produtos = parse_products(xml);
    if let Some(tot_block) = extract_block(xml, "ICMSTot") { data.totais = parse_totals(&tot_block); }
    if let Some(transp) = extract_block(xml, "transp") { data.transporte = parse_transport(&transp); }
    if let Some(cobr) = extract_block(xml, "cobr") { data.fatura = Some(parse_fatura(&cobr)); }
    if let Some(inf) = extract_block(xml, "infAdic") {
        data.info_adicional.inf_cpl = extract_tag_content(&inf, "infCpl").unwrap_or_default();
        data.info_adicional.inf_fisco = extract_tag_content(&inf, "infAdFisco").unwrap_or_default();
    }
    if let Some(prot_block) = extract_block(xml, "infProt") {
        let nprot = extract_tag_content(&prot_block, "nProt").unwrap_or_default();
        let dh = extract_tag_content(&prot_block, "dhRecbto").unwrap_or_default();
        data.protocolo = format!("{} - {}", nprot, dh);
    }
    Ok(data)
}

fn parse_address(xml: &str) -> NfeAddress {
    NfeAddress {
        logradouro: extract_tag_content(xml, "xLgr").unwrap_or_default(),
        nro: extract_tag_content(xml, "nro").unwrap_or_default(),
        bairro: extract_tag_content(xml, "xBairro").unwrap_or_default(),
        municipio: extract_tag_content(xml, "xMun").unwrap_or_default(),
        uf: extract_tag_content(xml, "UF").unwrap_or_default(),
        cep: extract_tag_content(xml, "CEP").unwrap_or_default(),
        fone: extract_tag_content(xml, "fone").unwrap_or_default(),
    }
}
fn parse_totals(xml: &str) -> NfeTotais {
    NfeTotais {
        bc_icms: extract_tag_content(xml, "vBC").unwrap_or_default(),
        icms: extract_tag_content(xml, "vICMS").unwrap_or_default(),
        bc_icms_st: extract_tag_content(xml, "vBCST").unwrap_or_default(),
        icms_st: extract_tag_content(xml, "vST").unwrap_or_default(),
        total_products: extract_tag_content(xml, "vProd").unwrap_or_default(),
        freight: extract_tag_content(xml, "vFrete").unwrap_or_default(),
        insurance: extract_tag_content(xml, "vSeg").unwrap_or_default(),
        discount: extract_tag_content(xml, "vDesc").unwrap_or_default(),
        other: extract_tag_content(xml, "vOutro").unwrap_or_default(),
        ipi: extract_tag_content(xml, "vIPI").unwrap_or_default(),
        pis: extract_tag_content(xml, "vPIS").unwrap_or_default(),
        cofins: extract_tag_content(xml, "vCOFINS").unwrap_or_default(),
        total_nfe: extract_tag_content(xml, "vNF").unwrap_or_default(),
        v_tot_trib: extract_tag_content(xml, "vTotTrib").unwrap_or_default(),
    }
}
fn parse_transport(xml: &str) -> NfeTransporte {
    let mut t = NfeTransporte { mod_frete: extract_tag_content(xml, "modFrete").unwrap_or_default(), ..Default::default() };
    if let Some(transporta) = extract_block(xml, "transporta") {
        t.transportadora.name = extract_tag_content(&transporta, "xNome").unwrap_or_default();
        t.transportadora.cnpj_cpf = extract_tag_content(&transporta, "CNPJ").or_else(|| extract_tag_content(&transporta, "CPF")).unwrap_or_default();
        t.transportadora.ie = extract_tag_content(&transporta, "IE").unwrap_or_default();
        t.transportadora.address.logradouro = extract_tag_content(&transporta, "xEnder").unwrap_or_default();
        t.transportadora.address.municipio = extract_tag_content(&transporta, "xMun").unwrap_or_default();
        t.transportadora.address.uf = extract_tag_content(&transporta, "UF").unwrap_or_default();
    }
    if let Some(veic) = extract_block(xml, "veicTransp") {
        t.veiculo_placa = extract_tag_content(&veic, "placa").unwrap_or_default();
        t.veiculo_uf = extract_tag_content(&veic, "UF").unwrap_or_default();
        t.veiculo_rntrc = extract_tag_content(&veic, "RNTRC").unwrap_or_default();
    }
    if let Some(vol) = extract_block(xml, "vol") {
        t.vol_qvol = extract_tag_content(&vol, "qVol").unwrap_or_default();
        t.vol_esp = extract_tag_content(&vol, "esp").unwrap_or_default();
        t.vol_marca = extract_tag_content(&vol, "marca").unwrap_or_default();
        t.vol_nvol = extract_tag_content(&vol, "nVol").unwrap_or_default();
        t.vol_peso_l = extract_tag_content(&vol, "pesoL").unwrap_or_default();
        t.vol_peso_b = extract_tag_content(&vol, "pesoB").unwrap_or_default();
    }
    t
}
fn parse_fatura(xml: &str) -> NfeFatura {
    let mut f = NfeFatura { duplicatas: Vec::new() };
    let mut search_from = 0;
    while let Some(dup_start) = xml[search_from..].find("<dup") {
        let abs_start = search_from + dup_start;
        if let Some(dup_end) = xml[abs_start..].find("</dup>") {
            let dup_block = &xml[abs_start..abs_start + dup_end + 6];
            f.duplicatas.push(NfeDuplicata {
                n_dup: extract_tag_content(dup_block, "nDup").unwrap_or_default(),
                d_venc: extract_tag_content(dup_block, "dVenc").unwrap_or_default(),
                v_dup: extract_tag_content(dup_block, "vDup").unwrap_or_default(),
            });
            search_from = abs_start + dup_end + 6;
        } else { break; }
    }
    f
}
fn parse_products(xml: &str) -> Vec<NfeProduto> {
    let mut products = Vec::new();
    let mut search_from = 0;
    let mut item_num = 1u32;
    while let Some(det_start) = xml[search_from..].find("<det ") {
        let abs_start = search_from + det_start;
        if let Some(det_end) = xml[abs_start..].find("</det>") {
            let det_block = &xml[abs_start..abs_start + det_end + 6];
            let num = if let Some(nitem_pos) = det_block.find("nItem=\"") {
                let s = nitem_pos + 7;
                if let Some(end) = det_block[s..].find('"') { det_block[s..s + end].parse().unwrap_or(item_num) } else { item_num }
            } else { item_num };
            let mut prod = NfeProduto { num, ..Default::default() };
            if let Some(prod_block) = extract_block(det_block, "prod") {
                prod.code = extract_tag_content(&prod_block, "cProd").unwrap_or_default();
                prod.description = extract_tag_content(&prod_block, "xProd").unwrap_or_default();
                prod.ncm = extract_tag_content(&prod_block, "NCM").unwrap_or_default();
                prod.cfop = extract_tag_content(&prod_block, "CFOP").unwrap_or_default();
                prod.unit = extract_tag_content(&prod_block, "uCom").unwrap_or_default();
                prod.qty = extract_tag_content(&prod_block, "qCom").unwrap_or_default();
                prod.unit_price = extract_tag_content(&prod_block, "vUnCom").unwrap_or_default();
                prod.total = extract_tag_content(&prod_block, "vProd").unwrap_or_default();
            }
            if let Some(imposto) = extract_block(det_block, "imposto") {
                prod.v_tot_trib = extract_tag_content(&imposto, "vTotTrib").unwrap_or_default();
                if let Some(icms) = extract_block(&imposto, "ICMS") {
                    prod.cst = extract_tag_content(&icms, "CST").or_else(|| extract_tag_content(&icms, "CSOSN")).unwrap_or_default();
                    prod.bc_icms = extract_tag_content(&icms, "vBC").unwrap_or_default();
                    prod.aliq_icms = extract_tag_content(&icms, "pICMS").unwrap_or_default();
                    prod.v_icms = extract_tag_content(&icms, "vICMS").unwrap_or_default();
                }
                if let Some(ipi) = extract_block(&imposto, "IPI") {
                    prod.aliq_ipi = extract_tag_content(&ipi, "pIPI").unwrap_or_default();
                    prod.v_ipi = extract_tag_content(&ipi, "vIPI").unwrap_or_default();
                }
            }
            products.push(prod);
            search_from = abs_start + det_end + 6;
            item_num += 1;
        } else { break; }
    }
    products
}

// ── DANFE HTML Generator ───────────────────────────────────────

fn generate_danfe_html(data: &NfeData) -> String {
    let chave_formatada = data.chave.chars().collect::<Vec<_>>().chunks(4).map(|c| c.iter().collect::<String>()).collect::<Vec<_>>().join(" ");
    let cnpj_emit = format_cnpj_cpf(&data.emitente.cnpj_cpf);
    let cnpj_dest = format_cnpj_cpf(&data.destinatario.cnpj_cpf);
    
    // Agora usados corretamente
    let cnpj_transp = format_cnpj_cpf(&data.transporte.transportadora.cnpj_cpf);

    let format_addr = |a: &NfeAddress| -> String {
        let mut parts = Vec::new();
        if !a.logradouro.is_empty() { parts.push(format!("{}, {}", a.logradouro, a.nro)); }
        if !a.bairro.is_empty() { parts.push(a.bairro.clone()); }
        if !a.municipio.is_empty() { parts.push(format!("{} - {}", a.municipio, a.uf)); }
        if !a.cep.is_empty() { parts.push(format!("CEP: {}", a.cep)); }
        if !a.fone.is_empty() { parts.push(format!("Fone: {}", a.fone)); }
        parts.join(" - ")
    };
    let emit_addr = format_addr(&data.emitente.address);
    let dest_addr = format_addr(&data.destinatario.address);
    
    // Agora usado corretamente
    let transp_addr = format_addr(&data.transporte.transportadora.address);

    let fmt_date = |d: &str| -> String {
         if d.len() >= 10 {
            let parts: Vec<&str> = d[..10].split('-').collect();
            if parts.len() == 3 { return format!("{}/{}/{}", parts[2], parts[1], parts[0]); }
         }
         d.to_string()
    };
    let data_emissao_fmt = fmt_date(&data.data_emissao);
    let data_sai_ent_fmt = fmt_date(&data.data_saida_entrada);

    // CSS Grid Robusto para DANFE
    let css = r#"
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap');
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
        body { margin: 0; padding: 20px; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; background: #555; display: flex; justify-content: center; }
        .page { width: 210mm; min-height: 297mm; background: white; padding: 10mm; box-shadow: 0 0 10px rgba(0,0,0,0.5); position: relative; }
        .row { display: flex; width: 100%; }
        .col { display: flex; flex-direction: column; border: 1px solid #000; margin-right: -1px; margin-bottom: -1px; padding: 2px 4px; }
        .label { font-size: 7pt; font-weight: bold; text-transform: uppercase; color: #444; }
        .content { font-size: 9pt; font-weight: normal; color: #000; min-height: 12px; }
        .bold { font-weight: bold; }
        .center { text-align: center; justify-content: center; align-items: center; }
        .right { text-align: right; justify-content: center; }
        .section-header { background: #eee; border: 1px solid #000; font-size: 8pt; font-weight: bold; text-transform: uppercase; padding: 2px; margin-bottom: -1px; margin-right: -1px; margin-top: 5px; }
        
        .box-canhoto { height: 25mm; display: flex; margin-bottom: 5px; }
        .header-main { height: 35mm; display: flex; margin-bottom: 5px; }
        .barcode { font-family: 'Libre Barcode 128', cursive; font-size: 42pt; text-align: center; overflow: hidden; white-space: nowrap; }
        
        table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: -1px; }
        th { border: 1px solid #000; background: #eee; font-weight: bold; padding: 2px; font-size: 7pt; }
        td { border: 1px solid #000; padding: 2px; }
        .t-right { text-align: right; }
        .t-center { text-align: center; }
        
        @media print {
            body { background: white; padding: 0; }
            .page { width: 100%; height: auto; padding: 0; box-shadow: none; margin: 0; }
            .no-print { display: none; }
        }
        
        .w-10 { width: 10%; } .w-15 { width: 15%; } .w-20 { width: 20%; } 
        .w-25 { width: 25%; } .w-30 { width: 30%; } .w-40 { width: 40%; } 
        .w-50 { width: 50%; } .w-60 { width: 60%; } .flex-1 { flex: 1; }
    </style>
    "#;

    let mut prods = String::new();
    for p in &data.produtos {
        prods.push_str(&format!(
            "<tr>
                <td class='t-center'>{}</td><td>{}</td><td class='t-center'>{}</td><td class='t-center'>{}</td>
                <td class='t-center'>{}</td><td class='t-center'>{}</td><td class='t-right'>{}</td><td class='t-right'>{}</td>
                <td class='t-right'>{}</td><td class='t-right'>{}</td><td class='t-right'>{}</td><td class='t-right'>{}</td>
                <td class='t-right'>{}</td><td class='t-right'>{}</td>
            </tr>",
            p.code, p.description, p.ncm, p.cst, p.cfop, p.unit, p.qty, p.unit_price, p.total, p.bc_icms, p.v_icms, p.v_ipi, p.aliq_icms, p.aliq_ipi
        ));
    }

    let barcode_script = r#"
    <script>
    (function() {
        // Fallback simples
    })();
    </script>
    "#;

    format!(
        r#"<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>DANFE - {numero}</title>{css}</head>
<body>
    <div class="page">
        <div class="box-canhoto">
            <div class="col flex-1"><div class="label">RECEBEMOS DE {emit_nome} OS PRODUTOS/SERVIÇOS CONSTANTES NA NOTA FISCAL INDICADA AO LADO</div><div class="content center" style="margin-top:auto">DATA DE RECEBIMENTO</div></div>
            <div class="col flex-1"><div class="label">IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR</div><div class="content"></div></div>
            <div class="col w-15 center"><div class="label">NF-e</div><div class="content bold" style="font-size:14pt">Nº {numero}</div><div class="label">SÉRIE {serie}</div></div>
        </div>

        <div class="header-main">
            <div class="col w-40 center">
                <div class="content bold" style="font-size:12pt">{emit_nome}</div>
                <div class="content" style="font-size:7pt">{emit_addr}</div>
            </div>
            <div class="col w-15 center">
                <div class="content bold" style="font-size:18pt">DANFE</div>
                <div class="label" style="text-align:center">Documento Auxiliar da Nota Fiscal Eletrônica</div>
                <div class="row" style="border:none; width:100%; margin-top:5px">
                    <div class="col flex-1 center" style="border:none"><div class="label">0 - Entrada<br>1 - Saída</div></div>
                    <div class="col flex-1 center" style="border:1px solid #000"><div class="content bold" style="font-size:14pt">{tipo_nf}</div></div>
                </div>
                <div class="content bold" style="margin-top:2px">Nº {numero}</div>
                <div class="content">SÉRIE {serie}</div>
            </div>
            <div class="col flex-1">
                <div class="barcode">{chave}</div>
                <div class="row" style="border:none">
                   <div class="col flex-1" style="border:none"><div class="label">Chave de Acesso</div><div class="content center bold" style="font-size:10pt">{chave_fmt}</div></div>
                </div>
                <div class="row" style="border:none; border-top:1px solid #000">
                    <div class="col flex-1 center" style="border:none; padding:4px">
                        <div class="label">Consulta de autenticidade no portal nacional da NF-e<br>www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="row">
            <div class="col w-60"><div class="label">NATUREZA DA OPERAÇÃO</div><div class="content">{nat_op}</div></div>
            <div class="col flex-1"><div class="label">PROTOCOLO DE AUTORIZAÇÃO DE USO</div><div class="content">{protocolo}</div></div>
        </div>
        <div class="row">
            <div class="col flex-1"><div class="label">INSCRIÇÃO ESTADUAL</div><div class="content">{ie_emit}</div></div>
            <div class="col flex-1"><div class="label">INSC. ESTADUAL SUBST. TRIB.</div><div class="content"></div></div>
            <div class="col flex-1"><div class="label">CNPJ</div><div class="content">{cnpj_emit}</div></div>
        </div>

        <div class="section-header">Destinatário / Remetente</div>
        <div class="row">
            <div class="col w-60"><div class="label">NOME / RAZÃO SOCIAL</div><div class="content">{dest_nome}</div></div>
            <div class="col w-25"><div class="label">CNPJ / CPF</div><div class="content">{dest_cnpj}</div></div>
            <div class="col flex-1"><div class="label">DATA DA EMISSÃO</div><div class="content right">{dt_emi}</div></div>
        </div>
        <div class="row">
            <div class="col w-50"><div class="label">ENDEREÇO</div><div class="content">{dest_addr}</div></div>
            <div class="col w-20"><div class="label">BAIRRO / DISTRITO</div><div class="content"></div></div>
            <div class="col w-15"><div class="label">CEP</div><div class="content"></div></div>
            <div class="col flex-1"><div class="label">DATA SAÍDA/ENTRADA</div><div class="content right">{dt_sai}</div></div>
        </div>

        <div class="section-header">Cálculo do Imposto</div>
        <div class="row">
            <div class="col flex-1"><div class="label">BASE CÁLC. ICMS</div><div class="content right">{bc_icms}</div></div>
            <div class="col flex-1"><div class="label">VALOR ICMS</div><div class="content right">{v_icms}</div></div>
            <div class="col flex-1"><div class="label">BASE CÁLC. ICMS ST</div><div class="content right">{bc_st}</div></div>
            <div class="col flex-1"><div class="label">VALOR ICMS ST</div><div class="content right">{v_st}</div></div>
            <div class="col flex-1"><div class="label">VALOR TOTAL PRODUTOS</div><div class="content right">{v_prod}</div></div>
        </div>
        <div class="row">
            <div class="col flex-1"><div class="label">VALOR FRETE</div><div class="content right">{frete}</div></div>
            <div class="col flex-1"><div class="label">VALOR SEGURO</div><div class="content right">{seg}</div></div>
            <div class="col flex-1"><div class="label">DESCONTO</div><div class="content right">{desc}</div></div>
            <div class="col flex-1"><div class="label">OUTRAS DESPESAS</div><div class="content right">{outros}</div></div>
            <div class="col flex-1"><div class="label">VALOR IPI</div><div class="content right">{ipi}</div></div>
            <div class="col flex-1"><div class="label">VALOR TOTAL NOTA</div><div class="content right bold">{v_nf}</div></div>
        </div>

        <div class="section-header">Transportador / Volumes Transportados</div>
        <div class="row">
            <div class="col w-40"><div class="label">RAZÃO SOCIAL</div><div class="content">{transp_nome}</div></div>
            <div class="col w-15"><div class="label">FRETE POR CONTA</div><div class="content center">{mod_frete}</div></div>
            <div class="col w-15"><div class="label">CÓDIGO ANTT</div><div class="content center">{rntrc}</div></div>
            <div class="col w-15"><div class="label">PLACA DO VEÍCULO</div><div class="content center">{placa}</div></div>
            <div class="col w-10"><div class="label">UF</div><div class="content center">{uf_veic}</div></div>
            <div class="col flex-1"><div class="label">CNPJ/CPF</div><div class="content center">{cnpj_transp}</div></div>
        </div>
        <div class="row">
            <div class="col w-40"><div class="label">ENDEREÇO</div><div class="content">{transp_addr}</div></div>
            <div class="col w-40"><div class="label">MUNICÍPIO</div><div class="content">{transp_mun}</div></div>
            <div class="col w-10"><div class="label">UF</div><div class="content center">{transp_uf}</div></div>
            <div class="col flex-1"><div class="label">INSCRIÇÃO ESTADUAL</div><div class="content center">{transp_ie}</div></div>
        </div>
        <div class="row">
            <div class="col w-10"><div class="label">QUANTIDADE</div><div class="content center">{qvol}</div></div>
            <div class="col w-20"><div class="label">ESPÉCIE</div><div class="content">{esp}</div></div>
            <div class="col w-20"><div class="label">MARCA</div><div class="content">{marca}</div></div>
            <div class="col w-20"><div class="label">NUMERAÇÃO</div><div class="content">{nvol}</div></div>
            <div class="col w-15"><div class="label">PESO BRUTO</div><div class="content right">{peso_b}</div></div>
            <div class="col flex-1"><div class="label">PESO LÍQUIDO</div><div class="content right">{peso_l}</div></div>
        </div>

        <div class="section-header">Dados do Produto / Serviço</div>
        <div class="row" style="display:block">
            <table>
                <thead>
                    <tr>
                        <th>CÓD</th><th>DESCRIÇÃO</th><th>NCM</th><th>CST</th><th>CFOP</th><th>UNID</th><th>QTD</th>
                        <th>V.UNIT</th><th>V.TOTAL</th><th>BC.ICMS</th><th>V.ICMS</th><th>V.IPI</th><th>%ICMS</th><th>%IPI</th>
                    </tr>
                </thead>
                <tbody>
                    {products}
                </tbody>
            </table>
        </div>
        
        <div class="row" style="margin-top:10px; border:none">
           <div class="col flex-1" style="border:none">
              <div class="label">INFORMAÇÕES COMPLEMENTARES</div>
              <div class="content" style="border:1px solid #000; padding:5px; min-height:60px; font-size:8pt">{inf_cpl}</div>
           </div>
        </div>
        <div class="center no-print" style="margin-top:20px">
            <button onclick="window.print()" style="padding:10px 20px; font-size:14pt; cursor:pointer">IMPRIMIR DANFE</button>
        </div>
    </div>
    {scripts}
</body>
</html>
"#,
        css = css,
        numero = data.numero,
        serie = data.serie,
        tipo_nf = data.tipo_nf,
        chave = data.chave, 
        chave_fmt = chave_formatada,
        emit_nome = data.emitente.name,
        emit_addr = emit_addr,
        cnpj_emit = cnpj_emit,
        ie_emit = data.emitente.ie,
        dest_nome = data.destinatario.name,
        dest_cnpj = cnpj_dest,
        dt_emi = data_emissao_fmt,
        dt_sai = data_sai_ent_fmt,
        dest_addr = dest_addr,
        nat_op = data.nat_op,
        protocolo = data.protocolo,
        bc_icms = data.totais.bc_icms,
        v_icms = data.totais.icms,
        bc_st = data.totais.bc_icms_st,
        v_st = data.totais.icms_st,
        v_prod = data.totais.total_products,
        frete = data.totais.freight,
        seg = data.totais.insurance,
        desc = data.totais.discount,
        outros = data.totais.other,
        ipi = data.totais.ipi,
        v_nf = data.totais.total_nfe,
        
        // Blocos Transportador adicionados
        transp_nome = data.transporte.transportadora.name,
        mod_frete = data.transporte.mod_frete,
        rntrc = data.transporte.veiculo_rntrc,
        placa = data.transporte.veiculo_placa,
        uf_veic = data.transporte.veiculo_uf,
        cnpj_transp = cnpj_transp,
        transp_addr = transp_addr,
        transp_mun = data.transporte.transportadora.address.municipio,
        transp_uf = data.transporte.transportadora.address.uf,
        transp_ie = data.transporte.transportadora.ie,
        qvol = data.transporte.vol_qvol,
        esp = data.transporte.vol_esp,
        marca = data.transporte.vol_marca,
        nvol = data.transporte.vol_nvol,
        peso_b = data.transporte.vol_peso_b,
        peso_l = data.transporte.vol_peso_l,

        inf_cpl = data.info_adicional.inf_cpl,
        products = prods,
        scripts = barcode_script
    )
}

fn format_cnpj_cpf(value: &str) -> String {
    if value.len() == 14 { format!("{}.{}.{}/{}-{}", &value[0..2], &value[2..5], &value[5..8], &value[8..12], &value[12..14]) }
    else if value.len() == 11 { format!("{}.{}.{}-{}", &value[0..3], &value[3..6], &value[6..9], &value[9..11]) }
    else { value.to_string() }
}

// ── Save HTML/XML to Temp ────────────────────────────────────────

fn save_files_to_temp(html: &str, raw_xml: &str, access_key: &str) -> Result<String, String> {
    use rand::Rng;
    let random: u64 = rand::thread_rng().gen();
    let temp_dir = std::env::temp_dir();
    
    let xml_filename = format!("danfe_{}_{}.xml", access_key, random);
    let xml_path = temp_dir.join(xml_filename);
    let mut xml_file = std::fs::File::create(&xml_path).map_err(|e| format!("Erro ao criar XML: {}", e))?;
    xml_file.write_all(raw_xml.as_bytes()).map_err(|e| format!("Erro ao escrever XML: {}", e))?;

    let html_filename = format!("danfe_{}_{}.html", access_key, random);
    let html_path = temp_dir.join(html_filename);
    let mut html_file = std::fs::File::create(&html_path).map_err(|e| format!("Erro ao criar HTML: {}", e))?;
    html_file.write_all(html.as_bytes()).map_err(|e| format!("Erro ao escrever HTML: {}", e))?;

    Ok(html_path.to_string_lossy().to_string())
}