import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  Search,
} from "lucide-react";
import dayjs from "dayjs";
import { cn } from "../lib/cn";

interface CertInfo {
  subject: string;
  issuer: string;
  not_after: string;
  thumbprint: string;
}

export function Certificates() {
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);
  const [search, setSearch] = useState("");

  const loadCerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<CertInfo[]>("get_certificates");
      setCerts(data);
      setFetched(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const getExpiryStatus = (dateStr: string) => {
    if (dateStr === "N/A") return "expired";
    const expiry = dayjs(dateStr);
    const now = dayjs();
    const daysLeft = expiry.diff(now, "day");
    if (daysLeft < 0) return "expired";
    if (daysLeft <= 30) return "warning";
    return "ok";
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return certs;
    const term = search.toLowerCase();
    return certs.filter(
      (c) =>
        c.subject.toLowerCase().includes(term) ||
        c.issuer.toLowerCase().includes(term),
    );
  }, [certs, search]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-3 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Certificados digitais (Repositório Pessoal)
        </p>
        <button
          onClick={loadCerts}
          disabled={loading}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
            "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30 hover:bg-indigo-600/30",
            loading && "opacity-50 cursor-not-allowed",
          )}
        >
          <RefreshCw
            className={cn("w-3.5 h-3.5", loading && "animate-spin")}
          />
          {fetched ? "Atualizar" : "Carregar"}
        </button>
      </div>

      {/* Search bar — visible once certs are loaded */}
      {fetched && certs.length > 0 && (
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou emissor..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm
                         text-gray-100 placeholder-gray-500
                         focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                         transition-all duration-200"
            />
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-2">
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800/50 text-red-400 text-sm mb-3">
            {error}
          </div>
        )}

        {!fetched && !loading ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-600">
            <ShieldCheck className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">
              Clique em "Carregar" para listar os certificados.
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-600">
            <ShieldCheck className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">
              {search.trim()
                ? "Nenhum certificado corresponde à busca."
                : "Nenhum certificado encontrado."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((cert, i) => {
              const status = getExpiryStatus(cert.not_after);
              return (
                <li
                  key={i}
                  className={cn(
                    "px-3 py-2.5 rounded-lg border transition-all duration-200",
                    status === "expired"
                      ? "bg-red-900/10 border-red-800/50"
                      : status === "warning"
                        ? "bg-amber-900/10 border-amber-800/50"
                        : "bg-gray-900 border-gray-800",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {status === "expired" ? (
                      <ShieldAlert className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                    ) : status === "warning" ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate">
                        {cert.subject}
                      </p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        Emissor: {cert.issuer}
                      </p>
                      <p
                        className={cn(
                          "text-xs mt-0.5",
                          status === "expired"
                            ? "text-red-400"
                            : status === "warning"
                              ? "text-amber-400"
                              : "text-gray-500",
                        )}
                      >
                        Validade:{" "}
                        {cert.not_after === "N/A"
                          ? "N/A"
                          : dayjs(cert.not_after).format("DD/MM/YYYY")}
                        {status === "expired" && " (Expirado)"}
                        {status === "warning" && " (Expira em breve)"}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5 font-mono truncate">
                        {cert.thumbprint}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
