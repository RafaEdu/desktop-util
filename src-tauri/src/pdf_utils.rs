use lopdf::{Document, Object, ObjectId};
use std::collections::BTreeMap;
use std::path::Path;
use chrono::{DateTime, Utc};

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
            let type_name = dict
                .get(b"Type")
                .ok()
                .and_then(|t| t.as_name_str().ok());
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

    let catalog_object =
        catalog_object.ok_or("Não foi possível encontrar o catálogo do PDF.")?;
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

    merged.trailer.set("Root", Object::Reference(catalog_object.0));
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

    let doc =
        Document::load(&input_path).map_err(|e| format!("Erro ao abrir o PDF: {}", e))?;

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
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Erro ao obter metadados: {}", e))?;
    let size = metadata.len();
    let created = metadata.created()
        .map_err(|e| format!("Erro ao obter data de criação: {}", e))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Erro na conversão de tempo: {}", e))?
        .as_secs();

    // Formatar data
    let datetime = DateTime::<Utc>::from_timestamp(created as i64, 0)
        .ok_or("Erro ao converter timestamp")?;
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

    doc.save(&output_path).map_err(|e| format!("Erro ao salvar o PDF: {}", e))?;

    let new_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("Erro ao obter tamanho do arquivo comprimido: {}", e))?
        .len();

    Ok(new_size)
}
