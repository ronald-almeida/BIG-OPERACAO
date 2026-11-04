import { farmHostname } from "../../shared/farm.mjs";
const serviceName = env => env.FARM_WORKER_SERVICE || "big-operacao";
export async function farmCF(env, path, method = "GET", data) {
  if (
    !env.CLOUDFLARE_API_TOKEN ||
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || "")
  )
    throw Error("Configure a integração Cloudflare no servidor.");
  const r = await fetch("https://api.cloudflare.com/client/v4" + path, {
    method,
    headers: {
      Authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
    redirect: "manual",
  });
  if (r.status >= 300 && r.status < 400)
    throw Error("A API Cloudflare retornou um redirecionamento inesperado.");
  const result = await r.json();
  if (!r.ok || !result.success)
    throw Error(
      "Cloudflare: " +
        String(
          result.errors?.[0]?.message || "Não foi possível concluir.",
        ).slice(0, 250),
    );
  return result.result;
}
const base = (env) =>
  "/accounts/" + env.CLOUDFLARE_ACCOUNT_ID + "/workers/domains";
export async function farmZone(env, hostname, create = false) {
  const zones = await farmCF(
    env,
    "/zones?" +
      new URLSearchParams({
        name: hostname,
        "account.id": env.CLOUDFLARE_ACCOUNT_ID,
      }),
  );
  let zone = zones.find(
    (z) => z.name === hostname && z.account?.id === env.CLOUDFLARE_ACCOUNT_ID,
  );
  if (!zone && create)
    zone = await farmCF(env, "/zones", "POST", {
      name: hostname,
      account: { id: env.CLOUDFLARE_ACCOUNT_ID },
      type: "full",
    });
  if (!zone) throw Error("Domínio não encontrado nesta conta Cloudflare.");
  return zone;
}
export async function bindFarm(env, site, domain) {
  const hostname = farmHostname(site, domain);
  const bindings = await farmCF(
    env,
    base(env) + "?" + new URLSearchParams({ hostname }),
  );
  const existing = bindings.find((b) => b.hostname === hostname);
  if (existing) {
    if (existing.service !== serviceName(env))
      throw Error(
        "Este endereço pertence a outro serviço. Escolha outro endereço.",
      );
    return existing;
  }
  const records = await farmCF(
    env,
    "/zones/" +
      domain.zone_id +
      "/dns_records?" +
      new URLSearchParams({ name: hostname }),
  );
  if (records.length)
    throw Error(
      "Já existe um registro DNS neste endereço. Escolha outro endereço.",
    );
  return farmCF(env, base(env), "PUT", {
    hostname,
    service: serviceName(env),
    zone_id: domain.zone_id,
    environment: "production",
  });
}
export async function unbindFarm(env, site, domain) {
  const hostname = farmHostname(site, domain);
  const bindings = await farmCF(
    env,
    base(env) + "?" + new URLSearchParams({ hostname }),
  );
  const existing = bindings.find((b) => b.hostname === hostname);
  if (!existing) return;
  if (
    existing.service !== serviceName(env) ||
    (site.cloudflare_domain_id && existing.id !== site.cloudflare_domain_id)
  )
    throw Error(
      "O endereço foi alterado fora do Farm. A remoção foi interrompida.",
    );
  await farmCF(env, base(env) + "/" + existing.id, "DELETE");
}
export async function verifyFarm(site, domain) {
  try {
    const response = await fetch(
      "https://" + farmHostname(site, domain) + "/__farm-check",
      {
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "Cache-Control": "no-cache" },
      },
    );
    const data = await response.json();
    return (
      response.ok &&
      data.service === "big-cloack-farm" &&
      data.site_id === site.id &&
      data.version === site.published_version
    );
  } catch {
    return false;
  }
}


