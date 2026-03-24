import { useCallback, useRef, useState } from "react";
import { FileArchive, Trash2, PackagePlus, File } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { cn } from "../lib/cn";

interface FileEntry {
  path: string;
  name: string;
}

export function ZipCreator() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const addPaths = useCallback((paths: string[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      const newEntries = paths
        .filter((p) => !existing.has(p))
        .map((p) => ({
          path: p,
          name: p.split(/[\\/]/).pop() || p,
        }));
      return [...prev, ...newEntries];
    });
    setError(null);
    setSuccess(null);
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
    setSuccess(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      dropZoneRef.current &&
      !dropZoneRef.current.contains(e.relatedTarget as Node)
    ) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const paths: string[] = [];
    for (const item of Array.from(e.dataTransfer.files)) {
      // In Tauri, the file path is accessible via the webkitRelativePath or
      // via the DataTransfer API exposed by Tauri's webview
      const filePath = (item as File & { path?: string }).path;
      if (filePath) {
        paths.push(filePath);
      }
    }
    if (paths.length > 0) {
      addPaths(paths);
    }
  };

  const handleCreateZip = async () => {
    setError(null);
    setSuccess(null);

    if (files.length === 0) {
      setError("Adicione pelo menos um arquivo antes de compactar.");
      return;
    }

    const savePath = await save({
      defaultPath: "arquivo.zip",
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (!savePath) return;

    setLoading(true);
    try {
      const result = await invoke<string>("create_zip", {
        filePaths: files.map((f) => f.path),
        outputPath: savePath,
      });
      setSuccess(`Arquivo salvo em: ${result}`);
      setFiles([]);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Drop zone + file list */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 flex flex-col gap-3">
        {/* Drag & drop area */}
        <div
          ref={dropZoneRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "w-full flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed transition-colors",
            isDragOver
              ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
              : "border-edge-2 bg-subtle text-fg-5 hover:border-indigo-400 hover:text-indigo-400",
          )}
        >
          <FileArchive className="w-8 h-8" />
          <p className="text-xs font-medium text-center">
            Arraste arquivos aqui para adicioná-los ao ZIP
          </p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-1.5">
            {files.map((file, i) => (
              <div
                key={`${file.path}-${i}`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-edge group"
              >
                <File className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span
                  className="flex-1 text-xs text-fg-3 truncate"
                  title={file.path}
                >
                  {file.name}
                </span>
                <button
                  onClick={() => removeFile(i)}
                  className="p-1 rounded text-fg-6 hover:text-red-400 transition-colors"
                  title="Remover arquivo"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Feedback messages */}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-xs text-green-400">
            {success}
          </div>
        )}
      </div>

      {/* Fixed bottom button */}
      <div className="px-4 py-3 bg-surface border-t border-edge">
        <button
          onClick={handleCreateZip}
          disabled={loading}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors",
            loading
              ? "bg-indigo-600/40 text-indigo-300 cursor-not-allowed"
              : "bg-indigo-600 hover:bg-indigo-500 text-white",
          )}
        >
          <PackagePlus className="w-4 h-4" />
          {loading ? "Gerando arquivo..." : "Gerar arquivo compactado"}
        </button>
      </div>
    </div>
  );
}
