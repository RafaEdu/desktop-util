import { useState } from "react";
import {
  Merge,
  Split,
  Trash2,
  ChevronUp,
  ChevronDown,
  FolderOpen,
  Play,
  Plus,
  FileText,
  Shrink,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { cn } from "../lib/cn";

type PdfTab = "merge" | "split" | "compress";

type SplitMode =
  | "everyPage"
  | "oddPages"
  | "evenPages"
  | "afterPages"
  | "everyN";

export function PdfTools() {
  const [activeTab, setActiveTab] = useState<PdfTab>("merge");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sub-tabs */}
      <div className="px-4 pt-3 pb-2 flex gap-2">
        <button
          onClick={() => setActiveTab("merge")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            activeTab === "merge"
              ? "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30"
              : "text-fg-5 hover:text-fg-3 hover:bg-field",
          )}
        >
          <Merge className="w-3.5 h-3.5" />
          Unir PDF
        </button>
        <button
          onClick={() => setActiveTab("split")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            activeTab === "split"
              ? "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30"
              : "text-fg-5 hover:text-fg-3 hover:bg-field",
          )}
        >
          <Split className="w-3.5 h-3.5" />
          Dividir PDF
        </button>
        <button
          onClick={() => setActiveTab("compress")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            activeTab === "compress"
              ? "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30"
              : "text-fg-5 hover:text-fg-3 hover:bg-field",
          )}
        >
          <Shrink className="w-3.5 h-3.5" />
          Comprimir PDF
        </button>
      </div>

      {activeTab === "merge" ? (
        <MergePdf />
      ) : activeTab === "split" ? (
        <SplitPdf />
      ) : (
        <CompressPdf />
      )}
    </div>
  );
}

// ── Merge PDF ───────────────────────────────────────────────────

function MergePdf() {
  const [files, setFiles] = useState<string[]>([]);
  const [outputName, setOutputName] = useState("merged");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const addFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      setFiles((prev) => [...prev, ...paths]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const moveFile = (index: number, direction: "up" | "down") => {
    setFiles((prev) => {
      const arr = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= arr.length) return arr;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  };

  const executeMerge = async () => {
    setError(null);
    setSuccess(null);

    if (files.length < 2) {
      setError("Selecione pelo menos 2 arquivos PDF.");
      return;
    }

    const savePath = await save({
      defaultPath: `${outputName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!savePath) return;

    setLoading(true);
    try {
      const result = await invoke<string>("merge_pdfs", {
        inputPaths: files,
        outputPath: savePath,
      });
      setSuccess(`PDF salvo em: ${result}`);
      setFiles([]);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      {/* Add files button */}
      <button
        onClick={addFiles}
        className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed border-edge-2 text-fg-4 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
      >
        <Plus className="w-4 h-4" />
        <span className="text-xs font-medium">Adicionar PDFs</span>
      </button>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((file, i) => {
            const name = file.split(/[\\/]/).pop() || file;
            return (
              <div
                key={`${file}-${i}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-edge group"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span
                  className="flex-1 text-xs text-fg-3 truncate"
                  title={file}
                >
                  {name}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => moveFile(i, "up")}
                    disabled={i === 0}
                    className="p-1 rounded text-fg-6 hover:text-fg-3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Mover para cima"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => moveFile(i, "down")}
                    disabled={i === files.length - 1}
                    className="p-1 rounded text-fg-6 hover:text-fg-3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Mover para baixo"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => removeFile(i)}
                    className="p-1 rounded text-fg-6 hover:text-red-400 transition-colors"
                    title="Remover"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Output name */}
      <div className="space-y-1">
        <label className="text-xs text-fg-5">Nome do arquivo de saída</label>
        <input
          type="text"
          value={outputName}
          onChange={(e) => setOutputName(e.target.value)}
          placeholder="merged"
          className="w-full bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
        />
      </div>

      {/* Execute */}
      <button
        onClick={executeMerge}
        disabled={loading || files.length < 2}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors",
          loading || files.length < 2
            ? "bg-field text-fg-6 cursor-not-allowed"
            : "bg-indigo-600 text-white hover:bg-indigo-500",
        )}
      >
        <Play className="w-3.5 h-3.5" />
        {loading ? "Processando..." : "Executar União"}
      </button>

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

// ── Split PDF ───────────────────────────────────────────────────

