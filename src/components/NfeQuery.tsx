import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileSearch, RefreshCw, CheckCircle } from "lucide-react";
import { cn } from "../lib/cn";

interface CertInfo {
  subject: string;
  issuer: string;
  not_after: string;
  thumbprint: string;
}

const UF_LIST = [
  { code: 12, name: "AC" },
  { code: 27, name: "AL" },
  { code: 16, name: "AP" },
  { code: 13, name: "AM" },
  { code: 29, name: "BA" },
  { code: 23, name: "CE" },
  { code: 53, name: "DF" },
  { code: 32, name: "ES" },
  { code: 52, name: "GO" },
  { code: 21, name: "MA" },
  { code: 51, name: "MT" },
  { code: 50, name: "MS" },
  { code: 31, name: "MG" },
  { code: 15, name: "PA" },
  { code: 25, name: "PB" },
  { code: 41, name: "PR" },
  { code: 26, name: "PE" },
  { code: 22, name: "PI" },
  { code: 33, name: "RJ" },
  { code: 24, name: "RN" },
  { code: 43, name: "RS" },
  { code: 11, name: "RO" },
  { code: 14, name: "RR" },
  { code: 42, name: "SC" },
  { code: 35, name: "SP" },
  { code: 28, name: "SE" },
  { code: 17, name: "TO" },
];

export function NfeQuery() {
  const [environment, setEnvironment] = useState<"production" | "homologation">(
    () => {
      return (
        (localStorage.getItem("nfe_env") as "production" | "homologation") ||
        "production"
      );
    },
  );
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [selectedThumbprint, setSelectedThumbprint] = useState("");
  const [cnpj, setCnpj] = useState(
    () => localStorage.getItem("nfe_cnpj") || "",
  );
  const [ufCode, setUfCode] = useState(
    () => Number(localStorage.getItem("nfe_uf")) || 35,
  );
  const [accessKey, setAccessKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [certsLoading, setCertsLoading] = useState(false);

  useEffect(() => {
    loadCerts();
  }, []);

  useEffect(() => {
    localStorage.setItem("nfe_cnpj", cnpj);
  }, [cnpj]);

  useEffect(() => {
    localStorage.setItem("nfe_uf", String(ufCode));
  }, [ufCode]);

  useEffect(() => {
    localStorage.setItem("nfe_env", environment);
  }, [environment]);

  const loadCerts = async () => {
    setCertsLoading(true);
    try {
      const data = await invoke<CertInfo[]>("get_certificates");
      setCerts(data);
      if (data.length > 0) {
        setSelectedThumbprint(data[0].thumbprint);
      }
    } catch (err) {
      console.error("Failed to load certificates:", err);
    } finally {
      setCertsLoading(false);
    }
  };

  const handleQuery = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await invoke("query_nfe", {
        thumbprint: selectedThumbprint,
        accessKey: accessKey.replace(/\D/g, ""),
        cnpj: cnpj.replace(/\D/g, ""),
        ufCode,
        environment,
      });
      setSuccess(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const cnpjDigits = cnpj.replace(/\D/g, "");
  const keyDigits = accessKey.replace(/\D/g, "");
  const isValid =
    selectedThumbprint && cnpjDigits.length === 14 && keyDigits.length === 44;

  const inputClass =
    "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm " +
    "text-gray-100 placeholder-gray-500 " +
    "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent " +
    "transition-all duration-200";

  const selectClass =
    "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm " +
    "text-gray-100 " +
    "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent " +
    "transition-all duration-200";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Consulta de NF-e via SEFAZ (NFeDistribuicaoDFe)
        </p>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        {/* Environment toggle */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ambiente</label>
          <div className="flex gap-2">
            <button
              onClick={() => setEnvironment("production")}
              className={cn(
                "flex-1 py-1.5 rounded-md text-xs font-medium transition-colors text-center",
                environment === "production"
                  ? "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30"
                  : "bg-gray-800 text-gray-500 hover:text-gray-300",
              )}
            >
              Produção
            </button>
            <button
              onClick={() => setEnvironment("homologation")}
              className={cn(
                "flex-1 py-1.5 rounded-md text-xs font-medium transition-colors text-center",
                environment === "homologation"
                  ? "bg-amber-600/20 text-amber-400 ring-1 ring-amber-500/30"
                  : "bg-gray-800 text-gray-500 hover:text-gray-300",
              )}
            >
              Homologação
            </button>
          </div>
        </div>

        {/* Certificate dropdown */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Certificado Digital (A1)
          </label>
          {certsLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
              <div className="w-3.5 h-3.5 border-2 border-gray-600 border-t-indigo-400 rounded-full animate-spin" />
              Carregando certificados...
            </div>
          ) : certs.length === 0 ? (
            <div className="text-xs text-gray-500 py-2">
              Nenhum certificado encontrado.{" "}
              <button
                onClick={loadCerts}
                className="text-indigo-400 hover:underline"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <select
              value={selectedThumbprint}
              onChange={(e) => setSelectedThumbprint(e.target.value)}
              className={selectClass}
            >
              {certs.map((c) => (
                <option key={c.thumbprint} value={c.thumbprint}>
                  {c.subject}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* CNPJ + UF row */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">
              CNPJ do Solicitante
              <span className="ml-1 text-gray-600">
                ({cnpjDigits.length}/14)
              </span>
            </label>
            <input
              type="text"
              value={cnpj}
              onChange={(e) =>
                setCnpj(e.target.value.replace(/[^\d]/g, "").slice(0, 14))
              }
              placeholder="00000000000000"
              maxLength={14}
              className={cn(
                inputClass,
                cnpjDigits.length === 14 && "ring-1 ring-emerald-500/30",
              )}
            />
          </div>
          <div className="w-24">
            <label className="block text-xs text-gray-500 mb-1">UF</label>
            <select
              value={ufCode}
              onChange={(e) => setUfCode(Number(e.target.value))}
              className={selectClass}
            >
              {UF_LIST.map((uf) => (
                <option key={uf.code} value={uf.code}>
                  {uf.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Access key input */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            Chave de Acesso (44 dígitos)
            <span className="ml-1 text-gray-600">({keyDigits.length}/44)</span>
          </label>
          <input
            type="text"
            value={accessKey}
            onChange={(e) =>
              setAccessKey(e.target.value.replace(/[^\d]/g, "").slice(0, 44))
            }
            placeholder="00000000000000000000000000000000000000000000"
            maxLength={44}
            className={cn(
              inputClass,
              "font-mono text-xs tracking-wider",
              keyDigits.length === 44 && "ring-1 ring-emerald-500/30",
            )}
          />
        </div>

        {/* Action button */}
        <button
          onClick={handleQuery}
          disabled={!isValid || loading}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
            isValid && !loading
              ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25"
              : "bg-gray-800 text-gray-600 cursor-not-allowed",
          )}
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Consultando SEFAZ...
            </>
          ) : (
            <>
              <FileSearch className="w-4 h-4" />
              Visualizar DANFE
            </>
          )}
        </button>

        {/* Status messages */}
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800/50 text-red-400 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3 rounded-lg bg-emerald-900/20 border border-emerald-800/50 text-emerald-400 text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            DANFE aberto no navegador com sucesso.
          </div>
        )}

        {/* Environment warning */}
        {environment === "homologation" && (
          <div className="p-2 rounded-lg bg-amber-900/10 border border-amber-800/30 text-amber-500 text-xs">
            Ambiente de homologação selecionado. Os dados retornados podem ser
            fictícios.
          </div>
        )}
      </main>
    </div>
  );
}
