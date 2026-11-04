import { farmTemplate } from "./farm-template.mjs";
import { farmThemes } from "../../shared/farm.mjs";
export const escapeHTML = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderFarm(data, theme, head = "") {
  if (!farmThemes.some((t) => t.id === theme)) throw Error("Estilo inválido.");
  const name = data.fantasia || data.razao;
  const phone = String(data.telefone || "").replace(/\D/g, "");
  const international =
    phone.length > 11 && phone.startsWith("55") ? phone : "55" + phone;
  const local = [data.cidade, data.uf].filter(Boolean).join(" - ");
  const values = {
    nomeExibicao: name,
    razaoSocial: data.razao,
    documento: String(data.cnpj).replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5",
    ),
    dataAbertura: data.abertura,
    ramoAtividade: data.atividade,
    localizacao: local,
    telefone: phone ? "+" + international : "",
    emailExibicao: data.email,
    anoAtual: new Date().getFullYear(),
    initial: name?.charAt(0).toUpperCase(),
    title: name + " | " + (data.atividade || "Atendimento profissional"),
    description:
      (data.atividade || "Serviços profissionais") +
      (local ? " em " + local : "") +
      ".",
  };
  const links = {
    linkWhats: phone ? "https://wa.me/" + international : "#contato",
    telefone: phone ? "tel:+" + international : "#contato",
  };
  // Substitute once: company text cannot introduce another template placeholder.
  const html = farmTemplate.replace(
    /\{\{(?:(text|link):([^}]+)|(theme))\}\}/g,
    (_, type, key) =>
      escapeHTML(
        type === "text" ? values[key] : type === "link" ? links[key] : theme,
      ),
  );
  // Keep the original theme palettes while ensuring hero cards and CTA remain legible.
  const contrast = '<style>.vw-ficha div{color:var(--texto)}.vw-ficha small{color:var(--texto-2)}.vw-capa .vw-acao-secundaria{color:var(--capa-texto);border-color:currentColor}</style>';
  return html.replace("</head>", () => contrast + head + "\n</head>");
}

