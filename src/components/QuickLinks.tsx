import { useEffect, useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  ExternalLink,
  Link,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { cn } from "../lib/cn";
import { getDb, type QuickLink } from "../lib/db";

export function QuickLinks() {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editUrl, setEditUrl] = useState("");

  const loadLinks = useCallback(async () => {
    try {
      const db = await getDb();
      const rows = await db.select<QuickLink[]>(
        "SELECT * FROM quick_links ORDER BY created_at DESC",
      );
      setLinks(rows);
    } catch (err) {
      console.error("Failed to load links:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const addLink = async () => {
    const t = title.trim();
    let u = url.trim();
    if (!t || !u) return;
    if (!u.startsWith("http://") && !u.startsWith("https://")) {
      u = "https://" + u;
    }
    try {
      const db = await getDb();
      await db.execute("INSERT INTO quick_links (title, url) VALUES (?, ?)", [
        t,
        u,
      ]);
      setTitle("");
      setUrl("");
      await loadLinks();
    } catch (err) {
      console.error("Failed to add link:", err);
    }
  };

  const startEdit = (link: QuickLink) => {
    setEditingId(link.id);
    setEditTitle(link.title);
    setEditUrl(link.url);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
    setEditUrl("");
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    const t = editTitle.trim();
    let u = editUrl.trim();
    if (!t || !u) return;
    if (!u.startsWith("http://") && !u.startsWith("https://")) {
      u = "https://" + u;
    }
    try {
      const db = await getDb();
      await db.execute(
        "UPDATE quick_links SET title = ?, url = ? WHERE id = ?",
        [t, u, editingId],
      );
      cancelEdit();
      await loadLinks();
    } catch (err) {
      console.error("Failed to update link:", err);
    }
  };

  const deleteLink = async (id: number) => {
    try {
      const db = await getDb();
      await db.execute("DELETE FROM quick_links WHERE id = ?", [id]);
      await loadLinks();
    } catch (err) {
      console.error("Failed to delete link:", err);
    }
  };

  const handleOpenLink = async (linkUrl: string) => {
    try {
      await invoke("open_external_link", {
        url: linkUrl,
        mode: "normal",
      });
    } catch (err) {
      console.error("Failed to open link:", err);
    }
  };

  const handleOpenAnonymousLink = async (linkUrl: string) => {
    const chromeApi = (
      globalThis as {
        chrome?: {
          windows?: {
            create?: (options: { url: string; incognito: boolean }) => void;
          };
        };
      }
    ).chrome;

    if (chromeApi?.windows?.create) {
      try {
        chromeApi.windows.create({
          url: linkUrl,
          incognito: true,
        });
        return;
      } catch (err) {
        console.error("Failed to open anonymous link via chrome API:", err);
      }
    }

    try {
      await invoke("open_external_link", {
        url: linkUrl,
        mode: "incognito",
      });
    } catch (err) {
      console.error("Failed to open anonymous link:", err);
      await message(
        "Não foi possível abrir em modo anônimo. Verifique se Edge, Chrome, Brave ou Firefox estão instalados.",
        {
          title: "Falha ao abrir link",
          kind: "error",
        },
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Add Form */}
      <div className="px-4 pt-3 pb-3 bg-surface/50 border-b border-edge">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addLink();
          }}
          className="space-y-2"
        >
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título do link..."
            className="w-full bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm
                       text-fg placeholder-fg-5
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                       transition-all duration-200"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm
                         text-fg placeholder-fg-5
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                         transition-all duration-200"
            />
            <button
              type="submit"
              disabled={!title.trim() || !url.trim()}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                title.trim() && url.trim()
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25"
                  : "bg-field text-fg-6 cursor-not-allowed",
              )}
            >
              <Plus className="w-4 h-4" />
              Adicionar
            </button>
          </div>
        </form>
      </div>

      {/* Links List */}
      <main className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : links.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-fg-6">
            <Link className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">Nenhum link adicionado.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {links.map((link) =>
              editingId === link.id ? (
                <li
                  key={link.id}
                  className="px-3 py-2.5 rounded-lg border bg-surface border-indigo-500/50 transition-all duration-200"
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveEdit();
                    }}
                    className="space-y-2"
                  >
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Título..."
                      autoFocus
                      className="w-full bg-field border border-edge-2 rounded-lg px-3 py-1.5 text-sm
                                 text-fg placeholder-fg-5
                                 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                                 transition-all duration-200"
                    />
                    <input
                      type="text"
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full bg-field border border-edge-2 rounded-lg px-3 py-1.5 text-sm
                                 text-fg placeholder-fg-5
                                 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                                 transition-all duration-200"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium
                                   text-fg-4 hover:text-fg-2 hover:bg-field transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={!editTitle.trim() || !editUrl.trim()}
                        className={cn(
                          "flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
                          editTitle.trim() && editUrl.trim()
                            ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                            : "bg-field text-fg-6 cursor-not-allowed",
                        )}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Salvar
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li
                  key={link.id}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border
                             bg-surface border-edge hover:border-edge-2 transition-all duration-200"
                >
                  <button
                    onClick={() => handleOpenLink(link.url)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm text-fg-2 truncate">{link.title}</p>
                    <p className="text-xs text-fg-5 truncate">{link.url}</p>
                  </button>
                  <button
                    onClick={() => handleOpenLink(link.url)}
                    className="flex-shrink-0 text-fg-5 hover:text-indigo-400 transition-colors"
                    title="Abrir link (Normal)"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleOpenAnonymousLink(link.url)}
                    className="flex-shrink-0 px-2 py-1 rounded-md text-xs font-medium
                               text-fg-3 bg-field hover:bg-subtle hover:text-white transition-colors"
                    title="Abrir link (Anônimo)"
                  >
                    Anônimo
                  </button>
                  <button
                    onClick={() => startEdit(link)}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200
                               text-fg-6 hover:text-amber-400"
                    title="Editar link"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteLink(link.id)}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200
                               text-fg-6 hover:text-red-400"
                    title="Excluir link"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </main>
    </div>
  );
}
