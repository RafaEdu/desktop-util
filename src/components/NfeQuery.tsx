import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileSearch, ShieldCheck, RefreshCw, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

// ... (UF_NAMES, formatCnpj, parseAccessKey mantidos iguais) ...
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

interface CertInfo {
  subject: string;
  issuer: string;
  not_after: string;
  thumbprint: string;
}

export function NfeQuery() {
  const [accessKeyRaw, setAccessKeyRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"portal" | "cert">("cert"); // Padrão alterado para Cert (Melhor experiência)
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [selectedCert, setSelectedCert] = useState<string>("");
  const [loadingCerts, setLoadingCerts] = useState(false);

  const accessKey = accessKeyRaw.replace(/\D/g, "").slice(0, 44);
  const parsed = parseAccessKey(accessKey);
  const isValid = accessKey.length === 44;

  const loadCerts = async () => {
    setLoadingCerts(true);
    try {
      const data = await invoke<CertInfo[]>("get_certificates");
      setCerts(data);
      if (data.length > 0 && !selectedCert) {
        setSelectedCert(data[0].thumbprint);
      }
    } catch (err) {
      console.error("Failed to load certs", err);
    } finally {
      setLoadingCerts(false);
    }
  };

  useEffect(() => {
    if (method === "cert" && certs.length === 0) {
      loadCerts();
    }
  }, [method]);

  const handleQuery = async () => {
    setError(null);
    try {
      if (method === "portal") {
        await invoke("query_nfe_portal", { accessKey });
      } else {
        if (!selectedCert) {
          setError("Selecione um certificado digital para continuar.");
          return;
        }
        const filePath = await invoke<string>("query_nfe", {
          thumbprint: selectedCert,
          accessKey,
        });
        await invoke("open_danfe", { filePath });
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const inputClass =
    "w-full bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm " +
    "text-fg placeholder-fg-5 " +
    "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent " +
    "transition-all duration-200";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 pt-3 pb-3 flex gap-2 border-b border-edge">
        <button
          onClick={() => setMethod("cert")}
          className={cn(
            "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
            method === "cert"
              ? "bg-indigo-600 text-white"
              : "text-fg-4 hover:text-fg-2 hover:bg-field",
          )}
        >
          Via Certificado (Completa)
        </button>
        <button
          onClick={() => setMethod("portal")}
          className={cn(
            "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
            method === "portal"
              ? "bg-indigo-600 text-white"
              : "text-fg-4 hover:text-fg-2 hover:bg-field",
          )}
        >
          Portal Captcha (Resumo)
        </button>
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        <div>
          <label className="block text-xs text-fg-5 mb-1">
            Chave de Acesso
            <span className="ml-1 text-fg-6">({accessKey.length}/44)</span>
          </label>
          <input
            type="text"
            value={accessKeyRaw}
            onChange={(e) => setAccessKeyRaw(e.target.value)}
            placeholder="Cole a chave de acesso"
            className={cn(
              inputClass,
              "font-mono text-xs tracking-wider",
              accessKey.length === 44 && "ring-1 ring-emerald-500/30",
            )}
          />
        </div>

        {method === "cert" && (
          <div>
            <label className="block text-xs text-fg-5 mb-1">
              Certificado Digital (e-CNPJ)
            </label>
            <div className="relative">
              {loadingCerts ? (
                <div className="w-full bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm text-fg-5 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Carregando certificados...
                </div>
              ) : certs.length === 0 ? (
                <div className="w-full bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2 text-sm text-red-400 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Nenhum certificado encontrado
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={selectedCert}
                    onChange={(e) => setSelectedCert(e.target.value)}
                    className="w-full bg-field border border-edge-2 rounded-lg pl-3 pr-8 py-2 text-sm text-fg appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {certs.map((c) => (
                      <option key={c.thumbprint} value={c.thumbprint}>
                        {c.subject.split(",")[0]} (Val:{" "}
                        {c.not_after !== "N/A"
                          ? c.not_after.split("T")[0]
                          : "N/A"}
                        )
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-5 pointer-events-none" />
                </div>
              )}
            </div>
            <p className="mt-1 text-[10px] text-emerald-400/80">
              * É necessário que o certificado digital esteja configurado como
              exportável.
            </p>
          </div>
        )}

        {/* Info adicional para o Portal */}
        {method === "portal" && (
          <div className="p-2.5 rounded-lg bg-yellow-900/20 border border-yellow-800/30">
            <p className="text-xs text-yellow-500">
              Atenção: A consulta via Portal retorna apenas o{" "}
              <strong>Resumo da Nota</strong> (sem produtos) devido a restrições
              da SEFAZ para acesso sem login. Para a DANFE completa, use o
              Certificado.
            </p>
          </div>
        )}

        {parsed && (
          <div className="p-2.5 rounded-lg bg-field/50 border border-edge-2/50">
            <p className="text-xs text-fg-5 uppercase font-medium mb-1.5">
              Dados extraidos da chave
            </p>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
              <div>
                <span className="text-fg-5">UF:</span>{" "}
                <span className="text-fg-3">{parsed.uf}</span>
              </div>
              <div>
                <span className="text-fg-5">Data:</span>{" "}
                <span className="text-fg-3">{parsed.date}</span>
              </div>
              <div>
                <span className="text-fg-5">N:</span>{" "}
                <span className="text-fg-3">{parsed.number}</span>
              </div>
              <div className="col-span-3">
                <span className="text-fg-5">Emitente:</span>{" "}
                <span className="text-fg-3 font-mono">{parsed.cnpj}</span>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={handleQuery}
          disabled={!isValid}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
            isValid
              ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25"
              : "bg-field text-fg-6 cursor-not-allowed",
          )}
        >
          <FileSearch className="w-4 h-4" />
          {method === "cert" ? "Gerar DANFE Completa" : "Consultar Resumo"}
        </button>

        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800/50 text-red-400 text-sm">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
