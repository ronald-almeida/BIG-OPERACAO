import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCnpj, lookupCnpj } from "../src/farm/cnpj.mjs";
test("CNPJ validates check digits and maps only public company fields", async () => {
  assert.equal(normalizeCnpj("19.131.243/0001-97"), "19131243000197");
  for (const id of ["11111111111111", "19131243000198", "x", ""])
    assert.throws(() => normalizeCnpj(id));
  const result = await lookupCnpj("19131243000197", async (url, opts) => {
    assert.equal(url, "https://receitaws.com.br/v1/cnpj/19131243000197");
    assert.equal(opts.redirect, "manual");
    return Response.json({
      cnpj: "19131243000197",
      nome: "Empresa teste",
      municipio: "Salvador",
      uf: "BA",
      abertura: "02/01/2010",
      atividade_principal: [{ text: "Atividade principal" }],
      atividades_secundarias: [
        { text: "Atividade principal" },
        { text: "Outra atividade" },
      ],
      ddd_telefone_1: "71999999999",
      qsa: [{ nome_socio: "Não deve retornar" }],
    });
  });
  assert.equal(result.fields.company, "Empresa teste");
  assert.equal(result.fields.city, "Salvador / BA");
  assert.equal(result.fields.opening_date, "2010-01-02");
  assert.deepEqual(result.fields.services, [
    "Atividade principal",
    "Outra atividade",
  ]);
  assert.equal(result.fields.whatsapp, undefined);
  assert.equal(result.qsa, undefined);
  await assert.rejects(
    lookupCnpj("19131243000197", async () => new Response("", { status: 404 })),
    /não encontrado/,
  );
  await assert.rejects(
    lookupCnpj("19131243000197", async () => new Response("", { status: 429 })),
    /Limite/,
  );
  await assert.rejects(
    lookupCnpj("19131243000197", async () => {
      throw new Error("network");
    }),
    /indisponível/,
  );
  await assert.rejects(
    lookupCnpj("19131243000197", async () => Response.json({ cnpj: "wrong" })),
    /incompletos/,
  );
});

