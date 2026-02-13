import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  Search,
  Trash2,
  X,
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

  // Estado para o modal de exclusão em lote (vencidos)
  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);

  // Estado para o modal de exclusão individual (guarda o certificado selecionado ou null)
  const [certToDelete, setCertToDelete] = useState<CertInfo | null>(null);

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

  const expiredCerts = useMemo(() => {
    return certs.filter((c) => getExpiryStatus(c.not_after) === "expired");
  }, [certs]);

  // Função para excluir lista de thumbprints (usada tanto para lote quanto individual)
  const executeDelete = async (thumbprints: string[]) => {
    setLoading(true);
    try {
      await invoke("delete_certificates", { thumbprints });
      // Fecha modais e recarrega
      setShowBatchDeleteModal(false);
      setCertToDelete(null);
      await loadCerts();
    } catch (err) {
      setError(`Erro ao excluir: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBatchDelete = () => {
    if (expiredCerts.length === 0) return;
    const thumbprints = expiredCerts.map((c) => c.thumbprint);
    executeDelete(thumbprints);
  };

  const handleSingleDelete = () => {
    if (!certToDelete) return;
    executeDelete([certToDelete.thumbprint]);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Header */}
      <div className="px-4 pt-3 pb-3 flex items-start justify-between">
        <div className="pt-1.5">
          <p className="text-xs text-gray-500">
            Certificados digitais (Repositório Pessoal)
          </p>
        </div>

        {/* Botões empilhados na direita */}
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={loadCerts}
            disabled={loading}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors w-full justify-center min-w-[100px]",
              "bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30 hover:bg-indigo-600/30",
              loading && "opacity-50 cursor-not-allowed",
            )}
          >
            <RefreshCw
              className={cn("w-3.5 h-3.5", loading && "animate-spin")}
            />
            {fetched ? "Atualizar" : "Carregar"}
          </button>

          {/* Botão Limpar Vencidos - Abaixo do atualizar */}
          {fetched && expiredCerts.length > 0 && (
            <button
              onClick={() => setShowBatchDeleteModal(true)}
              disabled={loading}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors w-full justify-center min-w-[100px]",
                "bg-red-900/20 text-red-400 ring-1 ring-red-500/30 hover:bg-red-900/40",
                loading && "opacity-50 cursor-not-allowed",
              )}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Limpar ({expiredCerts.length})
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
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
        ) : loading && !fetched ? (
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
          <ul className="space-y-2 pb-4">
            {filtered.map((cert, i) => {
              const status = getExpiryStatus(cert.not_after);
              return (
                <li
                  key={i}
                  className={cn(
                    "px-3 py-2.5 rounded-lg border transition-all duration-200 flex items-center justify-between gap-3 group",
                    status === "expired"
                      ? "bg-red-900/10 border-red-800/50"
                      : status === "warning"
                        ? "bg-amber-900/10 border-amber-800/50"
                        : "bg-gray-900 border-gray-800",
                  )}
                >
                  <div className="flex items-start gap-2 flex-1 min-w-0">
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

                  {/* Botão de Exclusão Individual */}
                  <button
                    onClick={() => setCertToDelete(cert)}
                    className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Excluir este certificado"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {/* --- MODAIS --- 
          Usando 'fixed inset-0' para garantir que fiquem no centro da tela 
          independentemente da rolagem da lista.
      */}

      {/* Modal de Confirmação de Exclusão em Lote */}
      {showBatchDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-sm w-full p-4 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2 text-red-400">
                <Trash2 className="w-5 h-5" />
                <h3 className="font-semibold text-gray-100">
                  Excluir Vencidos?
                </h3>
              </div>
              <button
                onClick={() => setShowBatchDeleteModal(false)}
                className="text-gray-500 hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-gray-300 mb-4">
              Você está prestes a excluir <strong>{expiredCerts.length}</strong>{" "}
              certificado(s) vencido(s).
            </p>

            <details className="mb-4 text-xs group">
              <summary className="text-gray-500 cursor-pointer hover:text-indigo-400 transition-colors list-none flex items-center gap-1 select-none">
                <span className="group-open:hidden">▶ Ver lista</span>
                <span className="hidden group-open:inline">
                  ▼ Ocultar lista
                </span>
              </summary>
              <div className="mt-2 max-h-32 overflow-y-auto bg-gray-950/50 rounded border border-gray-800 p-2 space-y-1">
                {expiredCerts.map((c) => (
                  <div
                    key={c.thumbprint}
                    className="truncate text-gray-400 border-b border-gray-800/50 last:border-0 pb-1 last:pb-0"
                  >
                    {c.subject}
                  </div>
                ))}
              </div>
            </details>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowBatchDeleteModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-900/20"
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmação Individual */}
      {certToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl max-w-sm w-full p-4 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2 text-gray-100">
                <Trash2 className="w-5 h-5 text-red-400" />
                <h3 className="font-semibold">Excluir Certificado</h3>
              </div>
              <button
                onClick={() => setCertToDelete(null)}
                className="text-gray-500 hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-sm text-gray-300 mb-6">
              <p>Tem certeza que deseja remover o certificado abaixo?</p>
              <div className="mt-3 p-2 bg-gray-950 rounded border border-gray-800">
                <p className="font-medium text-gray-200 truncate">
                  {certToDelete.subject}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Emissor: {certToDelete.issuer}
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setCertToDelete(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSingleDelete}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-900/20"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
