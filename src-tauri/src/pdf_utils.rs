use chrono::{DateTime, Utc};
use lopdf::{Document, Object, ObjectId};
use std::collections::BTreeMap;
use std::path::Path;
use underskrift::{
    finalize_signature, prepare_signature, DigestAlgorithm, RemoteSignerInfo, RemoteSigningOptions,
    SignatureAlgorithm, SubFilter,
};

// ── Merge PDFs ──────────────────────────────────────────────────

#[tauri::command]
pub fn merge_pdfs(input_paths: Vec<String>, output_path: String) -> Result<String, String> {
    if input_paths.len() < 2 {
        return Err("Selecione pelo menos 2 arquivos PDF para unir.".into());
    }

    for p in &input_paths {
        if !Path::new(p).exists() {
            return Err(format!("Arquivo não encontrado: {}", p));
        }
    }

    let documents: Vec<Document> = input_paths
        .iter()
        .map(|p| Document::load(p).map_err(|e| format!("Erro ao abrir '{}': {}", p, e)))
        .collect::<Result<Vec<_>, _>>()?;

    let mut max_id = 1;
    let mut documents_pages: Vec<Vec<(ObjectId, Object)>> = Vec::new();
    let mut documents_objects: Vec<BTreeMap<ObjectId, Object>> = Vec::new();

    for mut doc in documents {
        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;

        let pages: Vec<(ObjectId, Object)> = doc
            .get_pages()
            .into_values()
            .map(|object_id| {
                let page = doc.get_object(object_id).cloned().unwrap_or(Object::Null);
                (object_id, page)
            })
            .collect();

        documents_pages.push(pages);
        documents_objects.push(doc.objects);
    }

    let mut merged = Document::with_version("1.5");

    for objects in &documents_objects {
        for (id, object) in objects {
            merged.objects.insert(*id, object.clone());
        }
    }

    let mut catalog_object: Option<(ObjectId, Object)> = None;
    let mut pages_object: Option<(ObjectId, Object)> = None;

    for (id, object) in &merged.objects {
        if let Ok(dict) = object.as_dict() {
            let type_name = dict.get(b"Type").ok().and_then(|t| t.as_name_str().ok());
            match type_name {
                Some("Catalog") => {
                    catalog_object = Some((*id, object.clone()));
                }
                Some("Pages") => {
                    if dict
                        .get(b"Parent")
                        .ok()
                        .and_then(|p| p.as_reference().ok())
                        .is_none()
                    {
                        pages_object = Some((*id, object.clone()));
                    }
                }
                _ => {}
            }
        }
    }

    let catalog_object = catalog_object.ok_or("Não foi possível encontrar o catálogo do PDF.")?;
    let pages_object =
        pages_object.ok_or("Não foi possível encontrar o objeto de páginas do PDF.")?;

    // Collect all page IDs
    let mut all_page_ids: Vec<ObjectId> = Vec::new();
    for pages in &documents_pages {
        for (id, _) in pages {
            all_page_ids.push(*id);
        }
    }

    // Update pages object
    if let Ok(dict) = merged
        .objects
        .get_mut(&pages_object.0)
        .unwrap()
        .as_dict_mut()
    {
        dict.set(
            "Kids",
            all_page_ids
                .iter()
                .map(|id| Object::Reference(*id))
                .collect::<Vec<Object>>(),
        );
        dict.set("Count", Object::Integer(all_page_ids.len() as i64));
    }

    // Update each page's parent
    for page_id in &all_page_ids {
        if let Some(page_obj) = merged.objects.get_mut(page_id) {
            if let Ok(dict) = page_obj.as_dict_mut() {
                dict.set("Parent", Object::Reference(pages_object.0));
            }
        }
    }

    // Update catalog
    if let Ok(dict) = merged
        .objects
        .get_mut(&catalog_object.0)
        .unwrap()
        .as_dict_mut()
    {
        dict.set("Pages", Object::Reference(pages_object.0));
        dict.remove(b"Outlines");
    }

    merged
        .trailer
        .set("Root", Object::Reference(catalog_object.0));
    merged.max_id = max_id;
    merged.renumber_objects();
    merged.compress();

    merged
        .save(&output_path)
        .map_err(|e| format!("Erro ao salvar o PDF: {}", e))?;

    Ok(output_path)
}

