import { useState, useEffect } from "react";
import { Copy, Trash2, Check, Clock } from "lucide-react";
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {history.length > 0 && (
        <div className="px-4 pt-3 pb-3 bg-surface/50 border-b border-edge flex items-center justify-end">
          <button
            onClick={clearHistory}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-fg-4 hover:text-red-400 hover:bg-field transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Limpar
          </button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-3">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-fg-6">
            <Clock className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">O histórico está vazio.</p>
            <p className="text-xs opacity-70">
              Copie algo (Ctrl+C) para aparecer aqui.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {history.map((text, i) => (
              <li
                key={i}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-surface border-edge hover:border-edge-2 transition-all duration-200"
              >
                <button
                  onClick={() => handleCopy(text, i)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-sm text-fg-2 line-clamp-2 break-all font-mono">
                    {text}
                  </p>
                </button>

                <button
                  onClick={() => handleCopy(text, i)}
                  className={cn(
                    "flex-shrink-0 p-1.5 rounded-md transition-all duration-200 opacity-0 group-hover:opacity-100",
                    copiedIndex === i
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 opacity-100"
                      : "text-fg-5 hover:text-indigo-400",
                  )}
                  title={copiedIndex === i ? "Copiado" : "Copiar item"}
                >
                  {copiedIndex === i ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
