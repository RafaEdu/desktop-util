import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, ExternalLink, Link } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "../lib/cn";
import { getDb, type QuickLink } from "../lib/db";

export function QuickLinks() {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);

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
      await db.execute(
        "INSERT INTO quick_links (title, url) VALUES (?, ?)",
        [t, u],
      );
      setTitle("");
      setUrl("");
      await loadLinks();
    } catch (err) {
      console.error("Failed to add link:", err);
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
      await openUrl(linkUrl);
    } catch (err) {
      console.error("Failed to open link:", err);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Add Form */}
      <div className="px-4 pt-3 pb-3 bg-gray-900/50 border-b border-gray-800">
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
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                       text-gray-100 placeholder-gray-500
                       focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                       transition-all duration-200"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                         text-gray-100 placeholder-gray-500
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
                  : "bg-gray-800 text-gray-600 cursor-not-allowed",
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
          <div className="flex flex-col items-center justify-center h-32 text-gray-600">
            <Link className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">Nenhum link adicionado.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {links.map((link) => (
              <li
                key={link.id}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border
                           bg-gray-900 border-gray-800 hover:border-gray-700 transition-all duration-200"
              >
                <button
                  onClick={() => handleOpenLink(link.url)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-sm text-gray-200 truncate">
                    {link.title}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{link.url}</p>
                </button>
                <button
                  onClick={() => handleOpenLink(link.url)}
                  className="flex-shrink-0 text-gray-500 hover:text-indigo-400 transition-colors"
                  title="Abrir link"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
                <button
                  onClick={() => deleteLink(link.id)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200
                             text-gray-600 hover:text-red-400"
                  title="Excluir link"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