function SplitPdf() {
  const [file, setFile] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>("everyPage");
  const [afterPages, setAfterPages] = useState("");
  const [everyN, setEveryN] = useState("2");
  const [prefix, setPrefix] = useState("split");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (selected) {
      setFile(Array.isArray(selected) ? selected[0] : selected);
    }
  };

  const buildStrategy = (): Record<string, unknown> | string => {
    switch (splitMode) {
      case "everyPage":
        return "EveryPage";
      case "oddPages":
        return "OddPages";
      case "evenPages":
        return "EvenPages";
      case "afterPages": {
        const pages = afterPages
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0);
        if (pages.length === 0) {
          throw new Error("Informe pelo menos um número de página válido.");
        }
        return { AfterPages: pages };
      }
      case "everyN": {
        const n = parseInt(everyN, 10);
        if (isNaN(n) || n < 1) {
          throw new Error("O valor de 'n' deve ser um número maior que 0.");
        }
        return { EveryNPages: n };
      }
    }
  };

  const executeSplit = async () => {
    setError(null);
    setSuccess(null);

    if (!file) {
      setError("Selecione um arquivo PDF.");
      return;
    }

    let strategy;
    try {
      strategy = buildStrategy();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    const outputDir = await open({ directory: true });
    if (!outputDir) return;

    setLoading(true);
    try {
      const result = await invoke<string[]>("split_pdf", {
        inputPath: file,
        outputDir: Array.isArray(outputDir) ? outputDir[0] : outputDir,
        prefix,
        strategy,
      });
      setSuccess(`${result.length} arquivo(s) gerado(s) com sucesso.`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const splitModes: { id: SplitMode; label: string }[] = [
    { id: "everyPage", label: "Cada página" },
    { id: "oddPages", label: "Páginas ímpares / pares" },
    { id: "evenPages", label: "Páginas pares / ímpares" },
    { id: "afterPages", label: "Após páginas específicas" },
    { id: "everyN", label: "A cada N páginas" },
  ];

  const fileName = file ? file.split(/[\\/]/).pop() || file : null;

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      {/* File selection */}
      <button
        onClick={selectFile}
        className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed border-edge-2 text-fg-4 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
      >
        <FolderOpen className="w-4 h-4" />
        <span className="text-xs font-medium">
          {fileName ? fileName : "Selecionar PDF"}
        </span>
      </button>

      {/* Split strategy */}
      <div className="space-y-1.5">
        <label className="text-xs text-fg-5">Estratégia de divisão</label>
        <div className="space-y-1">
          {splitModes.map((mode) => (
            <label
              key={mode.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                splitMode === mode.id
                  ? "border-indigo-500 bg-indigo-600/10 text-indigo-400"
                  : "border-edge bg-surface text-fg-4 hover:border-edge-2",
              )}
            >
              <input
                type="radio"
                name="splitMode"
                value={mode.id}
                checked={splitMode === mode.id}
                onChange={() => setSplitMode(mode.id)}
                className="sr-only"
              />
              <div
                className={cn(
                  "w-3 h-3 rounded-full border-2 shrink-0",
                  splitMode === mode.id
                    ? "border-indigo-400 bg-indigo-400"
                    : "border-edge-3",
                )}
              />
              <span className="text-xs">{mode.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Conditional inputs */}
      {splitMode === "afterPages" && (
        <div className="space-y-1">
          <label className="text-xs text-fg-5">
            Dividir após as páginas (separado por vírgula)
          </label>
          <input
            type="text"
            value={afterPages}
            onChange={(e) => setAfterPages(e.target.value)}
            placeholder="Ex: 3, 7, 12"
            className="w-full bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
          />
        </div>
      )}

      {splitMode === "everyN" && (
        <div className="space-y-1">
          <label className="text-xs text-fg-5">Páginas por grupo</label>
          <input
            type="number"
            min="1"
            value={everyN}
            onChange={(e) => setEveryN(e.target.value)}
            className="w-full bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
          />
        </div>
      )}

      {/* Prefix */}
      <div className="space-y-1">
        <label className="text-xs text-fg-5">
          Prefixo do nome dos arquivos
        </label>
        <input
          type="text"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="split"
          className="w-full bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
        />
      </div>

      {/* Execute */}
      <button
        onClick={executeSplit}
        disabled={loading || !file}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors",
          loading || !file
            ? "bg-field text-fg-6 cursor-not-allowed"
            : "bg-indigo-600 text-white hover:bg-indigo-500",
        )}
      >
        <Play className="w-3.5 h-3.5" />
        {loading ? "Processando..." : "Executar Divisão"}
      </button>

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

// ── Compress PDF ───────────────────────────────────────────────────

function CompressPdf() {
  const [file, setFile] = useState<string | null>(null);
  const [pdfInfo, setPdfInfo] = useState<{
    size: number;
    page_count: number;
    created: string;
  } | null>(null);
  const [compressionLevel, setCompressionLevel] = useState<
    "low" | "medium" | "high"
  >("medium");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    newSize: number;
    reductionPercent: number;
  } | null>(null);

  const selectFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (selected) {
      const path = Array.isArray(selected) ? selected[0] : selected;
      setFile(path);
      setPdfInfo(null);
      setError(null);
      setSuccess(null);

      // Get PDF info
      try {
        const info = await invoke<{
          size: number;
          page_count: number;
          created: string;
        }>("get_pdf_info", { path });
        setPdfInfo(info);
      } catch (err) {
        setError(String(err));
      }
    }
  };

  const executeCompress = async () => {
    if (!file || !pdfInfo) return;

    const savePath = await save({
      defaultPath: `compressed_${compressionLevel}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!savePath) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const newSize = await invoke<number>("compress_pdf", {
        inputPath: file,
        outputPath: savePath,
        level: compressionLevel,
      });

      const reductionPercent = ((pdfInfo.size - newSize) / pdfInfo.size) * 100;
      setSuccess({ newSize, reductionPercent });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const compressionLevels = [
    {
      id: "low" as const,
      label: "Baixa",
      desc: "Compressão leve, mantém qualidade",
    },
    {
      id: "medium" as const,
      label: "Recomendada",
      desc: "Balanço entre tamanho e qualidade",
    },
    {
      id: "high" as const,
      label: "Extrema",
      desc: "Máxima compressão, pode reduzir qualidade",
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      {/* File selection */}
      <button
        onClick={selectFile}
        className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed border-edge-2 text-fg-4 hover:border-indigo-500 hover:text-indigo-400 transition-colors"
      >
        <FolderOpen className="w-4 h-4" />
        <span className="text-xs font-medium">
          {file ? file.split(/[\\/]/).pop() || file : "Selecionar PDF"}
        </span>
      </button>

      {/* PDF Info */}
      {pdfInfo && (
        <div className="bg-surface border border-edge rounded-lg p-3 space-y-2">
          <h3 className="text-xs font-medium text-fg-3">Informações do PDF</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-fg-5">Tamanho:</span>
              <span className="ml-1 text-fg-2">{formatSize(pdfInfo.size)}</span>
            </div>
            <div>
              <span className="text-fg-5">Páginas:</span>
              <span className="ml-1 text-fg-2">{pdfInfo.page_count}</span>
            </div>
            <div className="col-span-2">
              <span className="text-fg-5">Criado em:</span>
              <span className="ml-1 text-fg-2">{pdfInfo.created}</span>
            </div>
          </div>
        </div>
      )}

      {/* Compression level */}
      <div className="space-y-1.5">
        <label className="text-xs text-fg-5">Nível de Compressão</label>
        <div className="space-y-1">
          {compressionLevels.map((level) => (
            <label
              key={level.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                compressionLevel === level.id
                  ? "border-indigo-500 bg-indigo-600/10 text-indigo-400"
                  : "border-edge bg-surface text-fg-4 hover:border-edge-2",
              )}
            >
              <input
                type="radio"
                name="compressionLevel"
                value={level.id}
                checked={compressionLevel === level.id}
                onChange={() => setCompressionLevel(level.id)}
                className="sr-only"
              />
              <div
                className={cn(
                  "w-3 h-3 rounded-full border-2 shrink-0",
                  compressionLevel === level.id
                    ? "border-indigo-400 bg-indigo-400"
                    : "border-edge-3",
                )}
              />
              <div className="flex-1">
                <span className="text-xs font-medium">{level.label}</span>
                <p className="text-xs text-fg-5">{level.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Execute */}
      <button
        onClick={executeCompress}
        disabled={loading || !file}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors",
          loading || !file
            ? "bg-field text-fg-6 cursor-not-allowed"
            : "bg-indigo-600 text-white hover:bg-indigo-500",
        )}
      >
        <Play className="w-3.5 h-3.5" />
        {loading ? "Comprimindo..." : "Comprimir PDF"}
      </button>

      {/* Results */}
      {success && (
        <div className="bg-emerald-400/10 border border-emerald-500/30 rounded-lg p-3 space-y-2">
          <h3 className="text-xs font-medium text-emerald-400">
            Compressão Concluída
          </h3>
          <div className="text-xs space-y-1">
            <div>
              <span className="text-fg-4">Tamanho original:</span>
              <span className="ml-1 text-fg-2">
                {formatSize(pdfInfo!.size)}
              </span>
            </div>
            <div>
              <span className="text-fg-4">Novo tamanho:</span>
              <span className="ml-1 text-fg-2">
                {formatSize(success.newSize)}
              </span>
            </div>
            <div>
              <span className="text-fg-4">Redução:</span>
              <span className="ml-1 text-emerald-400 font-medium">
                {success.reductionPercent.toFixed(1)}%
              </span>
            </div>
          </div>
          <p className="text-xs text-fg-5">
            Arquivo comprimido salvo com sucesso.
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
