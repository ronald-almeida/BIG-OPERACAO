import test from "node:test";
import assert from "node:assert/strict";
import { lookupFarmCnpj } from "../src/farm/farm-cnpj.mjs";
const id = "53749174000118";
const brasil = {
  cnpj: id,
  razao_social: "Empresa Teste",
  nome_fantasia: "Teste",
  data_inicio_atividade: "2024-02-01",
};
const receita = {
  status: "OK",
  cnpj: "53.749.174/0001-18",
  nome: "Empresa Teste",
  fantasia: "Teste",
  abertura: "01/02/2024",
  telefone: "(81) 99999-9999 / (81) 98888-8888",
  municipio: "Recife",
  uf: "PE",
  atividade_principal: [{ code: "82.30-0-01", text: "Serviços" }],
};
test("Farm prefers BrasilAPI and does not request fallback after success", async () => {
  const urls = [];
  const r = await lookupFarmCnpj(id, async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, "manual");
    assert.match(options.headers["User-Agent"], /^BigCloak-Farm/);
    return Response.json(brasil);
  });
  assert.equal(r.source, "BrasilAPI");
  assert.equal(r.data.abertura, "01/02/2024");
  assert.equal(urls.length, 1);
});
test("Farm falls back to existing ReceitaWS provider for blocked, unavailable, malformed and timed-out responses", async () => {
  for (const first of [
    () => new Response("Forbidden", { status: 403 }),
    () => new Response("", { status: 429 }),
    () => new Response("", { status: 500 }),
    () => new Response("not json"),
    () => Response.json({}),
    () => {
      throw new Error("timeout");
    },
  ]) {
    const urls = [];
    const r = await lookupFarmCnpj(id, async (url, options) => {
      urls.push(url);
      assert.equal(options.redirect, "manual");
      return urls.length === 1 ? first() : Response.json(receita);
    });
    assert.equal(r.source, "ReceitaWS");
    assert.equal(r.fallback, true);
    assert.equal(r.data.razao, receita.nome);
    assert.equal(r.data.telefone, "81999999999");
    assert.equal(r.data.abertura, "01/02/2024");
    assert.equal(r.data.atividade, "82.30-0-01 - Serviços");
    assert.equal(urls.length, 2);
  }
});
test("Farm reports provider-specific failures and never accepts a different CNPJ", async () => {
  await assert.rejects(
    () =>
      lookupFarmCnpj(id, async (url) =>
        url.includes("brasilapi")
          ? new Response("", { status: 503 })
          : new Response("", { status: 429 }),
      ),
    (e) =>
      /BrasilAPI.*503/.test(e.message) &&
      /ReceitaWS.*429/.test(e.message) &&
      /manualmente/.test(e.message),
  );
  await assert.rejects(
    () =>
      lookupFarmCnpj(id, async (url) =>
        Response.json(
          url.includes("brasilapi")
            ? { ...brasil, cnpj: "00000000000000" }
            : { ...receita, cnpj: "00000000000000" },
        ),
      ),
    /divergente/,
  );
  await assert.rejects(
    () =>
      lookupFarmCnpj("123", () => {
        throw Error("must not fetch");
      }),
    /CNPJ/,
  );
});

