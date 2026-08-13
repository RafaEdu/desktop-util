import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { cn } from "../lib/cn";

type ClipboardMode = "disabled" | "memory" | "persistent";
type ClipboardSensitivity = "normal" | "personal";

type ClipboardSettings = {
  mode: ClipboardMode;
  retention_seconds: number;
};

type ClipboardItem = {
  id: string;
  text: string;
  captured_at: number;
  expires_at: number;
  sensitivity: ClipboardSensitivity;
};

type ClipboardSnapshot = {
  settings: ClipboardSettings;
  history: ClipboardItem[];
  blocked_count_session: number;
};

const DEFAULT_SNAPSHOT: ClipboardSnapshot = {
  settings: {
    mode: "disabled",
    retention_seconds: 8 * 60 * 60,
  },
  history: [],
  blocked_count_session: 0,
};

const RETENTION_OPTIONS = [
  { value: 60 * 60, label: "1 hora" },
  { value: 8 * 60 * 60, label: "8 horas" },
  { value: 24 * 60 * 60, label: "24 horas" },
  { value: 7 * 24 * 60 * 60, label: "7 dias" },
];

function retentionLabel(seconds: number) {
  return (
    RETENTION_OPTIONS.find((option) => option.value === seconds)?.label ??
    `${seconds} segundos`
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ClipboardHistory() {
  const [snapshot, setSnapshot] = useState<ClipboardSnapshot>(DEFAULT_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const next = await invoke<ClipboardSnapshot>("clipboard_get_snapshot");
      setSnapshot(next);
      setError(null);
    } catch (err) {
      setError(`Não foi possível carregar o histórico: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen("clipboard-history-changed", () => {
      void loadSnapshot();
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadSnapshot]);

  const applySettings = async (
    mode: ClipboardMode,
    retentionSeconds = snapshot.settings.retention_seconds,
  ) => {
    setSaving(true);
    setError(null);

    try {
      const next = await invoke<ClipboardSnapshot>("clipboard_set_settings", {
        settings: {
          mode,
          retention_seconds: retentionSeconds,
        },
      });
      setSnapshot(next);
      if (mode === "disabled") {
        setShowSettings(false);
      }
    } catch (err) {
      setError(`Não foi possível alterar a privacidade: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (item: ClipboardItem) => {
    try {
      await invoke("clipboard_copy_item", { id: item.id });
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      setError(`Não foi possível copiar o item: ${errorMessage(err)}`);
    }
  };

  const clearHistory = async () => {
    setError(null);
    try {
      const next = await invoke<ClipboardSnapshot>("clipboard_clear_history");
      setSnapshot(next);
    } catch (err) {
      setError(`Não foi possível limpar o histórico: ${errorMessage(err)}`);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-5 text-sm">
        Carregando histórico...
      </div>
    );
  }

  const { settings, history, blocked_count_session: blockedCount } = snapshot;
  const isEnabled = settings.mode !== "disabled";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {!isEnabled ? (
        <main className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-xl rounded-xl border border-edge bg-surface p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-fg-2">
                  Histórico desativado por privacidade
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-fg-5">
                  Enquanto estiver desativado, o Adcontec Útil não monitora o
                  conteúdo de texto da área de transferência. Ao ativar, senhas,
                  tokens, chaves privadas e outros segredos reconhecidos serão
                  ignorados automaticamente.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void applySettings("memory")}
                className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5 text-left transition-colors hover:bg-indigo-500/15 disabled:opacity-50"
              >
                <span className="block text-xs font-semibold text-indigo-300">
                  Somente nesta sessão
                </span>
                <span className="mt-0.5 block text-[11px] text-fg-5">
                  Recomendado. Nada do histórico é persistido em disco.
                </span>
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => void applySettings("persistent")}
                className="rounded-lg border border-edge bg-field px-3 py-2.5 text-left transition-colors hover:border-edge-2 disabled:opacity-50"
              >
                <span className="block text-xs font-semibold text-fg-2">
                  Histórico protegido
                </span>
                <span className="mt-0.5 block text-[11px] text-fg-5">
                  Mantém entre reinicializações usando proteção DPAPI do usuário
                  Windows.
                </span>
              </button>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-fg-6">
              Retenção inicial: 8 horas · limite: 50 itens. Essas opções podem
              ser alteradas depois.
            </p>
          </div>
        </main>
      ) : (
        <>
          <div className="border-b border-edge bg-surface/50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                  <span className="truncate text-xs font-medium text-fg-3">
                    {settings.mode === "memory"
                      ? "Somente nesta sessão"
                      : "Persistência protegida no Windows"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-fg-6">
                  Retenção: {retentionLabel(settings.retention_seconds)} ·
                  máximo de 50 itens
                </p>
              </div>

              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowSettings((value) => !value)}
                  className={cn(
                    "rounded-md p-1.5 text-fg-5 transition-colors hover:bg-field hover:text-fg-2",
                    showSettings && "bg-field text-indigo-400",
                  )}
                  title="Configurações de privacidade"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void clearHistory()}
                  disabled={history.length === 0}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-fg-4 transition-colors hover:bg-field hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Limpar
                </button>
              </div>
            </div>

            {showSettings && (
              <div className="mt-3 rounded-lg border border-edge bg-base/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-fg-5">
                      Armazenamento
                    </span>
                    <select
                      value={settings.mode}
                      disabled={saving}
                      onChange={(event) =>
                        void applySettings(event.target.value as ClipboardMode)
                      }
                      className="w-full rounded-md border border-edge bg-field px-2.5 py-2 text-xs text-fg-2 outline-none focus:border-indigo-500/50"
                    >
                      <option value="memory">Somente nesta sessão</option>
                      <option value="persistent">Protegido no disco</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-fg-5">
                      Retenção
                    </span>
                    <select
                      value={settings.retention_seconds}
                      disabled={saving}
                      onChange={(event) =>
                        void applySettings(
                          settings.mode,
                          Number(event.target.value),
                        )
                      }
                      className="w-full rounded-md border border-edge bg-field px-2.5 py-2 text-xs text-fg-2 outline-none focus:border-indigo-500/50"
                    >
                      {RETENTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-edge pt-3">
                  <p className="text-[11px] leading-relaxed text-fg-6">
                    Desativar encerra o monitoramento, limpa a memória e remove
                    o histórico protegido do disco.
                  </p>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void applySettings("disabled")}
                    className="flex-shrink-0 rounded-md border border-red-500/20 px-2.5 py-1.5 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Desativar
                  </button>
                </div>
              </div>
            )}
          </div>

          {blockedCount > 0 && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                {blockedCount} conteúdo{blockedCount === 1 ? "" : "s"}{" "}
                potencialmente sensível
                {blockedCount === 1 ? " foi ignorado" : " foram ignorados"}
                nesta sessão. O conteúdo bloqueado não é mantido no histórico.
              </span>
            </div>
          )}

          <main className="flex-1 overflow-y-auto px-4 py-3">
            {history.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center text-fg-6">
                <Clock className="mb-2 h-10 w-10 opacity-40" />
                <p className="text-sm">O histórico está vazio.</p>
                <p className="text-xs opacity-70">
                  Copie algo (Ctrl+C) para aparecer aqui.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {history.map((item) => (
                  <li
                    key={item.id}
                    className="group flex items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2.5 transition-all duration-200 hover:border-edge-2"
                  >
                    <button
                      type="button"
                      onClick={() => void handleCopy(item)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="line-clamp-2 break-all font-mono text-sm text-fg-2">
                        {item.text}
                      </p>
                      {item.sensitivity === "personal" && (
                        <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-fg-6">
                          <ShieldCheck className="h-3 w-3" /> Dado
                          pessoal/documental
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleCopy(item)}
                      className={cn(
                        "flex-shrink-0 rounded-md p-1.5 opacity-0 transition-all duration-200 group-hover:opacity-100",
                        copiedId === item.id
                          ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 opacity-100"
                          : "text-fg-5 hover:text-indigo-400",
                      )}
                      title={copiedId === item.id ? "Copiado" : "Copiar item"}
                    >
                      {copiedId === item.id ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </main>
        </>
      )}
    </div>
  );
}
