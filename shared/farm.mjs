export const farmThemes = [
  {
    id: "id01",
    name: "Noturno",
  },
  {
    id: "id02",
    name: "Boreal",
  },
  {
    id: "id03",
    name: "Terroso",
  },
  {
    id: "id04",
    name: "Contraste",
  },
  {
    id: "id05",
    name: "Maré",
  },
  {
    id: "id06",
    name: "Poente",
  },
  {
    id: "id07",
    name: "Mata",
  },
  {
    id: "id08",
    name: "Néon",
  },
  {
    id: "id09",
    name: "Barro",
  },
  {
    id: "id10",
    name: "Ardósia",
  },
  {
    id: "id11",
    name: "Vinho",
  },
  {
    id: "id12",
    name: "Cítrico",
  },
  {
    id: "id13",
    name: "Glacial",
  },
  {
    id: "id14",
    name: "Safra",
  },
  {
    id: "id15",
    name: "Cobre",
  },
  {
    id: "id16",
    name: "Lagoa",
  },
  {
    id: "id17",
    name: "Grafite",
  },
  {
    id: "id18",
    name: "Framboesa",
  },
  {
    id: "id19",
    name: "Musgo",
  },
  {
    id: "id20",
    name: "Índigo",
  },
];
export function farmSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
}

export function farmHostname(site, domain) {
  return site.publish_mode === "root"
    ? domain.hostname
    : site.subdomain + "." + domain.hostname;
}
export function farmUrl(site, domain) {
  return "https://" + farmHostname(site, domain) + "/";
}