// ── Split PDF ───────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub enum SplitStrategy {
    EveryPage,
    OddPages,
    EvenPages,
    AfterPages(Vec<u32>),
    EveryNPages(u32),
}

#[tauri::command]
pub fn split_pdf(
    input_path: String,
    output_dir: String,
    prefix: String,
    strategy: SplitStrategy,
) -> Result<Vec<String>, String> {
    if !Path::new(&input_path).exists() {
        return Err(format!("Arquivo não encontrado: {}", input_path));
    }

    let doc = Document::load(&input_path).map_err(|e| format!("Erro ao abrir o PDF: {}", e))?;

    let page_count = doc.get_pages().len() as u32;
    if page_count == 0 {
        return Err("O PDF não contém páginas.".into());
    }

    // Build groups of page numbers (1-indexed) for each output file
    let groups: Vec<Vec<u32>> = match strategy {
        SplitStrategy::EveryPage => (1..=page_count).map(|p| vec![p]).collect(),
        SplitStrategy::OddPages => {
            let odds: Vec<u32> = (1..=page_count).filter(|p| p % 2 != 0).collect();
            let evens: Vec<u32> = (1..=page_count).filter(|p| p % 2 == 0).collect();
            let mut g = Vec::new();
            if !odds.is_empty() {
                g.push(odds);
            }
            if !evens.is_empty() {
                g.push(evens);
            }
            g
        }
        SplitStrategy::EvenPages => {
            let evens: Vec<u32> = (1..=page_count).filter(|p| p % 2 == 0).collect();
            let odds: Vec<u32> = (1..=page_count).filter(|p| p % 2 != 0).collect();
            let mut g = Vec::new();
            if !evens.is_empty() {
                g.push(evens);
            }
            if !odds.is_empty() {
                g.push(odds);
            }
            g
        }
        SplitStrategy::AfterPages(mut split_points) => {
            split_points.sort();
            split_points.dedup();
            // Validate
            for &sp in &split_points {
                if sp < 1 || sp > page_count {
                    return Err(format!(
                        "Página {} fora do intervalo (1-{}).",
                        sp, page_count
                    ));
                }
            }
            let mut groups = Vec::new();
            let mut start = 1u32;
            for sp in split_points {
                if sp >= start {
                    groups.push((start..=sp).collect());
                    start = sp + 1;
                }
            }
            if start <= page_count {
                groups.push((start..=page_count).collect());
            }
            groups
        }
        SplitStrategy::EveryNPages(n) => {
            if n == 0 {
                return Err("O número de páginas por grupo deve ser maior que 0.".into());
            }
            (1..=page_count)
                .collect::<Vec<u32>>()
                .chunks(n as usize)
                .map(|c| c.to_vec())
                .collect()
        }
    };

    let out_dir = Path::new(&output_dir);
    if !out_dir.exists() {
        std::fs::create_dir_all(out_dir)
            .map_err(|e| format!("Erro ao criar diretório de saída: {}", e))?;
    }

    let mut output_files = Vec::new();

    for (i, page_group) in groups.iter().enumerate() {
        let file_name = format!("{}_{}.pdf", prefix, i + 1);
        let file_path = out_dir.join(&file_name);

        extract_pages(&doc, page_group, &file_path)?;
        output_files.push(file_path.to_string_lossy().into_owned());
    }

    Ok(output_files)
}

fn extract_pages(source: &Document, pages: &[u32], output_path: &Path) -> Result<(), String> {
    let all_pages = source.get_pages();
    let page_count = all_pages.len() as u32;

    // Collect pages to delete (1-indexed page numbers not in our set)
    let pages_to_keep: std::collections::HashSet<u32> = pages.iter().copied().collect();
    let pages_to_delete: Vec<u32> = (1..=page_count)
        .filter(|p| !pages_to_keep.contains(p))
        .collect();

    let mut new_doc = source.clone();
    new_doc.delete_pages(&pages_to_delete);
    new_doc.renumber_objects();
    new_doc.compress();

    new_doc
        .save(output_path)
        .map_err(|e| format!("Erro ao salvar '{}': {}", output_path.display(), e))?;

    Ok(())
}

// ── Get PDF Info ─────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct PdfInfo {
    pub size: u64,
    pub page_count: usize,
    pub created: String,
}

