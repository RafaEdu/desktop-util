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

    let url = "https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=";

    let init_script = build_portal_init_script(&access_key);

    tauri::WebviewWindowBuilder::new(
        &app,
        "sefaz-nfe",
        tauri::WebviewUrl::External(url.parse().unwrap()),
    )
    .title("Consulta NFe - SEFAZ")
    .inner_size(850.0, 780.0)
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
    var FILLED = false;
    var SUBMITTED = false;
    var RENDERED = false;

    function gt(el) {{
        return el ? (el.innerText || el.textContent || el.value || '').trim() : '';
    }}

    function isFormPage() {{
        return !!document.querySelector('input[name*="txtChaveAcesso"]');
    }}

    /* ══════ FORM PAGE: auto-fill + captcha detect + auto-submit ══════ */

    function fillKey() {{
        if (FILLED) return;
        var el = document.getElementById('ctl00_ContentPlaceHolder1_txtChaveAcessoResumo');
        if (!el) {{
            var list = document.querySelectorAll('input[name*="txtChaveAcesso"], input.txtChaveAcesso');
            if (list.length) el = list[0];
        }}
        if (el) {{
            el.value = KEY;
            el.dispatchEvent(new Event('input',  {{bubbles:true}}));
            el.dispatchEvent(new Event('change', {{bubbles:true}}));
            el.dispatchEvent(new Event('blur',   {{bubbles:true}}));
            FILLED = true;
        }}
    }}

    function captchaDone() {{
        var r = document.querySelector(
            'textarea[name="h-captcha-response"], textarea[name="g-recaptcha-response"]'
        );
        return !!(r && r.value && r.value.trim().length > 10);
    }}

    function clickContinuar() {{
        if (SUBMITTED) return;
        SUBMITTED = true;
        setTimeout(function() {{
            var b = document.getElementById('ctl00_ContentPlaceHolder1_btnConsultarHCaptcha');
            if (!b) b = document.querySelector('input[value="Continuar"]');
            if (b) b.click();
        }}, 400);
    }}

    function setupForm() {{
        fillKey();
        setTimeout(fillKey, 500);
        setTimeout(fillKey, 1500);
        setTimeout(fillKey, 3000);
        var iv = setInterval(function() {{
            if (captchaDone()) {{ clickContinuar(); clearInterval(iv); }}
        }}, 500);
    }}

    /* ══════ RESULT PAGE: scrape NFe data + render DANFE ══════ */

    function scrape() {{
        var d = {{
            chave:KEY, sit:'', num:'', serie:'', dtEmi:'',
            eNome:'', eCnpj:'', eIe:'', eEnd:'',
            dNome:'', dCnpj:'', dIe:'', dEnd:'',
            vTotal:'', prot:''
        }};

        /* 1) Scan ASP.NET spans/labels by id */
        var spans = document.querySelectorAll(
            'span[id*="ContentPlaceHolder"], label[id*="ContentPlaceHolder"]'
        );
        for (var i = 0; i < spans.length; i++) {{
            var id = (spans[i].id || '').toLowerCase();
            var t = gt(spans[i]);
            if (!t) continue;
            if (id.includes('chave'))    d.chave = t.replace(/\s/g, '') || d.chave;
            if (id.includes('situacao')) d.sit = t;
            if (id.includes('protocolo') || id.includes('nprot')) d.prot = d.prot || t;
        }}

        /* 2) Scan table rows for label-value pairs */
        var rows = document.querySelectorAll('tr');
        for (var j = 0; j < rows.length; j++) {{
            var cc = rows[j].querySelectorAll('td');
            for (var k = 0; k < cc.length - 1; k++) {{
                var lb = gt(cc[k]).toLowerCase();
                var vl = gt(cc[k + 1]);
                if (!lb || !vl) continue;

                var fs = cc[k].closest ? cc[k].closest('fieldset') : null;
                var lg = fs ? gt(fs.querySelector('legend')).toLowerCase() : '';
                var isD = lg.includes('destinat') || lg.includes('tomador');

                if (lb.includes('raz') || lb.includes('nome')) {{
                    if (isD) d.dNome = d.dNome || vl;
                    else d.eNome = d.eNome || vl;
                }}
                if (lb.includes('cnpj') || (lb.includes('cpf') && !lb.includes('ie'))) {{
                    if (isD) d.dCnpj = d.dCnpj || vl;
                    else d.eCnpj = d.eCnpj || vl;
                }}
                if (lb.includes('inscri') && lb.includes('estadual')) {{
                    if (isD) d.dIe = d.dIe || vl;
                    else d.eIe = d.eIe || vl;
                }}
                if (lb.includes('endere')) {{
                    if (isD) d.dEnd = d.dEnd || vl;
                    else d.eEnd = d.eEnd || vl;
                }}
                if (lb.includes('valor total') || lb.includes('valor da n')) {{
                    d.vTotal = d.vTotal || vl;
                }}
                if (lb.includes('protocolo')) d.prot = d.prot || vl;
                if ((lb.includes('n\u00famero') || lb.includes('numero')) && !lb.includes('prot') && !lb.includes('recib')) {{
                    d.num = d.num || vl;
                }}
                if (lb.includes('s\u00e9rie') || lb === 'serie') d.serie = d.serie || vl;
                if (lb.includes('data') && lb.includes('emiss')) d.dtEmi = d.dtEmi || vl;
            }}
        }}

        return d;
    }}

    function barcode128c(k) {{
        var P=['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
        var c=[105];
        for(var i=0;i<k.length;i+=2)c.push(parseInt(k.substr(i,2)));
        var s=c[0];for(var j=1;j<c.length;j++)s+=c[j]*j;
        c.push(s%103);c.push(106);
        var pat='';for(var m=0;m<c.length;m++)pat+=P[c[m]];
        var cv=document.createElement('canvas');
        var sc=2,tw=0;
        for(var n=0;n<pat.length;n++)tw+=parseInt(pat[n]);
        cv.width=(tw+20)*sc;cv.height=55;
        var ctx=cv.getContext('2d');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);
        var x=10*sc;
        for(var q=0;q<pat.length;q++){{
            var bw=parseInt(pat[q])*sc;
            if(q%2===0){{ctx.fillStyle='#000';ctx.fillRect(x,0,bw,cv.height);}}
            x+=bw;
        }}
        return cv.toDataURL();
    }}

    function danfe() {{
        if (RENDERED) return;
        RENDERED = true;

        var d = scrape();
        var cf = d.chave.replace(/(\d{{4}})/g, '$1 ').trim();
        var bc = barcode128c(d.chave);

        var sl = (d.sit || '').toLowerCase();
        var stCls = sl.includes('autoriz') ? 'sa' : (sl.includes('cancel') || sl.includes('denega')) ? 'sc' : 'so';

        var p = [];
        p.push('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">');
        p.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
        p.push('<title>DANFE - NF-e ' + (d.num || '') + '</title><style>');
        p.push('*{{margin:0;padding:0;box-sizing:border-box}}');
        p.push('body{{font-family:Arial,Helvetica,sans-serif;background:#d1d5db;color:#000;padding-bottom:70px}}');
        p.push('.pg{{max-width:800px;margin:20px auto;background:#fff;border:1px solid #000;box-shadow:0 4px 24px rgba(0,0,0,.15)}}');
        p.push('@media print{{body{{background:#fff;padding:0}}.pg{{margin:0;border:none;box-shadow:none}}.act{{display:none!important}}body{{padding-bottom:0!important}}}}');

        /* Header grid: emitter | DANFE id */
        p.push('.dh{{display:grid;grid-template-columns:1fr 180px;border-bottom:2px solid #000}}');
        p.push('.dhe{{padding:12px;border-right:2px solid #000}}');
        p.push('.dhe .en{{font-size:15px;font-weight:bold;margin-bottom:6px}}');
        p.push('.dhe .ed{{font-size:10px;color:#333;line-height:1.7}}');
        p.push('.dhd{{padding:12px;text-align:center;display:flex;flex-direction:column;justify-content:center;align-items:center}}');
        p.push('.dhd .dl{{font-size:24px;font-weight:bold;letter-spacing:4px}}');
        p.push('.dhd .ds{{font-size:8px;color:#555;margin:4px 0 10px;line-height:1.4}}');
        p.push('.dhd .dn{{font-size:15px;font-weight:bold}}');
        p.push('.dhd .dsr{{font-size:10px;color:#555;margin-top:2px}}');

        /* Barcode */
        p.push('.bc{{border-bottom:2px solid #000;padding:10px 12px;text-align:center}}');
        p.push('.bc img{{height:50px;max-width:100%}}');
        p.push('.bc .bl{{font-size:8px;color:#777;text-transform:uppercase;margin-top:6px}}');
        p.push('.bc .bk{{font-family:"Courier New",monospace;font-size:12px;letter-spacing:2px;margin-top:2px}}');

        /* Status row */
        p.push('.sr{{border-bottom:2px solid #000;padding:8px 12px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}}');
        p.push('.sb{{display:inline-block;padding:4px 14px;border-radius:3px;font-size:11px;font-weight:bold;text-transform:uppercase}}');
        p.push('.sa{{background:#dcfce7;color:#166534;border:1px solid #86efac}}');
        p.push('.sc{{background:#fef2f2;color:#991b1b;border:1px solid #fca5a5}}');
        p.push('.so{{background:#fefce8;color:#854d0e;border:1px solid #fde047}}');
        p.push('.pt{{font-size:10px;color:#444}}');

        /* Section */
        p.push('.se{{border-bottom:2px solid #000;padding:10px 12px}}');
        p.push('.stl{{font-size:8px;text-transform:uppercase;color:#555;letter-spacing:1px;font-weight:bold;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:8px}}');
        p.push('.fg{{display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px 12px;margin-bottom:4px}}');
        p.push('.fgf{{grid-template-columns:1fr}}');
        p.push('.fl{{font-size:8px;text-transform:uppercase;color:#888}}');
        p.push('.fv{{font-size:11px;font-weight:500}}');

        /* Total */
        p.push('.vt{{border-bottom:2px solid #000;padding:16px 12px;text-align:center;background:#f9fafb}}');
        p.push('.vt .vl{{font-size:9px;text-transform:uppercase;color:#777;letter-spacing:1px}}');
        p.push('.vt .vv{{font-size:28px;font-weight:bold;margin-top:4px}}');

        /* Date row */
        p.push('.dt{{border-bottom:2px solid #000;padding:8px 12px;font-size:10px}}');

        /* Footer */
        p.push('.ft{{padding:10px 12px;text-align:center;font-size:9px;color:#999}}');

        /* Action bar */
        p.push('.act{{position:fixed;bottom:0;left:0;right:0;background:#1e293b;padding:12px;display:flex;justify-content:center;gap:12px;box-shadow:0 -4px 20px rgba(0,0,0,.3)}}');
        p.push('.act button{{border:none;padding:10px 36px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;background:#4f46e5;color:#fff}}');
        p.push('.act button:hover{{background:#6366f1}}');
        p.push('</style></head><body>');

        p.push('<div class="pg">');

        /* ── DANFE Header: Emitter | DANFE identification ── */
        p.push('<div class="dh">');
        p.push('<div class="dhe">');
        p.push('<div class="en">' + (d.eNome || '-') + '</div>');
        p.push('<div class="ed">');
        if (d.eCnpj) p.push('CNPJ: ' + d.eCnpj + '<br>');
        if (d.eIe) p.push('IE: ' + d.eIe + '<br>');
        if (d.eEnd) p.push(d.eEnd);
        p.push('</div></div>');
        p.push('<div class="dhd">');
        p.push('<div class="dl">DANFE</div>');
        p.push('<div class="ds">Documento Auxiliar da<br>Nota Fiscal Eletr\u00f4nica</div>');
        if (d.num) p.push('<div class="dn">N\u00ba ' + d.num + '</div>');
        if (d.serie) p.push('<div class="dsr">S\u00e9rie ' + d.serie + '</div>');
        p.push('</div></div>');

        /* ── Barcode + Access Key ── */
        p.push('<div class="bc">');
        p.push('<img src="' + bc + '" alt="C\u00f3digo de Barras"><br>');
        p.push('<div class="bl">Chave de Acesso</div>');
        p.push('<div class="bk">' + cf + '</div>');
        p.push('</div>');

        /* ── Status + Protocol ── */
        p.push('<div class="sr">');
        if (d.sit) p.push('<span class="sb ' + stCls + '">' + d.sit + '</span>');
        if (d.prot) p.push('<span class="pt"><strong>Protocolo de Autoriza\u00e7\u00e3o:</strong> ' + d.prot + '</span>');
        p.push('</div>');

        /* ── Emission Date ── */
        if (d.dtEmi) {{
            p.push('<div class="dt"><strong>Data de Emiss\u00e3o:</strong> ' + d.dtEmi + '</div>');
        }}

        /* ── Destinatario ── */
        p.push('<div class="se">');
        p.push('<div class="stl">Destinat\u00e1rio / Remetente</div>');
        p.push('<div class="fg">');
        p.push('<div><div class="fl">Raz\u00e3o Social / Nome</div><div class="fv">' + (d.dNome || '-') + '</div></div>');
        p.push('<div><div class="fl">CNPJ/CPF</div><div class="fv">' + (d.dCnpj || '-') + '</div></div>');
        p.push('<div><div class="fl">IE</div><div class="fv">' + (d.dIe || '-') + '</div></div>');
        p.push('</div>');
        if (d.dEnd) {{
            p.push('<div class="fg fgf"><div><div class="fl">Endere\u00e7o</div><div class="fv">' + d.dEnd + '</div></div></div>');
        }}
        p.push('</div>');

        /* ── Valor Total ── */
        if (d.vTotal) {{
            p.push('<div class="vt"><div class="vl">Valor Total da NF-e</div><div class="vv">R$ ' + d.vTotal + '</div></div>');
        }}

        /* ── Footer ── */
        p.push('<div class="ft">Gerado por Util Hub \u2014 Documento auxiliar para visualiza\u00e7\u00e3o. N\u00e3o possui valor fiscal.</div>');
        p.push('</div>');

        /* ── Action bar ── */
        p.push('<div class="act"><button onclick="window.print()">Imprimir DANFE</button></div>');
        p.push('</body></html>');

        document.open();
        document.write(p.join(''));
        document.close();
    }}

    function setupResult() {{
        function attempt() {{
            var body = document.body ? document.body.innerText : '';
            var hasResult = body.indexOf('Emitente') !== -1
                || document.querySelector('input[id*="btnDownload"]')
                || document.querySelector('input[id*="btnVoltar"]');
            if (hasResult) {{
                setTimeout(danfe, 500);
            }} else {{
                setTimeout(attempt, 500);
            }}
        }}
        attempt();
    }}

    /* ══════ INIT ══════ */

    function init() {{
        if (isFormPage()) setupForm();
        else setupResult();
    }}

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
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
