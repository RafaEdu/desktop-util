import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CircleCheck,
  CircleX,
  ExternalLink,
  LoaderCircle,
  Power,
  ServerCog,
  TriangleAlert,
} from "lucide-react";

type LaunchState =
  | { kind: "idle" }
  | { kind: "loading"; action: "close" | "logoff" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Não foi possível iniciar a ferramenta. Contate o suporte.";
}

export function DomainRecovery() {
  const [state, setState] = useState<LaunchState>({ kind: "idle" });

  const launch = async (
    action: "close" | "logoff",
    command: "launch_close_dominio_remoteapp" | "launch_logoff_remoteapp",
  ) => {
    setState({ kind: "loading", action });

    try {
      await invoke(command);
      setState({
        kind: "success",
        message:
          "RemoteApp iniciado. Aguarde a janela do servidor e confirme a ação escolhida.",
      });
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
              Fecha somente todas as janelas do Domínio abertas na sua sessão.
              Word, Excel e outros aplicativos permanecem abertos.
            </p>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => launch("close", "launch_close_dominio_remoteapp")}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.kind === "loading" && state.action === "close" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
              Fechar módulos do Domínio
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
              onClick={() => launch("logoff", "launch_logoff_remoteapp")}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.kind === "loading" && state.action === "logoff" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              Encerrar sessão no servidor
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
                As duas ações podem causar perda de informações não salvas. O
                servidor exibirá uma confirmação final antes de executar.
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
    </main>
  );
}
