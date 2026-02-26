import { useState } from "react";
import {
  RefreshCw,
  Activity,
  CircleCheck,
  CircleX,
  CircleMinus,
} from "lucide-react";
import { fetch } from "@tauri-apps/plugin-http";
import { cn } from "../lib/cn";

interface ServiceDef {
  name: string;
  url: string;
}

type Status = "online" | "offline" | "unstable" | "pending";

interface ServiceResult extends ServiceDef {
  status: Status;
}

// Lógica da alteração:
// 1. Removido: Receita Federal, Cloudflare, PIX (BCB)
// 2. Adicionado: Empregador Web
const SERVICES: ServiceDef[] = [
  { name: "eSocial", url: "https://www.esocial.gov.br" },
  { name: "Gov.br", url: "https://www.gov.br" },
  {
    name: "Empregador Web",
    url: "https://sd.maisemprego.mte.gov.br/sdweb/empregadorweb/",
  },
  {
    name: "SEFAZ - NF-e",
    url: "https://www.nfe.fazenda.gov.br/portal/principal.aspx",
  },
  {
    name: "e-CAC",
    url: "https://cav.receita.fazenda.gov.br",
  },
  {
    name: "NFSe Nacional",
    url: "https://www.nfse.gov.br/EmissorNacional/Login?ReturnUrl=%2fEmissorNacional",
  },
];

const STATUS_CONFIG: Record<
  Status,
  { icon: typeof CircleCheck; color: string; label: string }
> = {
  online: { icon: CircleCheck, color: "text-emerald-400", label: "Online" },
  offline: { icon: CircleX, color: "text-red-400", label: "Offline" },
  unstable: {
    icon: CircleMinus,
    color: "text-amber-400",
    label: "Instável",
  },
  pending: { icon: Activity, color: "text-fg-5", label: "Verificando..." },
};

export function ServiceStatus() {
  const [results, setResults] = useState<ServiceResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  const checkServices = async () => {
    setChecking(true);
    // Inicializa todos como "pending" visualmente antes de começar
    const pending = SERVICES.map((s) => ({
      ...s,
      status: "pending" as Status,
    }));
    setResults(pending);

    const completed: ServiceResult[] = [];

    // Itera sobre a constante SERVICES atualizada
    for (const service of SERVICES) {
      let status: Status;
      try {
        const controller = new AbortController();
        // Timeout de 15s para evitar travamento em serviços governamentais lentos
        const timer = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(service.url, {
          method: "GET",
          signal: controller.signal,
        });
        clearTimeout(timer);

        status = response.ok ? "online" : "unstable";
      } catch {
        status = "offline";
      }

      completed.push({ ...service, status });

      // Atualiza a lista progressivamente para dar feedback visual ao usuário
      // mantendo os próximos itens como "pending"
      setResults([
        ...completed,
        ...SERVICES.slice(completed.length).map((s) => ({
          ...s,
          status: "pending" as Status,
        })),
      ]);
    }

    setChecking(false);
    setChecked(true);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-3 flex items-center justify-between">
        <p className="text-xs text-fg-5">Status de serviços governamentais</p>
        <button
          onClick={checkServices}
          disabled={checking}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30 hover:bg-indigo-600/30",
            checking && "opacity-50 cursor-not-allowed",
          )}
        >
          <RefreshCw
            className={cn("w-3.5 h-3.5", checking && "animate-spin")}
          />
          {checked ? "Verificar Novamente" : "Verificar"}
        </button>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-2">
        {!checked && !checking ? (
          <div className="flex flex-col items-center justify-center h-32 text-fg-6">
            <Activity className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">
              Clique em "Verificar" para checar o status dos serviços.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {results.map((r, i) => {
              const config = STATUS_CONFIG[r.status];
              // Renderiza ícone de loading se estiver pendente, ou o ícone do status final
              const Icon =
                r.status === "pending" ? (
                  <div className="w-4 h-4 border-2 border-edge-3 border-t-indigo-400 rounded-full animate-spin" />
                ) : (
                  <config.icon className={cn("w-4 h-4", config.color)} />
                );

              return (
                <li
                  key={i}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border
                             bg-surface border-edge transition-all duration-200"
                >
                  {Icon}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-fg-2">{r.name}</p>
                    <p className="text-xs text-fg-5 truncate">{r.url}</p>
                  </div>
                  <span className={cn("text-xs font-medium", config.color)}>
                    {config.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
