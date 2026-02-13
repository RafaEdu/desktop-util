import { useState, useEffect } from "react";
import {
  Copy,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
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
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ title: string; content: string }>({
    title: "",
    content: "",
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Carregar do localStorage ao iniciar
  useEffect(() => {
    const saved = localStorage.getItem("desktop-util-snippets");
    if (saved) {
      setSnippets(JSON.parse(saved));
    } else {
      // Dados iniciais de exemplo
      setSnippets([
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
      ]);
    }
  }, []);

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

  if (isEditing) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h3 className="text-sm font-medium text-gray-200 mb-4">
          {isEditing === "new" ? "Novo Texto" : "Editar Texto"}
        </h3>
        <input
          className="bg-gray-800 border-gray-700 text-gray-200 text-sm rounded-md p-2 mb-3 w-full focus:ring-1 focus:ring-indigo-500 outline-none"
          placeholder="Título (ex: Resposta Cliente)"
          value={editForm.title}
          onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
        />
        <textarea
          className="bg-gray-800 border-gray-700 text-gray-200 text-sm rounded-md p-2 mb-3 w-full h-32 resize-none focus:ring-1 focus:ring-indigo-500 outline-none"
          placeholder="Digite o texto aqui..."
          value={editForm.content}
          onChange={(e) =>
            setEditForm({ ...editForm, content: e.target.value })
          }
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setIsEditing(null)}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={saveEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            <Save className="w-3.5 h-3.5" /> Salvar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-900 rounded-lg border border-gray-800">
      <div className="px-4 pt-3 pb-3 flex items-center justify-between border-b border-gray-800">
        <div className="flex items-center gap-2">
          <MessageSquareText className="w-4 h-4 text-indigo-400" />
          <p className="text-sm font-medium text-gray-200">Textos Prontos</p>
        </div>
        <button
          onClick={() => startEdit()}
          className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          title="Adicionar novo"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {snippets.length === 0 ? (
          <p className="text-center text-gray-500 text-sm mt-10">
            Nenhum texto salvo.
          </p>
        ) : (
          snippets.map((snippet) => (
            <div
              key={snippet.id}
              className="group bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 hover:border-gray-600 rounded-lg p-3 transition-all"
            >
              <div className="flex justify-between items-start mb-2">
                <h4 className="text-sm font-medium text-gray-200">
                  {snippet.title}
                </h4>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(snippet)}
                    className="p-1 text-gray-400 hover:text-indigo-400"
                    title="Editar"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(snippet.id)}
                    className="p-1 text-gray-400 hover:text-red-400"
                    title="Excluir"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 line-clamp-2 mb-3 font-mono bg-gray-900/50 p-1.5 rounded">
                {snippet.content}
              </p>
              <button
                onClick={() => handleCopy(snippet.content, snippet.id)}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-1.5 rounded text-xs font-medium transition-colors border",
                  copiedId === snippet.id
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-gray-700/50 text-gray-300 border-gray-600 hover:bg-gray-700 hover:text-white",
                )}
              >
                {copiedId === snippet.id ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copiar
                  </>
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
