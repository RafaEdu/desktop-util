import { useState, useEffect } from "react";
import { ClipboardList, Copy, Trash2, Check, Clock } from "lucide-react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { cn } from "../lib/cn";

export function ClipboardHistory() {
  const [history, setHistory] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Inicializa com dados do localStorage
  useEffect(() => {
    const saved = localStorage.getItem("desktop-util-clipboard-history");
    if (saved) {
      setHistory(JSON.parse(saved));
    }
  }, []);

  // Monitoramento do Clipboard (Polling a cada 1s)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const text = await readText();
        if (text && text.trim() !== "") {
          setHistory((prev) => {
            // Se o texto já é o mais recente, não faz nada
            if (prev.length > 0 && prev[0] === text) return prev;

            // Adiciona no topo e limita a 50 itens
            const newHistory = [text, ...prev].slice(0, 50);

            // Persiste
            localStorage.setItem(
              "desktop-util-clipboard-history",
              JSON.stringify(newHistory),
            );
            return newHistory;
          });
        }
      } catch (err) {
        // Ignora erros de leitura (pode não ser texto ou permissão negada momentaneamente)
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleCopy = async (text: string, index: number) => {
    try {
      await writeText(text);
      setCopiedIndex(index);
      // Atualiza o histórico para mover este item para o topo também?
      // O polling vai pegar isso automaticamente no próximo ciclo,
      // então não precisamos forçar a atualização do estado aqui manualmente para evitar duplicatas visuais rápidas.
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch (err) {
      console.error("Erro ao copiar", err);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("desktop-util-clipboard-history");
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-900 rounded-lg border border-gray-800">
      <div className="px-4 pt-3 pb-3 flex items-center justify-between border-b border-gray-800">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-indigo-400" />
          <p className="text-sm font-medium text-gray-200">Histórico (Win+V)</p>
        </div>
        {history.length > 0 && (
          <button
            onClick={clearHistory}
            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Limpar
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-600">
            <Clock className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-xs">O histórico está vazio.</p>
            <p className="text-[10px] opacity-70">
              Copie algo (Ctrl+C) para aparecer aqui.
            </p>
          </div>
        ) : (
          history.map((text, i) => (
            <div
              key={i}
              className="group flex items-center gap-3 p-3 rounded-md bg-gray-800/40 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 transition-all cursor-pointer"
              onClick={() => handleCopy(text, i)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-300 font-mono line-clamp-2 break-all">
                  {text}
                </p>
              </div>
              <button
                className={cn(
                  "p-1.5 rounded-md transition-all opacity-0 group-hover:opacity-100",
                  copiedIndex === i
                    ? "bg-emerald-500/20 text-emerald-400 opacity-100"
                    : "bg-gray-700 text-gray-400 hover:text-white",
                )}
              >
                {copiedIndex === i ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
