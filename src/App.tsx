import { useEffect, useState } from "react";
import { Wrench, Pin, PinOff, Minus } from "lucide-react";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "./lib/cn";
import { showWindowAboveTray } from "./lib/window";
import { Tasks } from "./components/Tasks";
import { Timer } from "./components/Timer";

type Tab = "tasks" | "timer";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("tasks");
  const [movableMode, setMovableMode] = useState(() => {
    return localStorage.getItem("movableMode") === "true";
  });

  // ── Initial window setup on mount ──────────────────────────
  useEffect(() => {
    async function initWindow() {
      const win = getCurrentWindow();
      const initialMovable = localStorage.getItem("movableMode") === "true";

      // Sync state to Rust backend
      await invoke("set_movable_mode", { enabled: initialMovable });

      if (initialMovable) {
        await win.setDecorations(true);
        const savedPos = localStorage.getItem("windowPosition");
        if (savedPos) {
          const { x, y } = JSON.parse(savedPos);
          await win.setPosition(new PhysicalPosition(x, y));
        }
      } else {
        await win.setDecorations(false);
        await showWindowAboveTray();
        return; // showWindowAboveTray already calls show + setFocus
      }

      await win.show();
      await win.setFocus();
    }
    initWindow();
  }, []);

  // ── Save position when moved (movable mode) ───────────────
  useEffect(() => {
    if (!movableMode) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win
      .onMoved(({ payload }) => {
        localStorage.setItem(
          "windowPosition",
          JSON.stringify({ x: payload.x, y: payload.y }),
        );
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [movableMode]);

  // ── Toggle movable mode ────────────────────────────────────
  const toggleMovableMode = async () => {
    const newMode = !movableMode;
    setMovableMode(newMode);
    localStorage.setItem("movableMode", String(newMode));

    const win = getCurrentWindow();
    await win.setDecorations(newMode);
    await invoke("set_movable_mode", { enabled: newMode });

    if (!newMode) {
      // Switching to pinned: reposition above tray
      await showWindowAboveTray();
    }
  };

  // ── Hide window (minimize to tray) ─────────────────────────
  const hideWindow = async () => {
    const win = getCurrentWindow();
    await win.hide();
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-indigo-400" />
            <h1 className="text-lg font-bold tracking-tight">Util</h1>
          </div>

          {/* Tabs */}
          <nav className="flex gap-1">
            {(["tasks", "timer"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  activeTab === tab
                    ? "bg-indigo-600 text-white"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800",
                )}
              >
                {tab === "tasks" ? "Tarefas" : "Timer"}
              </button>
            ))}
          </nav>

          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={toggleMovableMode}
              className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              title={movableMode ? "Fixar na bandeja" : "Modo livre"}
            >
              {movableMode ? (
                <PinOff className="w-4 h-4" />
              ) : (
                <Pin className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={hideWindow}
              className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              title="Minimizar para bandeja"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      {activeTab === "tasks" ? <Tasks /> : <Timer />}

      {/* Footer */}
      <footer className="px-4 py-2 bg-gray-900 border-t border-gray-800">
        <p className="text-xs text-gray-600 text-center">
          Clique no ícone da bandeja para mostrar/ocultar
        </p>
      </footer>
    </div>
  );
}

export default App;
