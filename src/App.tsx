import { useEffect, useState } from "react";
import {
  Wrench,
  Pin,
  PinOff,
  Minus,
  ArrowLeft,
  Sun,
  Moon,
  GripVertical,
  LayoutDashboard,
  ListTodo,
  Link as LinkIcon,
  ShieldCheck,
  Activity,
  FileStack,
  PenLine,
  MessageSquareText,
  ClipboardList,
  PackageOpen,
  Timer as TimerIcon,
} from "lucide-react";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { showWindowAboveTray } from "./lib/window";
import { Dashboard } from "./components/Dashboard";
import { QuickLinks } from "./components/QuickLinks";
import { Certificates } from "./components/Certificates";
import { ServiceStatus } from "./components/ServiceStatus";
import { PdfTools } from "./components/PdfTools";
import { PdfSignTool } from "./components/PdfSignTool";
import { Tasks } from "./components/Tasks";
import { Timer } from "./components/Timer";
import { SnippetManager } from "./components/SnippetManager";
import { ClipboardHistory } from "./components/ClipboardHistory";
import { ZipCreator } from "./components/ZipCreator";
import { useTheme } from "./lib/theme";
import { cn } from "./lib/cn";

type View =
  | "dashboard"
  | "tools"
  | "tasks"
  | "timer"
  | "links"
  | "certificates"
  | "status"
  | "pdf"
  | "pdf-sign"
  | "snippets"
  | "clipboard"
  | "compressor";

type ViewMode = "compact" | "window";

const VIEW_TITLES: Record<View, string> = {
  dashboard: "Adcontec Útil",
  tools: "Ferramentas",
  tasks: "Tarefas",
  timer: "Relógio",
  links: "Links Rápidos",
  certificates: "Certificados",
  status: "Status de Serviços",
  pdf: "Ferramentas de PDF",
  "pdf-sign": "Assinar PDF",
  snippets: "Textos Prontos",
  clipboard: "Histórico (Win+V)",
  compressor: "Criar Arquivo Compactado",
};

const SIDEBAR_ITEMS: { view: View; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "tasks", label: "Tarefas", icon: ListTodo },
  { view: "snippets", label: "Textos Prontos", icon: MessageSquareText },
  { view: "clipboard", label: "Histórico (Win+V)", icon: ClipboardList },
  { view: "timer", label: "Relógio", icon: TimerIcon },
  { view: "links", label: "Links Rápidos", icon: LinkIcon },
  { view: "certificates", label: "Certificados", icon: ShieldCheck },
  { view: "status", label: "Status de Serviços", icon: Activity },
  { view: "pdf", label: "Ferramentas de PDF", icon: FileStack },
  { view: "pdf-sign", label: "Assinar PDF", icon: PenLine },
  { view: "compressor", label: "Criar ZIP", icon: PackageOpen },
];

