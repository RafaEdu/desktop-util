import { useEffect, useMemo, useState, type PointerEvent } from "react";
import {
  Link,
  ShieldCheck,
  Activity,
  Scissors,
  Star,
  GripVertical,
  FileStack,
  ListTodo,
  Timer as TimerIcon,
  MessageSquareText, // Novo ícone
  ClipboardList, // Novo ícone
  Archive,
  ArchiveRestore,
  ChevronDown,
  PackageOpen,
  PenLine,
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
  | "pdf"
  | "pdf-sign"
  | "snippets"
  | "clipboard"
  | "compressor";

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
  isEditMode: boolean;
  viewMode: "compact" | "window";
}

const FAVORITES_KEY = "dashboard_favorites";
const CARD_ORDER_KEY = "dashboard_card_order";
const ARCHIVED_KEY = "dashboard_archived";

function getFavorites(): string[] {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function getCardOrder(): string[] {
  try {
    const stored = localStorage.getItem(CARD_ORDER_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function getArchivedCards(): string[] {
  try {
    const stored = localStorage.getItem(ARCHIVED_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function normalizeOrder(order: string[], cardIds: string[]): string[] {
  const unique = [...new Set(order)];
  const known = unique.filter((id) => cardIds.includes(id));
  const missing = cardIds.filter((id) => !known.includes(id));
  return [...known, ...missing];
}

export function Dashboard({ onNavigate, isEditMode, viewMode }: DashboardProps) {
  const [favorites, setFavorites] = useState<string[]>(getFavorites);
  const [cardOrder, setCardOrder] = useState<string[]>(getCardOrder);
  const [archivedCards, setArchivedCards] =
    useState<string[]>(getArchivedCards);
  const [showUnarchiveConfirm, setShowUnarchiveConfirm] = useState<
    string | null
  >(null);
  const [isArchiveDropZoneHovered, setIsArchiveDropZoneHovered] =
    useState(false);
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [isPointerDragging, setIsPointerDragging] = useState(false);
  const [dragPointer, setDragPointer] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPlacement, setDragPlacement] = useState<"before" | "after">(
    "before",
  );

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((f) => f !== id)
        : [...prev, id];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const archiveCard = (id: string) => {
    setArchivedCards((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      localStorage.setItem(ARCHIVED_KEY, JSON.stringify(next));
      return next;
    });
  };

  const unarchiveCard = (id: string) => {
    setArchivedCards((prev) => {
      const next = prev.filter((cardId) => cardId !== id);
      localStorage.setItem(ARCHIVED_KEY, JSON.stringify(next));
      return next;
    });
    setShowUnarchiveConfirm(null);
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
    {
      id: "pdf-sign",
      title: "Assinar PDF",
      description: "Assinar documentos PDF",
      icon: PenLine,
      view: "pdf-sign",
    },
    {
      id: "compressor",
      title: "Criar ZIP",
      description: "Criar arquivos compactados",
      icon: PackageOpen,
      view: "compressor",
    },
  ];

  const cardIds = useMemo(() => cards.map((card) => card.id), [cards]);
  const normalizedOrder = useMemo(
    () => normalizeOrder(cardOrder, cardIds),
    [cardOrder, cardIds],
  );

  useEffect(() => {
    const changed = normalizedOrder.join("|") !== cardOrder.join("|");
    if (!changed) return;
    setCardOrder(normalizedOrder);
    localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(normalizedOrder));
  }, [cardOrder, normalizedOrder]);

  const updateOrder = (next: string[]) => {
    setCardOrder(next);
    localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next));
  };

  const clearDragState = () => {
    setDraggingId(null);
    setDragOverId(null);
    setIsPointerDragging(false);
    setDragOffset({ x: 0, y: 0 });
    setDragPlacement("before");
  };

  const applyReorderFromDrag = (
    sourceId: string,
    targetId: string,
    placement: "before" | "after",
  ) => {
    if (!sourceId || sourceId === targetId) {
      return;
    }

    const orderIndex = new Map(normalizedOrder.map((id, index) => [id, index]));
    const sortedIds = [...cardIds].sort(
      (a, b) =>
        (favorites.includes(a) ? 0 : 1) - (favorites.includes(b) ? 0 : 1) ||
        (orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER),
    );

    if (!sortedIds.includes(sourceId) || !sortedIds.includes(targetId)) {
      return;
    }

    const sourceIsFavorite = favorites.includes(sourceId);
    const targetIsFavorite = favorites.includes(targetId);

    const withoutSource = sortedIds.filter((id) => id !== sourceId);
    let insertIndex = withoutSource.indexOf(targetId);
    if (insertIndex < 0) {
      insertIndex = withoutSource.length;
    } else if (placement === "after") {
      insertIndex += 1;
    }

    if (!sourceIsFavorite && targetIsFavorite) {
      // Excecao pedida: nao favorito nao ocupa posicao de favorito.
      insertIndex = withoutSource.filter((id) => favorites.includes(id)).length;
    }

    const next = [...withoutSource];
    next.splice(insertIndex, 0, sourceId);
    updateOrder(next);
  };

  const getCardIdFromPoint = (x: number, y: number): string | null => {
    const element = document.elementFromPoint(x, y);
    const cardElement = element?.closest("[data-card-id]");
    if (!cardElement) return null;
    return cardElement.getAttribute("data-card-id");
  };

  const handlePointerDown = (
    id: string,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (!isEditMode) return;
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    setDragOffset({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    setDragPointer({ x: event.clientX, y: event.clientY });

    setDraggingId(id);
    setDragOverId(id);
    setDragPlacement("before");
    setIsPointerDragging(true);
  };

  useEffect(() => {
    if (!isEditMode || !isPointerDragging || !draggingId) return;

    const isOverArchiveZone = (x: number, y: number): boolean => {
      const archiveZone = document.querySelector('[data-archive-zone="true"]');
      if (!archiveZone) return false;
      const rect = archiveZone.getBoundingClientRect();
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    };

    const handleWindowPointerMove = (event: globalThis.PointerEvent) => {
      setDragPointer({ x: event.clientX, y: event.clientY });

      // Verificar se está sobre a zona de arquivamento
      setIsArchiveDropZoneHovered(
        isOverArchiveZone(event.clientX, event.clientY),
      );

      const targetId = getCardIdFromPoint(event.clientX, event.clientY);
      if (targetId && targetId !== draggingId) {
        setDragOverId(targetId);

        const targetElement = document.querySelector<HTMLElement>(
          `[data-card-id="${targetId}"]`,
        );
        if (targetElement) {
          const rect = targetElement.getBoundingClientRect();
          const dx = event.clientX - (rect.left + rect.width / 2);
          const dy = event.clientY - (rect.top + rect.height / 2);
          const useHorizontal = Math.abs(dx) > Math.abs(dy);
          const nextPlacement = useHorizontal
            ? dx >= 0
              ? "after"
              : "before"
            : dy >= 0
              ? "after"
              : "before";
          setDragPlacement(nextPlacement);
        }
      }
    };

    const handleWindowPointerUp = (event: globalThis.PointerEvent) => {
      // Verificar se soltou na zona de arquivamento
      if (isOverArchiveZone(event.clientX, event.clientY)) {
        archiveCard(draggingId);
        clearDragState();
        setIsArchiveDropZoneHovered(false);
        return;
      }

      const targetId =
        getCardIdFromPoint(event.clientX, event.clientY) ??
        dragOverId ??
        draggingId;
      applyReorderFromDrag(draggingId, targetId, dragPlacement);
      clearDragState();
      setIsArchiveDropZoneHovered(false);
    };

    const handleWindowPointerCancel = () => {
      clearDragState();
      setIsArchiveDropZoneHovered(false);
    };

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);

    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
    };
  }, [
    isEditMode,
    isPointerDragging,
    draggingId,
    dragOverId,
    dragPlacement,
    favorites,
    normalizedOrder,
    cardIds,
  ]);

  const orderIndex = new Map(normalizedOrder.map((id, index) => [id, index]));
  const byOrder = (a: DashboardCard, b: DashboardCard) =>
    (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
    (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER);

  // Filtrar cards arquivados
  const visibleCards = cards.filter((card) => !archivedCards.includes(card.id));
  const archivedCardsList = cards.filter((card) =>
    archivedCards.includes(card.id),
  );

  const favoriteCards = [...visibleCards]
    .filter((card) => favorites.includes(card.id))
    .sort(byOrder);
  const nonFavoriteCards = [...visibleCards]
    .filter((card) => !favorites.includes(card.id))
    .sort(byOrder);
  const sorted = [...favoriteCards, ...nonFavoriteCards];
  const draggingCard = draggingId
    ? (cards.find((card) => card.id === draggingId) ?? null)
    : null;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {isEditMode && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-fg-3">
          <GripVertical className="h-3.5 w-3.5 text-accent" />
          <span>
            Modo de Reorganização ativo: segure e arraste para reordenar os
            cards conforme quiser.
          </span>
        </div>
      )}
      <div className={viewMode === "window" ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" : "grid grid-cols-2 gap-3"}>
        {sorted.map((card) => {
          const Icon = card.icon;
          const isFav = favorites.includes(card.id);
          const isDragging = draggingId === card.id;
          const isDropTarget = dragOverId === card.id && draggingId !== card.id;
          const dropBefore = isDropTarget && dragPlacement === "before";
          const dropAfter = isDropTarget && dragPlacement === "after";
          return (
            <button
              key={card.id}
              data-card-id={card.id}
              draggable={false}
              onPointerDown={(event) => handlePointerDown(card.id, event)}
              onClick={() => {
                if (isEditMode) return;
                if (card.action) card.action();
                else if (card.view) onNavigate(card.view);
              }}
              className={cn(
                "relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200",
                "bg-surface border-edge hover:border-indigo-500 hover:bg-surface/80",
                "group text-left",
                isEditMode &&
                  "touch-none select-none cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md",
                isDragging && "opacity-25 scale-[0.985] border-accent",
                isDropTarget && "border-accent bg-accent/5",
                dropBefore && "ring-2 ring-accent ring-inset",
                dropAfter &&
                  "ring-2 ring-accent/80 shadow-[0_3px_0_0_var(--accent)]",
              )}
              title={isEditMode ? "Arraste para reorganizar" : undefined}
            >
              {/* Favorite toggle */}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isEditMode) return;
                  toggleFavorite(card.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    if (isEditMode) return;
                    toggleFavorite(card.id);
                  }
                }}
                className={cn(
                  "absolute top-2 right-2 p-1 rounded transition-all duration-200",
                  isFav
                    ? "text-amber-400"
                    : "text-fg-7 opacity-0 group-hover:opacity-100 hover:text-amber-400",
                )}
                title={
                  isFav ? "Remover dos favoritos" : "Adicionar aos favoritos"
                }
              >
                <Star className={cn("w-3.5 h-3.5", isFav && "fill-current")} />
              </span>

              <Icon className="w-8 h-8 text-accent" />
              <div className="text-center">
                <p className="text-sm font-medium text-fg-2">{card.title}</p>
                <p className="text-xs text-fg-5 mt-0.5">{card.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Barra de Ferramentas Arquivadas */}
      {(isEditMode || archivedCardsList.length > 0) && (
        <div className="mt-4">
          <button
            onClick={() =>
              !isEditMode && setIsArchivedExpanded(!isArchivedExpanded)
            }
            data-archive-zone="true"
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all",
              "border border-dashed",
              isEditMode
                ? "border-amber-500/50 bg-amber-500/10"
                : "border-edge-2 bg-subtle hover:bg-field",
              isArchiveDropZoneHovered &&
                "border-amber-500 bg-amber-500/20 scale-[1.01]",
            )}
          >
            <Archive
              className={cn(
                "w-4 h-4",
                isEditMode ? "text-amber-500" : "text-fg-5",
              )}
            />
            <span className="text-xs text-fg-4 flex-1 text-left">
              Ferramentas Arquivadas ({archivedCardsList.length})
            </span>
            {!isEditMode && archivedCardsList.length > 0 && (
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-fg-5 transition-transform",
                  isArchivedExpanded && "rotate-180",
                )}
              />
            )}
            {isEditMode && (
              <span className="text-xs text-amber-500/80">
                Arraste cards aqui para arquivar
              </span>
            )}
          </button>

          {/* Cards arquivados expandidos */}
          {(isArchivedExpanded || isEditMode) &&
            archivedCardsList.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {archivedCardsList.map((card) => {
                  const Icon = card.icon;
                  return (
                    <button
                      key={card.id}
                      onClick={() => {
                        if (!isEditMode) {
                          setShowUnarchiveConfirm(card.id);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-lg border transition-all",
                        "bg-field/50 border-edge hover:border-accent/50",
                        "opacity-60 hover:opacity-100",
                      )}
                    >
                      <Icon className="w-4 h-4 text-fg-5" />
                      <span className="text-xs text-fg-4 truncate">
                        {card.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
        </div>
      )}

      {isEditMode && isPointerDragging && draggingCard && (
        <div
          className="pointer-events-none fixed z-50 w-[calc(50%-1.25rem)] max-w-[280px]"
          style={{
            left: dragPointer.x - dragOffset.x,
            top: dragPointer.y - dragOffset.y,
            transform: "rotate(1.5deg) scale(1.02)",
          }}
        >
          <div className="relative flex flex-col items-center gap-2 rounded-xl border border-accent/70 bg-surface/95 p-4 shadow-2xl backdrop-blur-sm transition-transform duration-75">
            <draggingCard.icon className="h-8 w-8 text-accent" />
            <div className="text-center">
              <p className="text-sm font-medium text-fg-2">
                {draggingCard.title}
              </p>
              <p className="mt-0.5 text-xs text-fg-5">
                {draggingCard.description}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação para desarquivar */}
      {showUnarchiveConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface border border-edge-2 rounded-xl w-full max-w-sm mx-4 p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArchiveRestore className="w-5 h-5 text-accent" />
              <h3 className="text-sm font-semibold text-fg-2">
                Desarquivar Ferramenta
              </h3>
            </div>
            <p className="text-sm text-fg-4 mb-4">
              Deseja desarquivar essa ferramenta? A ferramenta voltará ao
              Dashboard principal.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowUnarchiveConfirm(null)}
                className="px-3 py-1.5 text-sm text-fg-4 hover:text-fg-2 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => unarchiveCard(showUnarchiveConfirm)}
                className="px-3 py-1.5 text-sm text-white rounded-lg transition-colors bg-indigo-600 hover:bg-indigo-500"
              >
                Desarquivar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
