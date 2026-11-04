import { normalizeCnpj } from "./cnpj.mjs";
const clean = (v, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const userAgent =
  "BigCloak-Farm/1.0 (+https://github.com/ronald-almeida/big-cloack)";
async function query(url, source, fetcher) {
  let response;
  try {
    response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json", "User-Agent": userAgent },
    });
  } catch {
    throw Error(source + ": tempo esgotado ou falha de conexão");
  }
  if (!response.ok) {
    const reason =
      response.status === 429
        ? "limite de consultas atingido"
        : response.status === 404
          ? "CNPJ não encontrado"
          : response.status === 403
            ? "consulta bloqueada pelo provedor"
            : response.status >= 300 && response.status < 400
              ? "redirecionamento inesperado"
              : "serviço indisponível";
    throw Error(source + ": " + reason + " (HTTP " + response.status + ")");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(source + ": resposta inválida");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error(source + ": resposta inválida");
  return data;
}
function mapCompany(d, id, source) {
  if (!clean(d.razao_social) || String(d.cnpj || "").replace(/\D/g, "") !== id)
    throw Error(source + ": dados incompletos ou CNPJ divergente");
  return {
    cnpj: id,
    razao: clean(d.razao_social),
    fantasia: clean(d.nome_fantasia),
    abertura: clean(d.data_inicio_atividade, 30).replace(
      /^(\d{4})-(\d{2})-(\d{2})$/,
      "$3/$2/$1",
    ),
    atividade: clean(
      [d.cnae_fiscal, d.cnae_fiscal_descricao].filter(Boolean).join(" - "),
      500,
    ),
    cidade: clean(d.municipio, 100),
    uf: clean(d.uf, 2),
    telefone: clean(d.ddd_telefone_1, 30).replace(/\D/g, ""),
    email: clean(d.email, 160),
  };
}
export async function lookupFarmCnpj(value, fetcher = fetch) {
  const id = normalizeCnpj(value),
    errors = [];
  try {
    const d = await query(
      "https://brasilapi.com.br/api/cnpj/v1/" + id,
      "BrasilAPI",
      fetcher,
    );
    return { source: "BrasilAPI", data: mapCompany(d, id, "BrasilAPI") };
  } catch (e) {
    errors.push(e.message);
  }
  try {
    const d = await query(
      "https://receitaws.com.br/v1/cnpj/" + id,
      "ReceitaWS",
      fetcher,
    );
    if (d.status === "ERROR")
      throw Error("ReceitaWS: CNPJ não encontrado ou consulta indisponível");
    const mapped = {
      ...d,
      razao_social: d.nome,
      nome_fantasia: d.fantasia,
      data_inicio_atividade: d.abertura,
      cnae_fiscal: d.atividade_principal?.[0]?.code,
      cnae_fiscal_descricao: d.atividade_principal?.[0]?.text,
      ddd_telefone_1: clean(d.telefone, 100).split(/[\/;]/)[0],
    };
    return {
      source: "ReceitaWS",
      fallback: true,
      notice:
        "A BrasilAPI não respondeu com dados válidos. Dados consultados na ReceitaWS.",
      data: mapCompany(mapped, id, "ReceitaWS"),
    };
  } catch (e) {
    errors.push(e.message);
  }
  throw Error(
    errors.join(". ") +
      ". Tente novamente mais tarde ou preencha os dados manualmente.",
  );
}

