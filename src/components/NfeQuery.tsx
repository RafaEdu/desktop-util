import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileSearch, ExternalLink, ShieldCheck } from "lucide-react";
import { cn } from "../lib/cn";

// UF map for display from access key
const UF_NAMES: Record<string, string> = {
  "11": "RO",
  "12": "AC",
  "13": "AM",
  "14": "RR",
  "15": "PA",
  "16": "AP",
  "17": "TO",
  "21": "MA",
  "22": "PI",
  "23": "CE",
  "24": "RN",
  "25": "PB",
  "26": "PE",
  "27": "AL",
  "28": "SE",
  "29": "BA",
  "31": "MG",
  "32": "ES",
  "33": "RJ",
  "35": "SP",
  "41": "PR",
  "42": "SC",
  "43": "RS",
  "50": "MS",
  "51": "MT",
  "52": "GO",
  "53": "DF",
};

function formatCnpj(cnpj: string): string {
  if (cnpj.length !== 14) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

function parseAccessKey(key: string) {
  if (key.length !== 44) return null;
  return {
    uf: UF_NAMES[key.slice(0, 2)] || key.slice(0, 2),
    date: `${key.slice(4, 6)}/${key.slice(2, 4)}`,
    cnpj: formatCnpj(key.slice(6, 20)),
    model: key.slice(20, 22),
    serie: key.slice(22, 25),
    number: key.slice(25, 34).replace(/^0+/, "") || "0",
  };
}

export function NfeQuery() {
  const [accessKeyRaw, setAccessKeyRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  // Sanitize: strip all non-digit characters
  const accessKey = accessKeyRaw.replace(/\D/g, "").slice(0, 44);
  const parsed = parseAccessKey(accessKey);
  const isValid = accessKey.length === 44;

  const handleQuery = async () => {
    setError(null);
    setOpened(false);
    try {
      await invoke("query_nfe_portal", { accessKey });
      setOpened(true);
    } catch (err) {
      setError(String(err));
    }
  };

  const inputClass =
    "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm " +
    "text-gray-100 placeholder-gray-500 " +
    "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent " +
    "transition-all duration-200";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-3">
        <p className="text-xs text-gray-500">
          Consulta de NF-e via Portal SEFAZ
        </p>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {/* Access key input */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Chave de Acesso
            <span className="ml-1 text-gray-600">({accessKey.length}/44)</span>
          </label>
          <input
            type="text"
            value={accessKeyRaw}
            onChange={(e) => setAccessKeyRaw(e.target.value)}
            placeholder="Cole a chave de acesso (aceita pontos, traços, barras)"
            className={cn(
              inputClass,
              "font-mono text-xs tracking-wider",
              accessKey.length === 44 && "ring-1 ring-emerald-500/30",
            )}
          />
          {accessKeyRaw !== accessKey && accessKeyRaw.length > 0 && (
            <p className="mt-1 text-xs text-gray-600">
              Caracteres especiais removidos automaticamente
            </p>
          )}
        </div>

        {/* Parsed access key preview */}
        {parsed && (
          <div className="p-2.5 rounded-lg bg-gray-800/50 border border-gray-700/50">
            <p className="text-xs text-gray-500 uppercase font-medium mb-1.5">
              Dados extraidos da chave
            </p>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
              <div>
                <span className="text-gray-500">UF:</span>{" "}
                <span className="text-gray-300">{parsed.uf}</span>
              </div>
              <div>
                <span className="text-gray-500">Mes/Ano:</span>{" "}
                <span className="text-gray-300">{parsed.date}</span>
              </div>
              <div>
                <span className="text-gray-500">N:</span>{" "}
                <span className="text-gray-300">{parsed.number}</span>
              </div>
              <div className="col-span-3">
                <span className="text-gray-500">CNPJ Emitente:</span>{" "}
                <span className="text-gray-300 font-mono">{parsed.cnpj}</span>
              </div>
            </div>
          </div>
        )}

        {/* Action button */}
        <button
          onClick={handleQuery}
          disabled={!isValid}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
            isValid
              ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25"
              : "bg-gray-800 text-gray-600 cursor-not-allowed",
          )}
        >
          <FileSearch className="w-4 h-4" />
          Consultar NF-e
        </button>

        {/* Success: consultation window opened */}
        {opened && (
          <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-800/50 text-emerald-400 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 flex-shrink-0" />
              Janela de consulta aberta
            </div>
            <p className="text-xs text-emerald-500/80 pl-6">
              Resolva o captcha na janela do SEFAZ para visualizar a NF-e.
              Utilize o botao Imprimir na parte inferior da janela.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800/50 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Info note */}
        <div className="p-2.5 rounded-lg bg-gray-800/30 border border-gray-700/30 flex items-start gap-2">
          <ExternalLink className="w-3.5 h-3.5 text-gray-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-gray-600">
            A consulta abre o portal da SEFAZ com captcha. A chave de acesso
            sera preenchida automaticamente. Apos resolver o captcha, os dados
            da NF-e serao exibidos com opcao de impressao.
          </p>
        </div>
      </main>
    </div>
  );
}
