import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CircleCheck,
  CircleX,
  LoaderCircle,
  Power,
  ServerCog,
  TriangleAlert,
} from "lucide-react";

type Action = "close" | "logoff";

type RemoteActionResult = {
  success: boolean;
  code: string;
  message: string;
  affectedProcesses: number | null;
  sessionId: number | null;
};

type ActionState =
  | { kind: "idle" }
  | { kind: "loading"; action: Action }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const actionContent: Record<
  Action,
  {
    title: string;
    warning: string;
    command: "close_dominio" | "logoff_remote_session";
  }
> = {
  close: {
    title: "Fechar todos os módulos do Domínio?",
    warning:
      "Todas as janelas do Domínio abertas por você no SRV-IBM serão fechadas à força. Informações não salvas poderão ser perdidas.",
    command: "close_dominio",
  },
  logoff: {
    title: "Encerrar sua sessão no SRV-IBM?",
    warning:
      "Domínio, Excel, Word e todos os outros aplicativos da sua sessão serão fechados. Informações não salvas poderão ser perdidas.",
    command: "logoff_remote_session",
  },
};

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Não foi possível executar a ação. Contate o suporte.";
}

export function DomainRecovery() {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [pendingAction, setPendingAction] = useState<Action | null>(null);

  const execute = async (action: Action) => {
    const content = actionContent[action];
    setPendingAction(null);
    setState({ kind: "loading", action });

    try {
      const result = await invoke<RemoteActionResult>(content.command);
      setState(
        result.success
          ? { kind: "success", message: result.message }
          : { kind: "error", message: result.message },
      );
    } catch (error) {
      setState({ kind: "error", message: errorMessage(error) });
    }
  };

  const isLoading = state.kind === "loading";

  return (
    <main className="flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <section className="rounded-xl border border-edge bg-surface p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-accent/15 p-2 text-accent">
              <ServerCog className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-fg-2">
                Recuperar Domínio
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-fg-4">
                Use estas opções quando o Domínio travar ou quando sua sessão no
                SRV-IBM precisar ser reiniciada.
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          <section className="flex flex-col rounded-xl border border-edge bg-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <ServerCog className="h-5 w-5 text-accent" />
              <h3 className="text-sm font-semibold text-fg-2">
                Fechar todos os módulos
              </h3>
            </div>
            <p className="flex-1 text-sm leading-relaxed text-fg-4">
              Fecha somente o Domínio do seu usuário no SRV-IBM. Word, Excel e
              os demais aplicativos permanecem abertos.
            </p>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => setPendingAction("close")}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.kind === "loading" && state.action === "close" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ServerCog className="h-4 w-4" />
              )}
              {state.kind === "loading" && state.action === "close"
                ? "Encerrando..."
                : "Fechar módulos do Domínio"}
            </button>
          </section>

          <section className="flex flex-col rounded-xl border border-red-500/30 bg-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <Power className="h-5 w-5 text-red-400" />
              <h3 className="text-sm font-semibold text-fg-2">
                Encerrar minha sessão
              </h3>
            </div>
            <p className="flex-1 text-sm leading-relaxed text-fg-4">
              Faz logoff completo da sua sessão no SRV-IBM e fecha todos os
              aplicativos que estiverem executando nela.
            </p>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => setPendingAction("logoff")}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.kind === "loading" && state.action === "logoff" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              {state.kind === "loading" && state.action === "logoff"
                ? "Encerrando sessão..."
                : "Encerrar sessão no servidor"}
            </button>
          </section>
        </div>

        <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-amber-400">
                Atenção antes de continuar
              </p>
              <p className="mt-1 text-sm leading-relaxed text-fg-4">
                As ações podem causar perda de informações não salvas. Fechar o
                Domínio pode levar cerca de um minuto; aguarde a mensagem final.
              </p>
            </div>
          </div>
        </section>

        {state.kind === "success" && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
            <CircleCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{state.message}</span>
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            <CircleX className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{state.message}</span>
          </div>
        )}
      </div>

      {pendingAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="domain-recovery-confirm-title"
        >
          <div className="w-full max-w-md rounded-xl border border-edge bg-surface p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-500" />
              <div>
                <h3
                  id="domain-recovery-confirm-title"
                  className="text-base font-semibold text-fg-2"
                >
                  {actionContent[pendingAction].title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-4">
                  {actionContent[pendingAction].warning}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setPendingAction(null)}
                className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-fg-3 hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => execute(pendingAction)}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
                  pendingAction === "logoff" ? "bg-red-600" : "bg-accent"
                }`}
              >
                Sim, executar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
