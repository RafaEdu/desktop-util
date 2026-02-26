import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  Plus,
  Folder,
  File,
  FileText,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  ChevronRight,
  ArrowLeft,
  MoreVertical,
  Pencil,
  Move,
  Trash2,
  X,
  FolderMinus,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getDb, ClientFolder } from "../lib/db";
import { cn } from "../lib/cn";

interface DirEntry {
  name: string;
  is_dir: boolean;
  size: number;
  modified: string;
  extension: string;
}

type ViewMode = "list" | "explorer";

interface ContextMenuState {
  x: number;
  y: number;
  entry: DirEntry | null;
  fullPath: string;
  isMainList: boolean;
  folderId?: number;
}

function getFileIcon(entry: DirEntry): {
  icon: typeof Folder;
  color: string;
} {
  if (entry.is_dir) return { icon: Folder, color: "text-amber-400" };

  const ext = entry.extension.toLowerCase();
  const pdfExts = ["pdf"];
  const docExts = ["doc", "docx", "txt", "rtf", "odt"];
  const sheetExts = ["xls", "xlsx", "csv", "ods"];
  const imageExts = ["jpg", "jpeg", "png", "gif", "bmp", "svg"];
  const videoExts = ["mp4", "avi", "mkv", "mov", "wmv"];
  const audioExts = ["mp3", "wav", "ogg", "flac"];
  const archiveExts = ["zip", "rar", "7z", "tar", "gz"];

  if (pdfExts.includes(ext)) return { icon: FileText, color: "text-red-400" };
  if (docExts.includes(ext))
    return { icon: FileText, color: "text-blue-400" };
  if (sheetExts.includes(ext))
    return { icon: FileSpreadsheet, color: "text-emerald-400" };
  if (imageExts.includes(ext))
    return { icon: FileImage, color: "text-purple-400" };
  if (videoExts.includes(ext))
    return { icon: FileVideo, color: "text-rose-400" };
  if (audioExts.includes(ext))
    return { icon: FileAudio, color: "text-cyan-400" };
  if (archiveExts.includes(ext))
    return { icon: FileArchive, color: "text-orange-400" };
  return { icon: File, color: "text-gray-400" };
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function ClientManager() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [folders, setFolders] = useState<ClientFolder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Explorer state
  const [currentPath, setCurrentPath] = useState("");
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [dirEntries, setDirEntries] = useState<DirEntry[]>([]);

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [networkFolders, setNetworkFolders] = useState<string[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [addSearch, setAddSearch] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Dialogs
  const [renameDialog, setRenameDialog] = useState<{
    path: string;
    currentName: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moveDialog, setMoveDialog] = useState<{ path: string } | null>(null);
  const [moveFolders, setMoveFolders] = useState<string[]>([]);
  const [deleteDialog, setDeleteDialog] = useState<{
    path: string;
    name: string;
    isDir: boolean;
  } | null>(null);
  const [removeDialog, setRemoveDialog] = useState<{
    id: number;
    name: string;
  } | null>(null);

  // ── Load saved folders from DB ──
  const loadFolders = useCallback(async () => {
    try {
      const db = await getDb();
      const result = await db.select<ClientFolder[]>(
        "SELECT * FROM client_folders ORDER BY folder_name",
      );
      setFolders(result);
    } catch (err) {
      console.error("Failed to load client folders:", err);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  // ── Close context menu on outside click ──
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
    }
    if (contextMenu) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [contextMenu]);

  // ── Open explorer for a folder ──
  const openExplorer = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const entries = await invoke<DirEntry[]>("list_directory", { path });
      setDirEntries(entries);
      setCurrentPath(path);
      setPathHistory([]);
      setViewMode("explorer");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Navigate into a subfolder ──
  const navigateInto = async (folderName: string) => {
    const newPath = `${currentPath}\\${folderName}`;
    setLoading(true);
    setError(null);
    try {
      const entries = await invoke<DirEntry[]>("list_directory", {
        path: newPath,
      });
      setDirEntries(entries);
      setPathHistory((prev) => [...prev, currentPath]);
      setCurrentPath(newPath);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Navigate back ──
  const navigateBack = async () => {
    if (pathHistory.length === 0) {
      setViewMode("list");
      return;
    }
    const prevPath = pathHistory[pathHistory.length - 1];
    setLoading(true);
    setError(null);
    try {
      const entries = await invoke<DirEntry[]>("list_directory", {
        path: prevPath,
      });
      setDirEntries(entries);
      setCurrentPath(prevPath);
      setPathHistory((prev) => prev.slice(0, -1));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Refresh current directory ──
  const refreshDirectory = async () => {
    if (!currentPath) return;
    setLoading(true);
    try {
      const entries = await invoke<DirEntry[]>("list_directory", {
        path: currentPath,
      });
      setDirEntries(entries);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Handle file click ──
  const handleEntryClick = (entry: DirEntry) => {
    if (entry.is_dir) {
      navigateInto(entry.name);
    } else {
      const fullPath = `${currentPath}\\${entry.name}`;
      invoke("open_file", { path: fullPath }).catch((err) =>
        setError(String(err)),
      );
    }
  };

  // ── Open Add Modal ──
  const openAddModal = async () => {
    setAddLoading(true);
    setShowAddModal(true);
    setAddSearch("");
    setSelectedFolders(new Set());
    try {
      const result = await invoke<string[]>("list_network_folders");
      // Filter out already added folders
      const existingPaths = new Set(folders.map((f) => f.folder_path));
      const available = result.filter(
        (name) => !existingPaths.has(`\\\\SRV-ADDS\\Clientes$\\${name}`),
      );
      setNetworkFolders(available);
    } catch (err) {
      setError(String(err));
      setShowAddModal(false);
    } finally {
      setAddLoading(false);
    }
  };

  // ── Save selected folders ──
  const saveSelectedFolders = async () => {
    if (selectedFolders.size === 0) return;
    try {
      const db = await getDb();
      for (const name of selectedFolders) {
        const path = `\\\\SRV-ADDS\\Clientes$\\${name}`;
        await db.execute(
          "INSERT OR IGNORE INTO client_folders (folder_name, folder_path) VALUES (?, ?)",
          [name, path],
        );
      }
      await loadFolders();
      setShowAddModal(false);
    } catch (err) {
      setError(String(err));
    }
  };

  // ── Context menu handler ──
  const handleContextMenu = (
    e: React.MouseEvent,
    entry: DirEntry | null,
    fullPath: string,
    isMainList: boolean,
    folderId?: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      entry,
      fullPath,
      isMainList,
      folderId,
    });
  };

  // ── Rename ──
  const startRename = () => {
    if (!contextMenu) return;
    const name =
      contextMenu.entry?.name || contextMenu.fullPath.split("\\").pop() || "";
    setRenameDialog({ path: contextMenu.fullPath, currentName: name });
    setRenameValue(name);
    setContextMenu(null);
  };

  const executeRename = async () => {
    if (!renameDialog || !renameValue.trim()) return;
    try {
      await invoke("rename_entry", {
        oldPath: renameDialog.path,
        newName: renameValue.trim(),
      });
      // If renaming a saved folder, update DB too
      const oldName = renameDialog.currentName;
      const folder = folders.find((f) => f.folder_path === renameDialog.path);
      if (folder) {
        const db = await getDb();
        const newPath = renameDialog.path.replace(
          new RegExp(`${escapeRegex(oldName)}$`),
          renameValue.trim(),
        );
        await db.execute(
          "UPDATE client_folders SET folder_name = ?, folder_path = ? WHERE id = ?",
          [renameValue.trim(), newPath, folder.id],
        );
        await loadFolders();
      }
      if (viewMode === "explorer") await refreshDirectory();
      setRenameDialog(null);
    } catch (err) {
      setError(String(err));
    }
  };

  // ── Move ──
  const startMove = async () => {
    if (!contextMenu) return;
    setMoveDialog({ path: contextMenu.fullPath });
    setContextMenu(null);
    try {
      const result = await invoke<string[]>("list_network_folders");
      setMoveFolders(result);
    } catch (err) {
      setError(String(err));
      setMoveDialog(null);
    }
  };

  const executeMove = async (destFolderName: string) => {
    if (!moveDialog) return;
    const destPath = `\\\\SRV-ADDS\\Clientes$\\${destFolderName}`;
    try {
      await invoke("move_entry", {
        sourcePath: moveDialog.path,
        destFolder: destPath,
      });
      if (viewMode === "explorer") await refreshDirectory();
      setMoveDialog(null);
    } catch (err) {
      setError(String(err));
    }
  };

  // ── Delete ──
  const startDelete = () => {
    if (!contextMenu) return;
    const name =
      contextMenu.entry?.name || contextMenu.fullPath.split("\\").pop() || "";
    const isDir = contextMenu.entry?.is_dir ?? true;
    setDeleteDialog({ path: contextMenu.fullPath, name, isDir });
    setContextMenu(null);
  };

  const executeDelete = async () => {
    if (!deleteDialog) return;
    try {
      await invoke("delete_entry", {
        path: deleteDialog.path,
        isDir: deleteDialog.isDir,
      });
      if (viewMode === "explorer") await refreshDirectory();
      setDeleteDialog(null);
    } catch (err) {
      setError(String(err));
    }
  };

  // ── Remove from list (DB only) ──
  const startRemoveFromList = () => {
    if (!contextMenu || !contextMenu.folderId) return;
    const name = contextMenu.fullPath.split("\\").pop() || "";
    setRemoveDialog({ id: contextMenu.folderId, name });
    setContextMenu(null);
  };

  const executeRemoveFromList = async () => {
    if (!removeDialog) return;
    try {
      const db = await getDb();
      await db.execute("DELETE FROM client_folders WHERE id = ?", [
        removeDialog.id,
      ]);
      await loadFolders();
      setRemoveDialog(null);
    } catch (err) {
      setError(String(err));
    }
  };

  // ── Breadcrumb ──
  const getBreadcrumbs = () => {
    const base = "\\\\SRV-ADDS\\Clientes$";
    if (!currentPath.toLowerCase().startsWith(base.toLowerCase())) return [];
    const relative = currentPath.slice(base.length);
    const parts = relative.split("\\").filter(Boolean);
    return parts;
  };

  // Filtered folders
  const filteredFolders = folders.filter((f) =>
    f.folder_name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredNetworkFolders = networkFolders.filter((name) =>
    name.toLowerCase().includes(addSearch.toLowerCase()),
  );

  // ── RENDER: List View ──
  if (viewMode === "list") {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search + Add */}
        <div className="px-4 pt-4 pb-2 flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Buscar pasta..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nova Pasta
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 mb-2 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-300"
            >
              <X className="w-3 h-3 inline" />
            </button>
          </div>
        )}

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {filteredFolders.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">
              {folders.length === 0
                ? 'Nenhuma pasta adicionada. Clique em "Nova Pasta" para começar.'
                : "Nenhuma pasta encontrada."}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredFolders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => openExplorer(folder.folder_path)}
                  onContextMenu={(e) =>
                    handleContextMenu(
                      e,
                      null,
                      folder.folder_path,
                      true,
                      folder.id,
                    )
                  }
                  className="w-full flex items-center gap-3 px-3 py-2.5 bg-gray-900 border border-gray-800 rounded-lg hover:border-indigo-500 hover:bg-gray-900/80 transition-all group"
                >
                  <Folder className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div className="flex-1 text-left min-w-0">
                    <p
                      className="text-sm font-medium text-gray-200 truncate"
                      title={folder.folder_name}
                    >
                      {folder.folder_name}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Add Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <h3 className="text-sm font-semibold text-gray-200">
                  Adicionar Pastas de Clientes
                </h3>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-1 text-gray-500 hover:text-gray-300 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-4 pt-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Filtrar pastas..."
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
                {addLoading ? (
                  <p className="text-center text-gray-500 text-sm py-4">
                    Carregando pastas da rede...
                  </p>
                ) : filteredNetworkFolders.length === 0 ? (
                  <p className="text-center text-gray-500 text-sm py-4">
                    Nenhuma pasta disponível.
                  </p>
                ) : (
                  filteredNetworkFolders.map((name) => (
                    <label
                      key={name}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFolders.has(name)}
                        onChange={() => {
                          setSelectedFolders((prev) => {
                            const next = new Set(prev);
                            if (next.has(name)) next.delete(name);
                            else next.add(name);
                            return next;
                          });
                        }}
                        className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                      />
                      <Folder className="w-4 h-4 text-indigo-400" />
                      <span className="text-sm text-gray-300 truncate">
                        {name}
                      </span>
                    </label>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                <span className="text-xs text-gray-500">
                  {selectedFolders.size} selecionada(s)
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={saveSelectedFolders}
                    disabled={selectedFolders.size === 0}
                    className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <ContextMenuOverlay
            contextMenu={contextMenu}
            contextMenuRef={contextMenuRef}
            onRename={startRename}
            onMove={startMove}
            onDelete={startDelete}
            onRemoveFromList={startRemoveFromList}
          />
        )}

        {/* Dialogs */}
        {renameDialog && (
          <RenameDialogComponent
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            onCancel={() => setRenameDialog(null)}
            onConfirm={executeRename}
          />
        )}
        {deleteDialog && (
          <ConfirmDialog
            title="Excluir"
            message={`Tem certeza que deseja excluir "${deleteDialog.name}"? Esta ação não pode ser desfeita.`}
            confirmLabel="Excluir"
            danger
            onCancel={() => setDeleteDialog(null)}
            onConfirm={executeDelete}
          />
        )}
        {removeDialog && (
          <ConfirmDialog
            title="Remover da lista"
            message={`Remover "${removeDialog.name}" da lista? A pasta não será excluída do disco.`}
            confirmLabel="Remover"
            danger={false}
            onCancel={() => setRemoveDialog(null)}
            onConfirm={executeRemoveFromList}
          />
        )}
        {moveDialog && (
          <MoveDialogComponent
            moveFolders={moveFolders}
            onCancel={() => setMoveDialog(null)}
            onSelect={executeMove}
          />
        )}
      </div>
    );
  }

  // ── RENDER: Explorer View ──
  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 text-sm">
        <button
          onClick={navigateBack}
          className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          title="Voltar"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1 text-gray-500 min-w-0 overflow-hidden">
          <span className="text-gray-600 flex-shrink-0">Clientes$</span>
          {breadcrumbs.map((part, i) => (
            <span key={i} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="w-3 h-3 flex-shrink-0 text-gray-700" />
              <span
                className={cn(
                  "truncate",
                  i === breadcrumbs.length - 1
                    ? "text-gray-200 font-medium"
                    : "text-gray-500",
                )}
              >
                {part}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-400">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-300"
          >
            <X className="w-3 h-3 inline" />
          </button>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <p className="text-center text-gray-500 text-sm py-8">
            Carregando...
          </p>
        ) : dirEntries.length === 0 ? (
          <p className="text-center text-gray-500 text-sm py-8">Pasta vazia.</p>
        ) : (
          <div className="space-y-0.5">
            {dirEntries.map((entry) => {
              const { icon: Icon, color: iconColor } = getFileIcon(entry);
              const fullPath = `${currentPath}\\${entry.name}`;
              return (
                <button
                  key={entry.name}
                  onClick={() => handleEntryClick(entry)}
                  onContextMenu={(e) =>
                    handleContextMenu(e, entry, fullPath, false)
                  }
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/50 transition-colors group"
                >
                  <Icon
                    className={cn("w-5 h-5 flex-shrink-0", iconColor)}
                  />
                  <div className="flex-1 text-left min-w-0">
                    <p
                      className="text-sm text-gray-200 truncate"
                      title={entry.name}
                    >
                      {entry.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-300 flex-shrink-0">
                    {!entry.is_dir && (
                      <span className="w-16 text-right">
                        {formatSize(entry.size)}
                      </span>
                    )}
                    <span className="w-28 text-right">{entry.modified}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleContextMenu(e, entry, fullPath, false);
                    }}
                    className="p-1 rounded text-gray-700 opacity-0 group-hover:opacity-100 hover:text-gray-400 hover:bg-gray-700 transition-all"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenuOverlay
          contextMenu={contextMenu}
          contextMenuRef={contextMenuRef}
          onRename={startRename}
          onMove={startMove}
          onDelete={startDelete}
          onRemoveFromList={startRemoveFromList}
        />
      )}

      {/* Dialogs */}
      {renameDialog && (
        <RenameDialogComponent
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          onCancel={() => setRenameDialog(null)}
          onConfirm={executeRename}
        />
      )}
      {deleteDialog && (
        <ConfirmDialog
          title="Excluir"
          message={`Tem certeza que deseja excluir "${deleteDialog.name}"? Esta ação não pode ser desfeita.`}
          confirmLabel="Excluir"
          danger
          onCancel={() => setDeleteDialog(null)}
          onConfirm={executeDelete}
        />
      )}
      {moveDialog && (
        <MoveDialogComponent
          moveFolders={moveFolders}
          onCancel={() => setMoveDialog(null)}
          onSelect={executeMove}
        />
      )}
    </div>
  );
}

// ── Sub-components ──

function ContextMenuOverlay({
  contextMenu,
  contextMenuRef,
  onRename,
  onMove,
  onDelete,
  onRemoveFromList,
}: {
  contextMenu: ContextMenuState;
  contextMenuRef: React.RefObject<HTMLDivElement | null>;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onRemoveFromList: () => void;
}) {
  return (
    <div
      ref={contextMenuRef}
      className="fixed bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
      style={{ top: contextMenu.y, left: contextMenu.x }}
    >
      <button
        onClick={onRename}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-gray-100 transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
        Renomear
      </button>
      <button
        onClick={onMove}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-gray-100 transition-colors"
      >
        <Move className="w-3.5 h-3.5" />
        Mover
      </button>
      <button
        onClick={onDelete}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-gray-700 hover:text-red-300 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Excluir
      </button>
      {contextMenu.isMainList && (
        <>
          <div className="my-1 border-t border-gray-700" />
          <button
            onClick={onRemoveFromList}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors"
          >
            <FolderMinus className="w-3.5 h-3.5" />
            Remover da lista
          </button>
        </>
      )}
    </div>
  );
}

function RenameDialogComponent({
  renameValue,
  setRenameValue,
  onCancel,
  onConfirm,
}: {
  renameValue: string;
  setRenameValue: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm mx-4 p-4">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Renomear</h3>
        <input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onConfirm()}
          autoFocus
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
          >
            Renomear
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm mx-4 p-4">
        <h3 className="text-sm font-semibold text-gray-200 mb-2">{title}</h3>
        <p className="text-sm text-gray-400 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              "px-3 py-1.5 text-sm text-white rounded-lg transition-colors",
              danger
                ? "bg-red-600 hover:bg-red-500"
                : "bg-indigo-600 hover:bg-indigo-500",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function MoveDialogComponent({
  moveFolders,
  onCancel,
  onSelect,
}: {
  moveFolders: string[];
  onCancel: () => void;
  onSelect: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = moveFolders.filter((n) =>
    n.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md mx-4 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200">Mover para...</h3>
          <button
            onClick={onCancel}
            className="p-1 text-gray-500 hover:text-gray-300 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Filtrar destino..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5">
          {filtered.map((name) => (
            <button
              key={name}
              onClick={() => onSelect(name)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Folder className="w-4 h-4 text-indigo-400" />
              <span className="text-sm text-gray-300 truncate">{name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