function App() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [movableMode, setMovableMode] = useState(() => {
    return localStorage.getItem("movableMode") === "true";
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem("viewMode");
    return stored === "window" ? "window" : "compact";
  });
  const [layoutEditMode, setLayoutEditMode] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (activeView !== "dashboard") {
      setLayoutEditMode(false);
    }
  }, [activeView]);

  // ── Initial window setup on mount ──────────────────────────
  useEffect(() => {
    async function initWindow() {
      const win = getCurrentWindow();
      const initialViewMode: ViewMode = (() => {
        const stored = localStorage.getItem("viewMode");
        return stored === "window" ? "window" : "compact";
      })();

      if (initialViewMode === "window") {
        await invoke("set_view_mode", { mode: "window" });
        await win.show();
        await win.setFocus();
        return;
      }

      // Compact mode: follow existing movable/pinned logic
      const initialMovable = localStorage.getItem("movableMode") === "true";
      await invoke("set_movable_mode", { enabled: initialMovable });

      if (initialMovable) {
        await win.setDecorations(true);
        const savedPos = localStorage.getItem("windowPosition");
        if (savedPos) {
          const { x, y } = JSON.parse(savedPos);
          await win.setPosition(new PhysicalPosition(x, y));
        }
        await win.show();
        await win.setFocus();
      } else {
        await win.setDecorations(false);
        await showWindowAboveTray();
      }
    }
    initWindow();
  }, []);

  // ── Save position when moved (movable mode) ───────────────
  useEffect(() => {
    if (!movableMode || viewMode !== "compact") return;
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
  }, [movableMode, viewMode]);

  // ── Listen for tray restore (always go compact) ────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen("restore-compact-mode", () => {
        setViewMode("compact");
        setMovableMode(false);
        localStorage.setItem("viewMode", "compact");
        localStorage.setItem("movableMode", "false");
        invoke("set_movable_mode", { enabled: false });
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  // ── Toggle movable mode (compact only) ────────────────────
  const toggleMovableMode = async () => {
    const newMode = !movableMode;
    setMovableMode(newMode);
    localStorage.setItem("movableMode", String(newMode));

    const win = getCurrentWindow();
    await win.setDecorations(newMode);
    await invoke("set_movable_mode", { enabled: newMode });

    if (!newMode) {
      await showWindowAboveTray();
    }
  };

  // ── Toggle view mode (compact <-> window) ─────────────────
  const toggleViewMode = async () => {
    const newMode: ViewMode = viewMode === "compact" ? "window" : "compact";
    setViewMode(newMode);
    localStorage.setItem("viewMode", newMode);

    await invoke("set_view_mode", { mode: newMode });

    if (newMode === "compact") {
      setMovableMode(false);
      localStorage.setItem("movableMode", "false");
      await invoke("set_movable_mode", { enabled: false });
      await showWindowAboveTray();
    }
  };

  // ── Hide window (minimize to tray - compact only) ──────────
  const hideWindow = async () => {
    const win = getCurrentWindow();
    await win.hide();
  };

  const renderContent = () => {
    switch (activeView) {
      case "dashboard":
        return <Dashboard onNavigate={setActiveView} isEditMode={layoutEditMode} viewMode={viewMode} />;
      case "tasks":
        return <Tasks />;
      case "timer":
        return <Timer />;
      case "links":
        return <QuickLinks />;
      case "certificates":
        return <Certificates />;
      case "status":
        return <ServiceStatus />;
      case "pdf":
        return <PdfTools />;
      case "pdf-sign":
        return <PdfSignTool />;
      case "snippets":
        return <SnippetManager />;
      case "clipboard":
        return <ClipboardHistory />;
      case "compressor":
        return <ZipCreator />;
      default:
        return null;
    }
  };

  // ── Compact Mode ──────────────────────────────────────────
  if (viewMode === "compact") {
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
              <h1 className="text-lg font-bold tracking-tight text-fg">
                {VIEW_TITLES[activeView]}
              </h1>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1">
              {/* View mode slider toggle */}
              <button
                onClick={toggleViewMode}
                className="relative w-12 h-6 rounded-full bg-field border border-edge-2 hover:bg-subtle transition-colors duration-200"
                title="Alternar modo de visualização"
              >
                <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-accent shadow-sm" />
              </button>

              {activeView === "dashboard" && (
                <button
                  onClick={() => setLayoutEditMode((prev) => !prev)}
                  className="p-1.5 rounded text-fg-5 hover:text-fg-3 hover:bg-field transition-colors"
                  title={
                    layoutEditMode
                      ? "Finalizar reorganização"
                      : "Reorganizar cards"
                  }
                >
                  <GripVertical
                    className={layoutEditMode ? "w-4 h-4 text-accent" : "w-4 h-4"}
                  />
                </button>
              )}
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
        {renderContent()}

        {/* Footer */}
        <footer className="px-4 py-2 bg-surface border-t border-edge">
          <p className="text-xs text-fg-6 text-center">
            Clique no ícone da bandeja para mostrar/ocultar
          </p>
        </footer>
      </div>
    );
  }

  // ── Window Mode ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-base text-fg flex flex-col">
      {/* Toolbar */}
      <header className="bg-surface border-b border-edge px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-accent" />
            <h1 className="text-base font-bold tracking-tight text-fg">
              {VIEW_TITLES[activeView]}
            </h1>
          </div>

          <div className="flex items-center gap-1">
            {activeView === "dashboard" && (
              <button
                onClick={() => setLayoutEditMode((prev) => !prev)}
                className="p-1.5 rounded text-fg-5 hover:text-fg-3 hover:bg-field transition-colors"
                title={
                  layoutEditMode
                    ? "Finalizar reorganização"
                    : "Reorganizar cards"
                }
              >
                <GripVertical
                  className={layoutEditMode ? "w-4 h-4 text-accent" : "w-4 h-4"}
                />
              </button>
            )}
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
            {/* View mode slider toggle */}
            <button
              onClick={toggleViewMode}
              className="relative w-12 h-6 rounded-full bg-field border border-edge-2 hover:bg-subtle transition-colors duration-200"
              title="Alternar para modo compacto"
            >
              <span className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-accent shadow-sm" />
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 bg-surface border-r border-edge flex flex-col overflow-y-auto flex-shrink-0">
          <nav className="flex-1 py-2">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.view;
              return (
                <button
                  key={item.view}
                  onClick={() => setActiveView(item.view)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-150",
                    isActive
                      ? "bg-accent/15 text-accent border-r-2 border-accent"
                      : "text-fg-4 hover:text-fg-2 hover:bg-field",
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Sidebar footer placeholder for future tools */}
          <div className="px-3 py-2 border-t border-edge">
            <p className="text-xs text-fg-6 italic">Mais ferramentas em breve...</p>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          {renderContent()}
        </main>
      </div>

      {/* Footer */}
      <footer className="px-4 py-1.5 bg-surface border-t border-edge">
        <p className="text-xs text-fg-6 text-center">
          Modo janela — redimensione livremente
        </p>
      </footer>
    </div>
  );
}

export default App;
