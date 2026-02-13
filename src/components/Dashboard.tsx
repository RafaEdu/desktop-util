import { useState } from "react";
import {
  Link,
  ShieldCheck,
  Activity,
  Scissors,
  Star,
  FileSearch,
  FileStack,
  ListTodo,
  Timer as TimerIcon,
  MessageSquareText, // Novo ícone
  ClipboardList, // Novo ícone
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../lib/cn";

// Adicionadas as novas views: 'snippets' e 'clipboard'
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
  | "clipboard";

interface DashboardCard {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  view?: View;
  action?: () => void;
}

interface DashboardProps {
  onNavigate: (view: View) => void;
}

const FAVORITES_KEY = "dashboard_favorites";

function getFavorites(): string[] {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [favorites, setFavorites] = useState<string[]>(getFavorites);

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((f) => f !== id)
        : [...prev, id];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleScreenCapture = async () => {
    try {
      await invoke("start_screen_capture");
    } catch (err) {
      console.error("Screen capture failed:", err);
    }
  };

  // Adicionado cards para "Textos Prontos" e "Histórico (Win+V)"
  const cards: DashboardCard[] = [
    {
      id: "tasks",
      title: "Tarefas",
      description: "Gerenciar tarefas",
      icon: ListTodo,
      view: "tasks",
    },
    {
      id: "snippets",
      title: "Textos Prontos",
      description: "Copiar respostas rápidas",
      icon: MessageSquareText,
      view: "snippets",
    },
    {
      id: "clipboard",
      title: "Histórico (Win+V)",
      description: "Gerenciar área de transferência",
      icon: ClipboardList,
      view: "clipboard",
    },
    {
      id: "timer",
      title: "Relógio",
      description: "Cronômetro e contagem regressiva",
      icon: TimerIcon,
      view: "timer",
    },
    {
      id: "links",
      title: "Links Rápidos",
      description: "Acesso rápido a sites",
      icon: Link,
      view: "links",
    },
    {
      id: "certificates",
      title: "Certificados",
      description: "Certificados digitais",
      icon: ShieldCheck,
      view: "certificates",
    },
    {
      id: "status",
      title: "Status de Serviços",
      description: "Monitorar serviços gov",
      icon: Activity,
      view: "status",
    },
    {
      id: "nfe",
      title: "Consulta NFe",
      description: "Visualizar DANFE",
      icon: FileSearch,
      view: "nfe",
    },
    {
      id: "capture",
      title: "Captura de Tela",
      description: "Recorte (Win+Shift+S)",
      icon: Scissors,
      action: handleScreenCapture,
    },
    {
      id: "pdf",
      title: "Ferramentas de PDF",
      description: "Unir, dividir e comprimir",
      icon: FileStack,
      view: "pdf",
    },
  ];

  const sorted = [...cards].sort((a, b) => {
    const aFav = favorites.includes(a.id) ? 0 : 1;
    const bFav = favorites.includes(b.id) ? 0 : 1;
    return aFav - bFav;
  });

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        {sorted.map((card) => {
          const Icon = card.icon;
          const isFav = favorites.includes(card.id);
          return (
            <button
              key={card.id}
              onClick={() => {
                if (card.action) card.action();
                else if (card.view) onNavigate(card.view);
              }}
              className={cn(
                "relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200",
                "bg-gray-900 border-gray-800 hover:border-indigo-500 hover:bg-gray-900/80",
                "group text-left",
              )}
            >
              {/* Favorite toggle */}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(card.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    toggleFavorite(card.id);
                  }
                }}
                className={cn(
                  "absolute top-2 right-2 p-1 rounded transition-all duration-200",
                  isFav
                    ? "text-amber-400"
                    : "text-gray-700 opacity-0 group-hover:opacity-100 hover:text-amber-400",
                )}
                title={
                  isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"
                }
              >
                <Star className={cn("w-3.5 h-3.5", isFav && "fill-current")} />
              </span>

              <Icon className="w-8 h-8 text-indigo-400" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-200">
                  {card.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {card.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
