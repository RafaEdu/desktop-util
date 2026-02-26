import { useEffect, useState } from "react";
import { Wrench, Pin, PinOff, Minus, ArrowLeft, Sun, Moon } from "lucide-react";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { showWindowAboveTray } from "./lib/window";
import { Dashboard } from "./components/Dashboard";
import { QuickLinks } from "./components/QuickLinks";
import { Certificates } from "./components/Certificates";
import { ServiceStatus } from "./components/ServiceStatus";
import { NfeQuery } from "./components/NfeQuery";
import { PdfTools } from "./components/PdfTools";
import { Tasks } from "./components/Tasks";
import { Timer } from "./components/Timer";
import { SnippetManager } from "./components/SnippetManager";
import { ClipboardHistory } from "./components/ClipboardHistory";
import { ClientManager } from "./components/ClientManager";
import { useTheme } from "./lib/theme";

type View =
  | "dashboard"
  | "tools"
  | "tasks"
  | "timer"
  | "links"
  | "certificates"
  | "status"
  | "nfe"
  | "pdf"
  | "snippets"
  | "clipboard"
  | "clients";

const VIEW_TITLES: Record<View, string> = {
  dashboard: "Adcontec Útil",
  tools: "Ferramentas",
  tasks: "Tarefas",
  timer: "Relógio",
  links: "Links Rápidos",
  certificates: "Certificados",
  status: "Status de Serviços",
  nfe: "Consulta NFe",
  pdf: "Ferramentas de PDF",
  snippets: "Textos Prontos",
  clipboard: "Histórico (Win+V)",
  clients: "Pasta Clientes",
};

function App() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [movableMode, setMovableMode] = useState(() => {
    return localStorage.getItem("movableMode") === "true";
  });
  const { theme, toggleTheme } = useTheme();

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
    <div className="min-h-screen bg-base text-fg flex flex-col">
      {/* Header */}
      <header className="bg-surface border-b border-edge px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {activeView !== "dashboard" ? (
              <button
                onClick={() => setActiveView("dashboard")}
                className="p-1 rounded text-fg-4 hover:text-fg-2 hover:bg-field transition-colors"
                title="Voltar ao Dashboard"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <Wrench className="w-5 h-5 text-accent" />
            )}
            <h1 className="text-lg font-bold tracking-tight">
              {VIEW_TITLES[activeView]}
            </h1>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={toggleMovableMode}
              className="p-1.5 rounded text-fg-5 hover:text-fg-3 hover:bg-field transition-colors"
              title={movableMode ? "Fixar na bandeja" : "Modo livre"}
            >
              {movableMode ? (
                <PinOff className="w-4 h-4" />
              ) : (
                <Pin className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded text-fg-5 hover:text-fg-3 hover:bg-field transition-colors"
              title={theme === "dark" ? "Modo claro" : "Modo escuro"}
            >
              {theme === "dark" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={hideWindow}
              className="p-1.5 rounded text-fg-5 hover:text-fg-3 hover:bg-field transition-colors"
              title="Minimizar para bandeja"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      {activeView === "dashboard" && <Dashboard onNavigate={setActiveView} />}
      {activeView === "tasks" && <Tasks />}
      {activeView === "timer" && <Timer />}
      {activeView === "links" && <QuickLinks />}
      {activeView === "certificates" && <Certificates />}
      {activeView === "status" && <ServiceStatus />}
      {activeView === "nfe" && <NfeQuery />}
      {activeView === "pdf" && <PdfTools />}
      {activeView === "snippets" && <SnippetManager />}
      {activeView === "clipboard" && <ClipboardHistory />}
      {activeView === "clients" && <ClientManager />}

      {/* Footer */}
      <footer className="px-4 py-2 bg-surface border-t border-edge">
        <p className="text-xs text-fg-6 text-center">
          Clique no ícone da bandeja para mostrar/ocultar
        </p>
      </footer>
    </div>
  );
}

export default App;