#[tauri::command]
pub fn get_pdf_info(path: String) -> Result<PdfInfo, String> {
    if !Path::new(&path).exists() {
        return Err(format!("Arquivo não encontrado: {}", path));
    }

    let doc = Document::load(&path).map_err(|e| format!("Erro ao abrir o PDF: {}", e))?;
    let page_count = doc.get_pages().len();
    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Erro ao obter metadados: {}", e))?;
    let size = metadata.len();
    let created = metadata
        .created()
        .map_err(|e| format!("Erro ao obter data de criação: {}", e))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Erro na conversão de tempo: {}", e))?
        .as_secs();

    // Formatar data
    let datetime =
        DateTime::<Utc>::from_timestamp(created as i64, 0).ok_or("Erro ao converter timestamp")?;
    let created_str = datetime.format("%d/%m/%Y %H:%M:%S").to_string();

    Ok(PdfInfo {
        size,
        page_count,
        created: created_str,
    })
}

// ── Compress PDF ─────────────────────────────────────────────────

#[tauri::command]
pub fn compress_pdf(input_path: String, output_path: String, level: String) -> Result<u64, String> {
    if !Path::new(&input_path).exists() {
        return Err(format!("Arquivo não encontrado: {}", input_path));
    }

    let mut doc = Document::load(&input_path).map_err(|e| format!("Erro ao abrir o PDF: {}", e))?;

    // Compress based on level
    match level.as_str() {
        "low" => {
            // Low compression: basic compress
            doc.compress();
        }
        "medium" => {
            // Medium: compress and renumber
            doc.compress();
            doc.renumber_objects();
        }
        "high" => {
            // High: compress, renumber, and remove unused objects if possible
            doc.compress();
            doc.renumber_objects();
            // Additional optimization could be added here
        }
        _ => return Err("Nível de compressão inválido".into()),
    }

    doc.save(&output_path)
        .map_err(|e| format!("Erro ao salvar o PDF: {}", e))?;

    let new_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("Erro ao obter tamanho do arquivo comprimido: {}", e))?
        .len();

    Ok(new_size)
}

// ── Real Digital Signature (PAdES) ─────────────────────────────

#[tauri::command]
pub async fn sign_pdf_pades(
    pdf_bytes: Vec<u8>,
    cert_thumbprint: String,
    reason: Option<String>,
    location: Option<String>,
    contact_info: Option<String>,
) -> Result<Vec<u8>, String> {
    #[cfg(not(windows))]
    {
        let _ = (pdf_bytes, cert_thumbprint, reason, location, contact_info);
        return Err("Assinatura PAdES com certificado do sistema disponível apenas no Windows.".into());
    }

    #[cfg(windows)]
    {
        sign_pdf_pades_windows(pdf_bytes, cert_thumbprint, reason, location, contact_info)
    }
}

#[cfg(windows)]
fn sign_pdf_pades_windows(
    pdf_bytes: Vec<u8>,
    cert_thumbprint: String,
    reason: Option<String>,
    location: Option<String>,
    contact_info: Option<String>,
) -> Result<Vec<u8>, String> {
    with_cert_context(&cert_thumbprint, |cert_ctx| {
        let signer_info = build_remote_signer_info(cert_ctx)?;

        let options = RemoteSigningOptions {
            sub_filter: SubFilter::Pades,
            digest_algorithm: DigestAlgorithm::Sha256,
            field_name: format!("Signature{}", Utc::now().timestamp_millis()),
            page: 0,
            reason,
            location,
            contact_info,
            // Reserve extra space for CMS container to keep compatibility
            // with larger certificate chains and avoid malformed output.
            content_size: 65536,
            algorithm_registry: None,
        };

        let prepared = prepare_signature(&pdf_bytes, &signer_info, &options)
            .map_err(|e| format!("Falha ao preparar assinatura PAdES: {e}"))?;

        let signature = sign_hash_with_cert_context(
            cert_ctx,
            &prepared.attrs_hash,
            signer_info.signature_algorithm,
        )?;

        finalize_signature(prepared, &signature)
            .map_err(|e| format!("Falha ao finalizar assinatura PAdES: {e}"))
    })
}

