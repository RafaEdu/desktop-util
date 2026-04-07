import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Save,
  Move,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import { PDFDocument, rgb } from "pdf-lib";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../lib/cn";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const SIGNATURE_WIDTH = 160;
const SIGNATURE_HEIGHT = 64;
const SIGNATURE_OFFSET = 20;
const SIGNATURE_ASPECT_RATIO = SIGNATURE_WIDTH / SIGNATURE_HEIGHT;
const MIN_SIGNATURE_WIDTH = 60;
const MIN_SIGNATURE_FONT_SIZE = 3;

type SignaturePlacement = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  renderedWidth: number;
  renderedHeight: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type PageSize = {
  width: number;
  height: number;
};

type DragOffset = {
  x: number;
  y: number;
};

type ResizeState = {
  mouseX: number;
  startWidth: number;
};

type CertInfo = {
  subject: string;
  issuer: string;
  not_after: string;
  thumbprint: string;
  cnpj: string;
};

type TauriDroppedFile = globalThis.File & { path?: string };

function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) {
    return null;
  }

  let path = decodeURIComponent(uri.replace("file://", ""));

  if (path.startsWith("/")) {
    path = path.slice(1);
  }

  return path.replace(/\//g, "\\");
}

function truncateText(input: string, maxLength: number) {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, Math.max(0, maxLength - 1))}…`;
}

function wrapTextByChars(input: string, maxCharsPerLine: number) {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized || maxCharsPerLine <= 1) {
    return [truncateText(normalized || input, Math.max(1, maxCharsPerLine))];
  }

  const lines: string[] = [];
  const words = normalized.split(" ");
  let currentLine = "";

  const pushWord = (word: string) => {
    if (word.length <= maxCharsPerLine) {
      lines.push(word);
      return;
    }

    for (let index = 0; index < word.length; index += maxCharsPerLine) {
      lines.push(word.slice(index, index + maxCharsPerLine));
    }
  };

  for (const word of words) {
    if (!currentLine) {
      if (word.length <= maxCharsPerLine) {
        currentLine = word;
      } else {
        pushWord(word);
      }
      continue;
    }

    const candidate = `${currentLine} ${word}`;
    if (candidate.length <= maxCharsPerLine) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    if (word.length <= maxCharsPerLine) {
      currentLine = word;
    } else {
      currentLine = "";
      pushWord(word);
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [truncateText(normalized, maxCharsPerLine)];
}

function toPdfSafeAscii(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSignatureBoxLines(
  signer: string,
  cnpj: string,
  signedAtLabel: string,
  maxCharsPerLine: number,
  maxLines: number,
) {
  const safeSigner = toPdfSafeAscii(signer) || "Nao identificado";
  const safeCnpj = toPdfSafeAscii(cnpj) || "Nao informado";
  const safeDate = toPdfSafeAscii(signedAtLabel) || "Nao informado";
  const wrappedSigner = wrapTextByChars(safeSigner, maxCharsPerLine);
  const cnpjAndDate = `${safeCnpj} | ${safeDate}`;

  if (maxLines <= 1) {
    return [
      truncateText(
        `${safeSigner} | ${safeCnpj} | ${safeDate}`,
        maxCharsPerLine,
      ),
    ];
  }

  if (maxLines >= wrappedSigner.length + 2) {
    return [
      ...wrappedSigner,
      truncateText(safeCnpj, maxCharsPerLine),
      truncateText(safeDate, maxCharsPerLine),
    ];
  }

  if (maxLines >= wrappedSigner.length + 1) {
    return [...wrappedSigner, truncateText(cnpjAndDate, maxCharsPerLine)];
  }

  const signerLineBudget = Math.max(1, maxLines - 1);
  const signerLines = wrappedSigner.slice(0, signerLineBudget);
  if (wrappedSigner.length > signerLineBudget) {
    const overflowSigner = wrappedSigner.slice(signerLineBudget - 1).join(" ");
    signerLines[signerLineBudget - 1] = truncateText(
      overflowSigner,
      maxCharsPerLine,
    );
  }

  return [...signerLines, truncateText(cnpjAndDate, maxCharsPerLine)];
}

export function PdfSignTool() {
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageWidth, setPageWidth] = useState(320);
  const [pageSize, setPageSize] = useState<PageSize | null>(null);
  const [placement, setPlacement] = useState<SignaturePlacement | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [savingPdf, setSavingPdf] = useState(false);
  const [loadingCerts, setLoadingCerts] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [selectedThumbprint, setSelectedThumbprint] = useState("");
  const [showCertModal, setShowCertModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const viewerRef = useRef<HTMLDivElement | null>(null);
  const dropZoneRef = useRef<HTMLButtonElement | null>(null);
  const pageLayerRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<DragOffset>({ x: 0, y: 0 });
  const resizeStateRef = useRef<ResizeState>({ mouseX: 0, startWidth: 0 });

  const pdfPreviewBytes = useMemo(
    () => (pdfBytes ? new Uint8Array(pdfBytes) : null),
    [pdfBytes],
  );
  const pdfDocumentFile = useMemo(
    () => (pdfPreviewBytes ? { data: pdfPreviewBytes } : null),
    [pdfPreviewBytes],
  );

  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < numPages;
  const selectedCert = useMemo(
    () => certs.find((cert) => cert.thumbprint === selectedThumbprint) ?? null,
    [certs, selectedThumbprint],
  );
  const canSign = Boolean(pdfBytes && placement && !savingPdf);

  const currentFileName = pdfPath
    ? pdfPath.split(/[\\/]/).pop() || pdfPath
    : null;

  const loadCertificates = useCallback(async () => {
    setLoadingCerts(true);
    try {
      const data = await invoke<CertInfo[]>("get_certificates");
      setCerts(data);
      setSelectedThumbprint((prev) => {
        if (prev && data.some((cert) => cert.thumbprint === prev)) {
          return prev;
        }

        return data[0]?.thumbprint ?? "";
      });
    } catch (err) {
      setError(`Falha ao carregar certificados: ${String(err)}`);
    } finally {
      setLoadingCerts(false);
    }
  }, []);

  const loadPdfFromPath = useCallback(async (selectedPath: string) => {
    setLoadingPdf(true);
    try {
      const bytes = await readFile(selectedPath);
      setPdfPath(selectedPath);
      // Keep original bytes for signing and use a dedicated clone for preview.
      setPdfBytes(new Uint8Array(bytes));
      setNumPages(0);
      setCurrentPage(1);
      setPageSize(null);
      setPlacement(null);
      setError(null);
      setSuccess(null);
    } catch (err) {
      setError(`Falha ao ler o PDF selecionado: ${String(err)}`);
    } finally {
      setLoadingPdf(false);
    }
  }, []);

  const placeSignatureInCurrentPage = useCallback(() => {
    if (!pageSize) {
      return;
    }

    const maxX = Math.max(0, pageSize.width - SIGNATURE_WIDTH);
    const maxY = Math.max(0, pageSize.height - SIGNATURE_HEIGHT);

    setPlacement({
      page: currentPage,
      x: clamp(SIGNATURE_OFFSET, 0, maxX),
      y: clamp(SIGNATURE_OFFSET, 0, maxY),
      width: SIGNATURE_WIDTH,
      height: SIGNATURE_HEIGHT,
      renderedWidth: pageSize.width,
      renderedHeight: pageSize.height,
    });
  }, [currentPage, pageSize]);

  useEffect(() => {
    if (!pageSize || placement) {
      return;
    }

    placeSignatureInCurrentPage();
  }, [pageSize, placement, placeSignatureInCurrentPage]);

  const updatePageSize = useCallback(() => {
    const layer = pageLayerRef.current;
    if (!layer) {
      return;
    }

    const canvas = layer.querySelector("canvas");
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const nextSize = { width: rect.width, height: rect.height };
    setPageSize(nextSize);

    setPlacement((prev) => {
      if (!prev || prev.page !== currentPage) {
        return prev;
      }

      const maxWidthFromCurrentPos = Math.max(40, nextSize.width - prev.x);
      const maxWidthFromHeight = Math.max(
        40,
        (nextSize.height - prev.y) * SIGNATURE_ASPECT_RATIO,
      );
      const maxAllowedWidth = Math.min(
        maxWidthFromCurrentPos,
        maxWidthFromHeight,
      );
      const width = Math.min(prev.width, maxAllowedWidth);
      const height = width / SIGNATURE_ASPECT_RATIO;
      const maxX = Math.max(0, nextSize.width - width);
      const maxY = Math.max(0, nextSize.height - height);

      return {
        ...prev,
        x: clamp(prev.x, 0, maxX),
        y: clamp(prev.y, 0, maxY),
        width,
        height,
        renderedWidth: nextSize.width,
        renderedHeight: nextSize.height,
      };
    });
  }, [currentPage]);

  useEffect(() => {
    const root = viewerRef.current;
    if (!root) {
      return;
    }

    const resize = () => {
      const nextWidth = Math.max(220, Math.floor(root.clientWidth - 26));
      setPageWidth(nextWidth);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(updatePageSize, 60);
    return () => {
      window.clearTimeout(timer);
    };
  }, [currentPage, pageWidth, pdfBytes, updatePageSize]);

  useEffect(() => {
    if (!dragging && !resizing) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      if (!pageSize) {
        return;
      }

      const layerRect = pageLayerRef.current?.getBoundingClientRect();
      if (!layerRect) {
        return;
      }

      setPlacement((prev) => {
        if (!prev || prev.page !== currentPage) {
          return prev;
        }

        if (resizing) {
          const deltaX = event.clientX - resizeStateRef.current.mouseX;
          const candidateWidth = resizeStateRef.current.startWidth + deltaX;
          const maxWidthFromX = Math.max(40, pageSize.width - prev.x);
          const maxWidthFromY = Math.max(
            40,
            (pageSize.height - prev.y) * SIGNATURE_ASPECT_RATIO,
          );
          const maxWidth = Math.min(maxWidthFromX, maxWidthFromY);
          const width = clamp(candidateWidth, MIN_SIGNATURE_WIDTH, maxWidth);

          return {
            ...prev,
            width,
            height: width / SIGNATURE_ASPECT_RATIO,
            renderedWidth: pageSize.width,
            renderedHeight: pageSize.height,
          };
        }

        const maxX = Math.max(0, pageSize.width - prev.width);
        const maxY = Math.max(0, pageSize.height - prev.height);

        return {
          ...prev,
          x: clamp(
            event.clientX - layerRect.left - dragOffsetRef.current.x,
            0,
            maxX,
          ),
          y: clamp(
            event.clientY - layerRect.top - dragOffsetRef.current.y,
            0,
            maxY,
          ),
          renderedWidth: pageSize.width,
          renderedHeight: pageSize.height,
        };
      });
    };

    const onMouseUp = () => {
      setDragging(false);
      setResizing(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [currentPage, dragging, pageSize, resizing]);

  const handleOpenPdf = async () => {
    setError(null);
    setSuccess(null);

    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!selected) {
      return;
    }

    const selectedPath = Array.isArray(selected) ? selected[0] : selected;

    await loadPdfFromPath(selectedPath);
  };

  const handleDragOver = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (
      dropZoneRef.current &&
      !dropZoneRef.current.contains(event.relatedTarget as Node)
    ) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    setError(null);
    setSuccess(null);

    const paths: string[] = [];
    for (const item of Array.from(event.dataTransfer.files)) {
      const filePath = (item as TauriDroppedFile).path;
      if (filePath) {
        paths.push(filePath);
      }
    }

    if (paths.length === 0) {
      const uriList = event.dataTransfer.getData("text/uri-list");
      if (uriList) {
        const uriPaths = uriList
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
          .map(fileUriToPath)
          .filter((value): value is string => Boolean(value));

        paths.push(...uriPaths);
      }
    }

    if (paths.length === 0) {
      setError(
        "Nao foi possivel identificar o arquivo arrastado. Clique para selecionar o PDF.",
      );
      return;
    }

    const selectedPdfPath = paths.find((path) => /\.pdf$/i.test(path));
    if (!selectedPdfPath) {
      setError("Arraste um arquivo PDF valido.");
      return;
    }

    await loadPdfFromPath(selectedPdfPath);
  };

  const handleSignatureMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (!placement || placement.page !== currentPage) {
      return;
    }

    const layerRect = pageLayerRef.current?.getBoundingClientRect();
    if (!layerRect) {
      return;
    }

    event.preventDefault();
    dragOffsetRef.current = {
      x: event.clientX - layerRect.left - placement.x,
      y: event.clientY - layerRect.top - placement.y,
    };
    setDragging(true);
  };

  const handleResizeMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (!placement || placement.page !== currentPage) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      mouseX: event.clientX,
      startWidth: placement.width,
    };
    setResizing(true);
  };

  const handleClickSign = () => {
    if (!pdfBytes || !placement) {
      setError("Abra um PDF e posicione a assinatura antes de salvar.");
      return;
    }

    setError(null);
    setSuccess(null);
    setShowCertModal(true);

    if (certs.length === 0 && !loadingCerts) {
      void loadCertificates();
    }
  };

  const handleConfirmCertificateAndSign = async () => {
    setError(null);
    setSuccess(null);

    if (!pdfBytes || !placement) {
      setError("Abra um PDF e posicione a assinatura antes de salvar.");
      return;
    }

    if (!selectedCert) {
      setError("Selecione um certificado para continuar.");
      return;
    }

    setShowCertModal(false);

    const inputName = (currentFileName || "documento").replace(/\.pdf$/i, "");
    const savePath = await save({
      defaultPath: `${inputName}_assinado.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!savePath) {
      return;
    }

    setSavingPdf(true);
    try {
      const signedAt = new Date();
      const signedAtLabel = signedAt.toLocaleString("pt-BR");
      const cnpj = selectedCert.cnpj?.trim()
        ? selectedCert.cnpj
        : "Nao informado";

      const pdfDoc = await PDFDocument.load(pdfBytes);
      if (placement.page < 1 || placement.page > pdfDoc.getPageCount()) {
        throw new Error(
          "Pagina selecionada para assinatura nao existe no documento.",
        );
      }

      const targetPage = pdfDoc.getPage(placement.page - 1);
      const pageSizeInPdf = targetPage.getSize();

      const scaleX = pageSizeInPdf.width / placement.renderedWidth;
      const scaleY = pageSizeInPdf.height / placement.renderedHeight;
      const signatureX = placement.x * scaleX;
      const signatureY =
        pageSizeInPdf.height - (placement.y + placement.height) * scaleY;
      const signatureWidth = placement.width * scaleX;
      const signatureHeight = placement.height * scaleY;

      const padding = Math.max(
        2,
        Math.min(signatureWidth, signatureHeight) * 0.06,
      );
      const availableWidth = Math.max(10, signatureWidth - padding * 2);
      const availableHeight = Math.max(8, signatureHeight - padding * 2);

      let fontSize = clamp(
        Math.floor(signatureHeight / 5.5),
        MIN_SIGNATURE_FONT_SIZE,
        10,
      );
      let lineHeight = fontSize + 1.5;
      let maxLinesByHeight = Math.max(
        1,
        Math.floor(availableHeight / lineHeight),
      );
      while (maxLinesByHeight < 3 && fontSize > MIN_SIGNATURE_FONT_SIZE) {
        fontSize -= 1;
        lineHeight = fontSize + 1.1;
        maxLinesByHeight = Math.max(
          1,
          Math.floor(availableHeight / lineHeight),
        );
      }

      const maxCharsPerLine = Math.max(
        10,
        Math.floor(availableWidth / (fontSize * 0.52)),
      );
      const lines = buildSignatureBoxLines(
        selectedCert.subject,
        cnpj,
        signedAtLabel,
        maxCharsPerLine,
        maxLinesByHeight,
      );

      let textY = signatureY + signatureHeight - padding - fontSize;
      for (const [index, line] of lines.entries()) {
        if (textY < signatureY + padding) {
          break;
        }

        targetPage.drawText(line, {
          x: signatureX + padding,
          y: textY,
          size: fontSize,
          color: index === 0 ? rgb(0.18, 0.18, 0.18) : rgb(0.28, 0.28, 0.28),
        });

        textY -= lineHeight;
      }

      pdfDoc.setSubject(
        `Assinatura por ${selectedCert.subject} - CNPJ ${cnpj} - ${signedAt.toISOString()}`,
      );
      pdfDoc.setKeywords([
        "assinatura-digital",
        "pades",
        "certificado-selecionado",
        selectedCert.thumbprint,
        cnpj,
      ]);

      const visualSignedBytes = await pdfDoc.save({ useObjectStreams: false });

      const safeSigner =
        toPdfSafeAscii(selectedCert.subject) || "Nao identificado";
      const safeCnpj = toPdfSafeAscii(cnpj) || "Nao informado";
      const safeSignedAtLabel =
        toPdfSafeAscii(signedAtLabel) || signedAt.toISOString();

      const padesSignedArray = await invoke<number[]>("sign_pdf_pades", {
        pdfBytes: Array.from(visualSignedBytes),
        certThumbprint: selectedCert.thumbprint,
        reason: `Assinado por ${safeSigner}; CNPJ: ${safeCnpj}; Data/Hora: ${safeSignedAtLabel}`,
        location: "Adcontec Util Desktop",
        contactInfo: toPdfSafeAscii(selectedCert.thumbprint),
      });

      await writeFile(savePath, new Uint8Array(padesSignedArray));
      setSuccess(`PDF assinado digitalmente (PAdES) salvo em: ${savePath}`);
    } catch (err) {
      setError(`Falha ao assinar digitalmente o PDF: ${String(err)}`);
    } finally {
      setSavingPdf(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      <button
        ref={dropZoneRef}
        onClick={handleOpenPdf}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => void handleDrop(event)}
        disabled={loadingPdf}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed transition-colors",
          loadingPdf
            ? "border-edge-2 text-fg-6 cursor-not-allowed"
            : isDragOver
              ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
              : "border-edge-2 text-fg-4 hover:border-indigo-500 hover:text-indigo-400",
        )}
      >
        <FolderOpen className="w-4 h-4" />
        <span className="text-xs font-medium">
          {loadingPdf
            ? "Carregando PDF..."
            : isDragOver
              ? "Solte o PDF aqui"
              : "Arraste um PDF aqui ou clique para selecionar"}
        </span>
      </button>

      {currentFileName && (
        <div className="bg-surface border border-edge rounded-lg px-3 py-2">
          <p className="text-xs text-fg-5">Arquivo selecionado</p>
          <p
            className="text-xs text-fg-2 truncate"
            title={pdfPath || undefined}
          >
            {currentFileName}
          </p>
        </div>
      )}

      {pdfBytes && (
        <div className="space-y-3">
          <div className="bg-surface border border-edge rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-fg-4">Pagina para assinatura visual</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={!canGoPrev}
                  className="p-1 rounded text-fg-5 hover:text-fg-3 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Pagina anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-fg-3 min-w-16 text-center">
                  {currentPage} / {numPages || "?"}
                </span>
                <button
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(numPages, prev + 1))
                  }
                  disabled={!canGoNext}
                  className="p-1 rounded text-fg-5 hover:text-fg-3 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Proxima pagina"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              ref={viewerRef}
              className="min-h-[320px] rounded-lg border border-edge bg-base flex items-center justify-center overflow-auto p-2"
            >
              <div
                ref={pageLayerRef}
                className="relative inline-block select-none"
              >
                <Document
                  file={pdfDocumentFile || undefined}
                  loading={
                    <p className="text-xs text-fg-5">Renderizando PDF...</p>
                  }
                  onLoadSuccess={(doc) => {
                    setNumPages(doc.numPages);
                    setCurrentPage(1);
                    setPlacement(null);
                    setError(null);
                    setSuccess(null);
                  }}
                  onLoadError={(err) => {
                    setError(`Falha ao renderizar PDF: ${String(err)}`);
                  }}
                >
                  <Page
                    pageNumber={currentPage}
                    width={pageWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onRenderSuccess={updatePageSize}
                  />
                </Document>

                {placement && placement.page === currentPage && (
                  <div
                    onMouseDown={handleSignatureMouseDown}
                    className={cn(
                      "absolute rounded cursor-grab px-2 py-1.5 text-slate-800 font-semibold",
                      dragging ? "cursor-grabbing" : "",
                    )}
                    style={{
                      left: placement.x,
                      top: placement.y,
                      width: placement.width,
                      height: placement.height,
                      fontSize: clamp(
                        Math.floor(placement.height / 5.2),
                        5,
                        10,
                      ),
                      lineHeight: 1.15,
                    }}
                  >
                    <p className="truncate">Nome de quem assinou</p>
                    <p className="truncate opacity-90">CNPJ/CPF</p>
                    <p className="truncate opacity-90">
                      Data e hora da assinatura
                    </p>
                  </div>
                )}

                {placement && placement.page === currentPage && (
                  <button
                    type="button"
                    onMouseDown={handleResizeMouseDown}
                    className="absolute w-3.5 h-3.5 rounded-sm bg-indigo-500 border border-white shadow"
                    style={{
                      left: placement.x + placement.width - 7,
                      top: placement.y + placement.height - 7,
                      cursor: "nwse-resize",
                    }}
                    title="Redimensionar assinatura"
                  />
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-fg-5">
                {placement ? (
                  <span>
                    Assinatura na pagina {placement.page} em X:{" "}
                    {Math.round(placement.x)} / Y: {Math.round(placement.y)} /
                    W: {Math.round(placement.width)}
                  </span>
                ) : (
                  <span>Posicione a assinatura para continuar.</span>
                )}
              </div>

              <button
                onClick={placeSignatureInCurrentPage}
                disabled={!pageSize}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                  pageSize
                    ? "bg-field text-fg-3 hover:bg-edge"
                    : "bg-field text-fg-6 cursor-not-allowed",
                )}
              >
                <Move className="w-3.5 h-3.5" />
                Usar pagina atual
              </button>
            </div>
          </div>

          <button
            onClick={handleClickSign}
            disabled={!canSign}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors",
              canSign
                ? "bg-indigo-600 text-white hover:bg-indigo-500"
                : "bg-field text-fg-6 cursor-not-allowed",
            )}
          >
            <Save className="w-3.5 h-3.5" />
            {savingPdf ? "Assinando..." : "Assinar e Salvar PDF"}
          </button>
        </div>
      )}

      {showCertModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-edge-2 bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-fg-2">
                  Selecionar Certificado
                </h3>
              </div>
              <button
                onClick={() => setShowCertModal(false)}
                className="p-1 rounded text-fg-5 hover:text-fg-3 hover:bg-field"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-fg-5">
              Escolha o certificado para a assinatura digital criptográfica
              (PAdES).
            </p>

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-fg-5">Certificados disponíveis</p>
              <button
                onClick={() => void loadCertificates()}
                disabled={loadingCerts}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors",
                  loadingCerts
                    ? "text-fg-6 bg-field cursor-not-allowed"
                    : "text-fg-3 bg-field hover:bg-edge",
                )}
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", loadingCerts && "animate-spin")}
                />
                Atualizar
              </button>
            </div>

            <select
              value={selectedThumbprint}
              onChange={(event) => setSelectedThumbprint(event.target.value)}
              className="w-full bg-field border border-edge-2 rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              {certs.length === 0 ? (
                <option value="">Nenhum certificado carregado</option>
              ) : (
                certs.map((cert) => (
                  <option key={cert.thumbprint} value={cert.thumbprint}>
                    {truncateText(cert.subject, 65)}
                  </option>
                ))
              )}
            </select>

            {selectedCert && (
              <div className="rounded-lg border border-edge bg-base px-3 py-2 text-[11px] space-y-1">
                <p className="text-fg-4 truncate" title={selectedCert.subject}>
                  Titular: {selectedCert.subject}
                </p>
                <p
                  className="text-fg-5 truncate"
                  title={selectedCert.cnpj || ""}
                >
                  CNPJ: {selectedCert.cnpj || "Nao informado"}
                </p>
                <p
                  className="text-fg-6 truncate"
                  title={selectedCert.thumbprint}
                >
                  Thumbprint: {selectedCert.thumbprint}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setShowCertModal(false)}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-field text-fg-3 hover:bg-edge transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleConfirmCertificateAndSign()}
                disabled={loadingCerts || !selectedCert || savingPdf}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  loadingCerts || !selectedCert || savingPdf
                    ? "bg-field text-fg-6 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-500",
                )}
              >
                Confirmar e Assinar
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {success && (
        <p className="text-xs text-emerald-400 bg-emerald-400/10 rounded-lg px-3 py-2">
          {success}
        </p>
      )}
    </div>
  );
}
