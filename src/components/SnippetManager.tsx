import { useState, useEffect } from "react";
import {
  Copy,
  Plus,
  Trash2,
  Edit2,
  Save,
  MessageSquareText,
  Check,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { cn } from "../lib/cn";

interface Snippet {
  id: string;
  title: string;
  content: string;
}

export function SnippetManager() {
  const [snippets, setSnippets] = useState<Snippet[]>(() => {
    const saved = localStorage.getItem("desktop-util-snippets");
    if (saved) {
      return JSON.parse(saved);
    }
    return [
      {
        id: "1",
        title: "Bom dia",
        content: "Bom dia, tudo bem? Como posso ajudar?",
      },
      {
        id: "2",
        title: "Encerramento",
        content: "Agradecemos o contato. Tenha um ótimo dia!",
      },
    ];
  });
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ title: string; content: string }>({
    title: "",
    content: "",
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Salvar no localStorage sempre que mudar
  useEffect(() => {
    localStorage.setItem("desktop-util-snippets", JSON.stringify(snippets));
  }, [snippets]);

  const handleCopy = async (text: string, id: string) => {
    try {
      await writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Falha ao copiar", err);
    }
  };

  const handleDelete = (id: string) => {
    setSnippets(snippets.filter((s) => s.id !== id));
  };

  const startEdit = (snippet?: Snippet) => {
    if (snippet) {
      setIsEditing(snippet.id);
      setEditForm({ title: snippet.title, content: snippet.content });
    } else {
      setIsEditing("new");
      setEditForm({ title: "", content: "" });
    }
  };

  const saveEdit = () => {
    if (isEditing === "new") {
      const newSnippet: Snippet = {
        id: crypto.randomUUID(),
        title: editForm.title || "Sem título",
        content: editForm.content,
      };
      setSnippets([...snippets, newSnippet]);
    } else {
      setSnippets(
        snippets.map((s) =>
          s.id === isEditing
            ? { ...s, title: editForm.title, content: editForm.content }
            : s,
        ),
      );
    }
    setIsEditing(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 pt-3 pb-3 flex items-center justify-end border-b border-gray-800">
        <button
          onClick={() => startEdit()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          title="Adicionar novo"
        >
          <Plus className="w-3.5 h-3.5" /> Adicionar
        </button>
      </div>

      {isEditing && (
        <div className="px-4 pt-3 pb-3 bg-gray-900/50 border-b border-gray-800">
          <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">
            {isEditing === "new" ? "Novo Texto" : "Editar Texto"}
          </h3>
          <div className="space-y-2">
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
              placeholder="Título (ex: Resposta Cliente)"
              value={editForm.title}
              onChange={(e) =>
                setEditForm({ ...editForm, title: e.target.value })
              }
            />
            <textarea
              className="w-full h-28 resize-none bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200"
              placeholder="Digite o texto aqui..."
              value={editForm.content}
              onChange={(e) =>
                setEditForm({ ...editForm, content: e.target.value })
              }
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsEditing(null)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-all duration-200"
              >
                <Save className="w-3.5 h-3.5" /> Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-3">
        {snippets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-600">
            <MessageSquareText className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">Nenhum texto salvo.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {snippets.map((snippet) => (
              <li
                key={snippet.id}
                className="group px-3 py-2.5 rounded-lg border bg-gray-900 border-gray-800 hover:border-gray-700 transition-all duration-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => handleCopy(snippet.content, snippet.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm text-gray-200 truncate">
                      {snippet.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 font-mono">
                      {snippet.content}
                    </p>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopy(snippet.content, snippet.id)}
                      className={cn(
                        "flex-shrink-0 p-1.5 rounded-md transition-all duration-200",
                        copiedId === snippet.id
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "text-gray-500 hover:text-indigo-400",
                      )}
                      title={copiedId === snippet.id ? "Copiado" : "Copiar"}
                    >
                      {copiedId === snippet.id ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      onClick={() => startEdit(snippet)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-gray-600 hover:text-indigo-400"
                      title="Editar"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(snippet.id)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-gray-600 hover:text-red-400"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