#[cfg(windows)]
fn normalize_thumbprint(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

#[cfg(windows)]
fn with_cert_context<T, F>(thumbprint: &str, f: F) -> Result<T, String>
where
    F: FnOnce(*const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT) -> Result<T, String>,
{
    use windows_sys::Win32::Security::Cryptography::*;

    let normalized = normalize_thumbprint(thumbprint);
    let mut hash_bytes = hex::decode(&normalized)
        .map_err(|_| "Thumbprint do certificado inválido.".to_string())?;

    unsafe {
        let store_name: Vec<u16> = "MY\0".encode_utf16().collect();
        let store = CertOpenSystemStoreW(0, store_name.as_ptr());
        if store.is_null() {
            return Err("Falha ao abrir repositório de certificados do Windows.".into());
        }

        let blob = CRYPT_INTEGER_BLOB {
            cbData: hash_bytes.len() as u32,
            pbData: hash_bytes.as_mut_ptr(),
        };

        let cert_ctx = CertFindCertificateInStore(
            store,
            X509_ASN_ENCODING | PKCS_7_ASN_ENCODING,
            0,
            CERT_FIND_SHA1_HASH,
            &blob as *const _ as *const _,
            std::ptr::null(),
        );

        if cert_ctx.is_null() {
            CertCloseStore(store, 0);
            return Err("Certificado selecionado não foi encontrado no repositório do Windows.".into());
        }

        let result = f(cert_ctx);
        CertFreeCertificateContext(cert_ctx);
        CertCloseStore(store, 0);
        result
    }
}

#[cfg(windows)]
fn build_remote_signer_info(
    cert_ctx: *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT,
) -> Result<RemoteSignerInfo, String> {
    use std::ffi::CStr;

    unsafe {
        let cert_der = std::slice::from_raw_parts(
            (*cert_ctx).pbCertEncoded,
            (*cert_ctx).cbCertEncoded as usize,
        )
        .to_vec();

        let oid_ptr = (*(*cert_ctx).pCertInfo).SubjectPublicKeyInfo.Algorithm.pszObjId;
        if oid_ptr.is_null() {
            return Err("Certificado sem OID de algoritmo de chave pública.".into());
        }

        let oid = CStr::from_ptr(oid_ptr as *const i8)
            .to_string_lossy()
            .to_string();

        let signature_algorithm = match oid.as_str() {
            "1.2.840.113549.1.1.1" => SignatureAlgorithm::RsaPkcs1v15,
            "1.2.840.10045.2.1" => {
                return Err(
                    "Certificados ECDSA ainda não são suportados neste fluxo PAdES. Use um certificado RSA.".into(),
                )
            }
            _ => {
                return Err(format!(
                    "Algoritmo de certificado não suportado para assinatura PAdES: OID {}",
                    oid
                ))
            }
        };

        Ok(RemoteSignerInfo {
            certificate_der: cert_der.clone(),
            chain_der: vec![cert_der],
            digest_algorithm: DigestAlgorithm::Sha256,
            signature_algorithm,
        })
    }
}

#[cfg(windows)]
fn sign_hash_with_cert_context(
    cert_ctx: *const windows_sys::Win32::Security::Cryptography::CERT_CONTEXT,
    hash: &[u8],
    signature_algorithm: SignatureAlgorithm,
) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::*;

    if signature_algorithm != SignatureAlgorithm::RsaPkcs1v15 {
        return Err("Somente assinatura RSA PKCS#1 v1.5 está habilitada neste fluxo.".into());
    }

    unsafe {
        let mut key_handle: usize = 0;
        let mut key_spec: u32 = 0;
        let mut must_free: i32 = 0;

        let acquired = CryptAcquireCertificatePrivateKey(
            cert_ctx,
            CRYPT_ACQUIRE_CACHE_FLAG
                | CRYPT_ACQUIRE_ALLOW_NCRYPT_KEY_FLAG
                | CRYPT_ACQUIRE_PREFER_NCRYPT_KEY_FLAG,
            std::ptr::null_mut(),
            &mut key_handle,
            &mut key_spec,
            &mut must_free,
        );

        if acquired == 0 {
            return Err("Não foi possível obter a chave privada do certificado selecionado.".into());
        }

        // Primeiro tenta CNG para cobrir provedores modernos e chaves legadas
        // retornadas como handle compatível com NCrypt.
        let sign_result = match sign_hash_ncrypt_rsa(key_handle, hash) {
            Ok(signature) => Ok(signature),
            Err(ncrypt_error) => {
                if key_spec == CERT_NCRYPT_KEY_SPEC {
                    Err(format!(
                        "Falha ao assinar com chave NCrypt do certificado: {}",
                        ncrypt_error
                    ))
                } else {
                    sign_hash_capi_rsa(key_handle, key_spec, hash).map_err(|capi_error| {
                        format!(
                            "Falha ao assinar hash com certificado. Tentativa CNG: {}. Tentativa CAPI: {}",
                            ncrypt_error, capi_error
                        )
                    })
                }
            }
        };

        if must_free != 0 {
            if key_spec == CERT_NCRYPT_KEY_SPEC {
                let _ = NCryptFreeObject(key_handle);
            } else {
                let _ = CryptReleaseContext(key_handle, 0);
            }
        }

        sign_result
    }
}

