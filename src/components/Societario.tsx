import { useState } from "react";
import {
  Search,
  Briefcase,
  Building2,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Tag,
  X,
} from "lucide-react";
import { fetch } from "@tauri-apps/plugin-http";
import { cn } from "../lib/cn";

interface CnaeSecundario {
  codigo: number;
  descricao: string;
}

interface CnpjData {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao_cadastral: string;
  descricao_situacao_cadastral: string;
  data_inicio_atividade: string;
  cnae_fiscal: number;
  cnae_fiscal_descricao: string;
  cnaes_secundarios: CnaeSecundario[];
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  ddd_telefone_1: string;
  ddd_telefone_2: string;
  email: string;
  natureza_juridica: string;
  porte: string;
  capital_social: number;
}

const SITUACAO_COLORS: Record<string, string> = {
  ATIVA: "text-emerald-400 bg-emerald-900/20 border-emerald-800/30",
  BAIXADA: "text-red-400 bg-red-900/20 border-red-800/30",
  INAPTA: "text-amber-400 bg-amber-900/20 border-amber-800/30",
  SUSPENSA: "text-orange-400 bg-orange-900/20 border-orange-800/30",
  NULA: "text-fg-5 bg-field border-edge-2",
};

function formatCnpj(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function formatCep(cep: string): string {
  const digits = cep.replace(/\D/g, "");
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
}

function formatPhone(dddPhone: string): string {
  if (!dddPhone || dddPhone.trim() === "") return "";
  const digits = dddPhone.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  if (number.length <= 4) return `(${ddd}) ${number}`;
  if (number.length <= 8)
    return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

export function Societario() {
  const [cnpjInput, setCnpjInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CnpjData | null>(null);

  const cnpjDigits = cnpjInput.replace(/\D/g, "");
  const isValid = cnpjDigits.length === 14;

  const handleSearch = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await fetch(
        `https://brasilapi.com.br/api/cnpj/v1/${cnpjDigits}`,
        { method: "GET" },
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("CNPJ não encontrado na base da Receita Federal.");
        }
        throw new Error(`Erro na consulta (HTTP ${response.status}).`);
      }

      const json = await response.json();
      setData(json as CnpjData);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Erro desconhecido na consulta.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setCnpjInput("");
    setData(null);
    setError(null);
  };

  const inputClass =
    "w-full bg-field border border-edge-2 rounded-lg px-3 py-2 text-sm " +
    "text-fg placeholder-fg-5 " +
    "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent " +
    "transition-all duration-200";

  const situacaoKey = data?.descricao_situacao_cadastral?.toUpperCase() ?? "";
  const situacaoColor =
    SITUACAO_COLORS[situacaoKey] || "text-fg-5 bg-field border-edge-2";

  const endereco = data
    ? [
        data.logradouro,
        data.numero,
        data.complemento,
        data.bairro,
        `${data.municipio} - ${data.uf}`,
        data.cep ? `CEP: ${formatCep(data.cep)}` : "",
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  const phone1 = data ? formatPhone(data.ddd_telefone_1) : "";
  const phone2 = data ? formatPhone(data.ddd_telefone_2) : "";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search header */}
      <div className="px-4 pt-3 pb-3 border-b border-edge space-y-2">
        <p className="text-xs text-fg-5">
          Consulta de CNPJ via Receita Federal (BrasilAPI)
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={cnpjInput}
              onChange={(e) => setCnpjInput(formatCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              className={cn(
                inputClass,
                "font-mono tracking-wider pr-8",
                isValid && "ring-1 ring-emerald-500/30",
              )}
            />
            {cnpjInput && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-5 hover:text-fg-3 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={!isValid || loading}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              isValid && !loading
                ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25"
                : "bg-field text-fg-6 cursor-not-allowed",
            )}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Consultar
          </button>
        </form>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Error */}
        {error && (
          <div className="p-3 rounded-lg bg-red-900/20 border border-red-800/50 text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-2 hover:text-red-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center h-32 text-fg-6">
            <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-2" />
            <p className="text-sm">Consultando CNPJ...</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !data && !error && (
          <div className="flex flex-col items-center justify-center h-32 text-fg-6">
            <Briefcase className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">
              Digite um CNPJ para consultar os dados da empresa.
            </p>
          </div>
        )}

        {/* Results */}
        {data && (
          <div className="space-y-3">
            {/* Razão Social + Situação */}
            <div className="p-3 rounded-lg bg-surface border border-edge">
              <div className="flex items-start gap-2 mb-2">
                <Building2 className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-fg-5 mb-0.5">Razão Social</p>
                  <p className="text-sm font-medium text-fg-2 break-words">
                    {data.razao_social}
                  </p>
                </div>
              </div>
              {data.nome_fantasia && (
                <div className="ml-6 mb-2">
                  <p className="text-xs text-fg-5 mb-0.5">Nome Fantasia</p>
                  <p className="text-sm text-fg-3">{data.nome_fantasia}</p>
                </div>
              )}
              <div className="flex items-center gap-2 ml-6">
                <span
                  className={cn(
                    "inline-flex px-2 py-0.5 rounded text-xs font-medium border",
                    situacaoColor,
                  )}
                >
                  {data.descricao_situacao_cadastral}
                </span>
                {data.porte && (
                  <span className="text-xs text-fg-5">• {data.porte}</span>
                )}
              </div>
            </div>

            {/* Informações gerais */}
            <div className="p-3 rounded-lg bg-surface border border-edge">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-start gap-2">
                  <Calendar className="w-3.5 h-3.5 text-fg-5 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-fg-5">Início Atividade</p>
                    <p className="text-sm text-fg-3">
                      {formatDate(data.data_inicio_atividade)}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Briefcase className="w-3.5 h-3.5 text-fg-5 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-fg-5">Capital Social</p>
                    <p className="text-sm text-fg-3">
                      {formatCurrency(data.capital_social)}
                    </p>
                  </div>
                </div>
              </div>
              {data.natureza_juridica && (
                <div className="mt-2 pt-2 border-t border-edge">
                  <p className="text-xs text-fg-5">Natureza Jurídica</p>
                  <p className="text-sm text-fg-3">{data.natureza_juridica}</p>
                </div>
              )}
            </div>

            {/* CNAE */}
            <div className="p-3 rounded-lg bg-surface border border-edge">
              <div className="flex items-start gap-2">
                <Tag className="w-3.5 h-3.5 text-fg-5 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-fg-5 mb-0.5">CNAE Principal</p>
                  <p className="text-sm text-fg-3">
                    <span className="font-mono text-accent">
                      {data.cnae_fiscal}
                    </span>{" "}
                    — {data.cnae_fiscal_descricao}
                  </p>
                </div>
              </div>
              {data.cnaes_secundarios && data.cnaes_secundarios.length > 0 && (
                <details className="mt-2 pt-2 border-t border-edge">
                  <summary className="text-xs text-fg-5 cursor-pointer hover:text-fg-3 transition-colors">
                    CNAEs Secundários ({data.cnaes_secundarios.length})
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {data.cnaes_secundarios.map((cnae) => (
                      <li key={cnae.codigo} className="text-xs text-fg-4">
                        <span className="font-mono text-fg-5">
                          {cnae.codigo}
                        </span>{" "}
                        — {cnae.descricao}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {/* Endereço */}
            <div className="p-3 rounded-lg bg-surface border border-edge">
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-fg-5 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-fg-5 mb-0.5">Endereço</p>
                  <p className="text-sm text-fg-3 break-words">{endereco}</p>
                </div>
              </div>
            </div>

            {/* Contato */}
            {(phone1 || phone2 || data.email) && (
              <div className="p-3 rounded-lg bg-surface border border-edge space-y-2">
                {(phone1 || phone2) && (
                  <div className="flex items-start gap-2">
                    <Phone className="w-3.5 h-3.5 text-fg-5 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-fg-5 mb-0.5">Telefone</p>
                      <p className="text-sm text-fg-3">
                        {[phone1, phone2].filter(Boolean).join(" / ")}
                      </p>
                    </div>
                  </div>
                )}
                {data.email && (
                  <div className="flex items-start gap-2">
                    <Mail className="w-3.5 h-3.5 text-fg-5 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-fg-5 mb-0.5">E-mail</p>
                      <p className="text-sm text-fg-3 break-all lowercase">
                        {data.email}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
