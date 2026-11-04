export function normalizeCnpj(value) {
  const id = String(value || "")
    .replace(/[.\/\-\s]/g, "")
    .toUpperCase();
  if (!/^[0-9]{14}$/.test(id) || /^(.)\1+$/.test(id))
    throw new Error("Informe um CNPJ numérico válido com 14 dígitos.");
  for (let length = 12; length <= 13; length++) {
    let sum = 0,
      weight = length - 7;
    for (let i = 0; i < length; i++) {
      sum += Number(id[i]) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (digit !== Number(id[length]))
      throw new Error("CNPJ inválido. Confira os dígitos.");
  }
  return id;
}
const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export async function lookupCnpj(value, fetcher = fetch) {
  const id = normalizeCnpj(value);
  let response;
  try {
    response = await fetcher("https://receitaws.com.br/v1/cnpj/" + id, {
      signal: AbortSignal.timeout(10000),
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error(
      "A consulta está indisponível. Tente novamente em instantes.",
    );
  }
  if (response.status === 404)
    throw new Error("CNPJ não encontrado na base pública.");
  if (response.status === 429)
    throw new Error(
      "Limite de consultas atingido. Aguarde um pouco antes de tentar novamente.",
    );
  if (!response.ok)
    throw new Error("Não foi possível consultar este CNPJ agora.");
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("A consulta retornou uma resposta inválida.");
  }
  if (!data || typeof data !== "object")
    throw new Error("A consulta retornou dados incompletos.");
  if (data.status === "ERROR")
    throw new Error("CNPJ não disponível na base pública.");
  data = {
    ...data,
    razao_social: data.nome,
    data_inicio_atividade: String(data.abertura || "").replace(
      /^(\d{2})\/(\d{2})\/(\d{4})$/,
      "$3-$2-$1",
    ),
    cnae_fiscal_descricao: data.atividade_principal?.[0]?.text,
    cnaes_secundarios: (Array.isArray(data.atividades_secundarias)
      ? data.atividades_secundarias
      : []
    ).map((c) => ({ descricao: c?.text })),
    descricao_situacao_cadastral: data.situacao,
  };
  if (String(data.cnpj || "").replace(/\D/g, "") !== id || !data.razao_social)
    throw new Error("A consulta retornou dados incompletos.");
  const company = clean(data.razao_social, 160),
    city = [clean(data.municipio, 100), clean(data.uf, 2)]
      .filter(Boolean)
      .join(" / ");
  const activity = clean(data.cnae_fiscal_descricao, 200);
  const services = [
    ...new Set(
      [
        activity,
        ...(Array.isArray(data.cnaes_secundarios)
          ? data.cnaes_secundarios.map((c) => clean(c.descricao, 200))
          : []),
      ].filter(Boolean),
    ),
  ].slice(0, 8);
  return {
    source: "ReceitaWS",
    status: clean(data.descricao_situacao_cadastral, 50),
    fields: {
      cnpj: id.replace(
        /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
        "$1.$2.$3/$4-$5",
      ),
      company,
      city,
      opening_date: /^\d{4}-\d{2}-\d{2}$/.test(data.data_inicio_atividade || "")
        ? data.data_inicio_atividade
        : "",
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || "")
        ? clean(data.email, 160)
        : "",
      headline: company,
      description: (company + (city ? " — " + city : "") + ".").slice(0, 600),
      about: activity
        ? ("Atividade principal cadastrada: " + activity + ".").slice(0, 1200)
        : "",
      services,
    },
  };
}