#[cfg(windows)]
fn sign_hash_ncrypt_rsa(key_handle: usize, hash: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::*;

    unsafe {
        let alg_id: Vec<u16> = "SHA256\0".encode_utf16().collect();
        let mut padding_info = BCRYPT_PKCS1_PADDING_INFO {
            pszAlgId: alg_id.as_ptr(),
        };

        let mut sig_len: u32 = 0;
        let status = NCryptSignHash(
            key_handle,
            &mut padding_info as *mut _ as *mut _,
            hash.as_ptr() as *mut u8,
            hash.len() as u32,
            std::ptr::null_mut(),
            0,
            &mut sig_len,
            NCRYPT_PAD_PKCS1_FLAG,
        );

        if status != 0 {
            return Err(format!(
                "Falha ao assinar hash com CNG (NCryptSignHash): código {}",
                status
            ));
        }

        let mut signature = vec![0u8; sig_len as usize];
        let status = NCryptSignHash(
            key_handle,
            &mut padding_info as *mut _ as *mut _,
            hash.as_ptr() as *mut u8,
            hash.len() as u32,
            signature.as_mut_ptr(),
            sig_len,
            &mut sig_len,
            NCRYPT_PAD_PKCS1_FLAG,
        );

        if status != 0 {
            return Err(format!(
                "Falha ao gerar assinatura com CNG: código {}",
                status
            ));
        }

        signature.truncate(sig_len as usize);
        Ok(signature)
    }
}

#[cfg(windows)]
fn sign_hash_capi_rsa(key_handle: usize, key_spec: u32, hash: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Security::Cryptography::*;

    unsafe {
        let mut hash_handle: usize = 0;
        if CryptCreateHash(key_handle, CALG_SHA_256, 0, 0, &mut hash_handle) == 0 {
            let last_error = GetLastError();
            return Err(format!(
                "Falha ao criar contexto de hash para assinatura CAPI (CALG_SHA_256). Código Win32: {}",
                last_error
            ));
        }

        let set_hash_ok =
            CryptSetHashParam(hash_handle, HP_HASHVAL, hash.as_ptr(), 0) != 0;
        if !set_hash_ok {
            let last_error = GetLastError();
            CryptDestroyHash(hash_handle);
            return Err(format!(
                "Falha ao configurar hash para assinatura CAPI (HP_HASHVAL). Código Win32: {}",
                last_error
            ));
        }

        let mut sig_len: u32 = 0;
        let get_len_ok = CryptSignHashW(
            hash_handle,
            key_spec,
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            &mut sig_len,
        ) != 0;

        if !get_len_ok {
            let last_error = GetLastError();
            CryptDestroyHash(hash_handle);
            return Err(format!(
                "Falha ao obter tamanho da assinatura CAPI. Código Win32: {}",
                last_error
            ));
        }

        let mut signature = vec![0u8; sig_len as usize];
        let sign_ok = CryptSignHashW(
            hash_handle,
            key_spec,
            std::ptr::null(),
            0,
            signature.as_mut_ptr(),
            &mut sig_len,
        ) != 0;

        CryptDestroyHash(hash_handle);

        if !sign_ok {
            let last_error = GetLastError();
            return Err(format!(
                "Falha ao assinar hash via CAPI. Código Win32: {}",
                last_error
            ));
        }

        signature.truncate(sig_len as usize);
        // CAPI retorna assinatura RSA em little-endian; PDF/CMS espera big-endian.
        signature.reverse();
        Ok(signature)
    }
}
