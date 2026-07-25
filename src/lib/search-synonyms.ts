/**
 * Camada semântica da busca — sem embeddings, sem infra.
 *
 * O acervo é PT+EN misturado (PSDs de estúdios gringos + cenas brasileiras geradas aqui),
 * então quem digita "outdoor" precisa achar "billboard" e quem digita "camiseta" precisa
 * achar "tshirt". Cada grupo é uma classe de equivalência: qualquer termo do grupo expande
 * para todos os outros na hora da query (ver `expandTerm`).
 *
 * Termos JÁ NORMALIZADOS (minúsculo, sem acento) — a normalização vive em `foldTerm`.
 */
const GROUPS: string[][] = [
  // --- superfícies OOH ---
  // "midia"/"anuncio" ficaram DE FORA: genéricos demais, casavam com metade do acervo.
  ["outdoor", "billboard", "painel", "paineis", "placa", "ooh"],
  ["cartaz", "poster", "lambe", "lambelambe", "mural", "flyer"],
  ["banner", "faixa", "lona", "backdrop", "wallscape"],
  ["letreiro", "signage", "sign", "fachada", "storefront", "vitrine", "toldo"],
  ["busdoor", "onibus", "bus", "metro", "abrigo", "shelter", "busstop", "ponto"],
  ["totem", "kiosk", "quiosque", "stand", "displaystand"],
  // --- lugares / cenário ---
  ["rua", "street", "urbano", "urban", "cidade", "city", "calcada", "sidewalk"],
  // Prédio ≠ parede: quase todo mockup está "on a wall", então juntar os dois fazia
  // "predio" trazer metade do acervo. Grupos separados, precisão preservada.
  ["predio", "prédio", "fachada", "facade", "building", "edificio", "arranhaceu"],
  ["parede", "wall", "muro", "brick", "tijolo", "alvenaria", "concreto", "concrete"],
  ["loja", "retail", "store", "shopping", "mercado", "market"],
  ["escritorio", "office", "lobby", "corporativo", "corporate", "coworking"],
  ["restaurante", "restaurant", "cafe", "bar", "bistro", "food"],
  ["favela", "comunidade", "periferia", "morro"],
  ["noite", "night", "neon", "nocturno", "escuro", "dark"],
  ["dia", "day", "sol", "sunny", "claro", "light"],
  // --- objetos / produto ---
  ["camiseta", "tshirt", "t-shirt", "camisa", "shirt", "apparel", "roupa", "vestuario"],
  ["moletom", "hoodie", "sweatshirt", "blusa"],
  ["bone", "boné", "cap", "hat", "chapeu"],
  ["caneca", "mug", "copo", "cup", "xicara", "tumbler"],
  ["adesivo", "sticker", "decal", "selo", "seal"],
  ["sacola", "bag", "totebag", "shopper", "ecobag"],
  ["embalagem", "package", "packaging", "caixa", "box", "carton", "pouch"],
  ["garrafa", "bottle", "lata", "can", "frasco", "jar", "pote"],
  ["cartao", "card", "businesscard", "visita", "namecard"],
  ["papel", "paper", "papelaria", "stationery", "carta", "letterhead", "envelope"],
  ["livro", "book", "revista", "magazine", "catalogo", "catalog", "brochura", "brochure"],
  ["cracha", "crachá", "badge", "credencial", "lanyard"],
  ["bordado", "embroidery", "patch", "aplique"],
  // --- device ---
  ["celular", "phone", "smartphone", "mobile", "iphone", "android"],
  ["tela", "screen", "display", "monitor", "device", "dispositivo"],
  ["notebook", "laptop", "macbook", "computador", "computer", "desktop", "imac"],
  ["tablet", "ipad"],
  ["app", "aplicativo", "appicon", "icone", "icon", "ui"],
  // --- forma / material ---
  ["quadrado", "square", "1x1"],
  ["retrato", "portrait", "vertical", "story", "stories", "reels"],
  ["paisagem", "landscape", "horizontal", "wide", "16x9"],
  ["papelao", "cardboard", "kraft"],
  ["madeira", "wood", "wooden"],
  ["metal", "metalico", "aluminio", "steel", "aco"],
  ["vidro", "glass", "acrilico", "acrylic"],
  ["tecido", "fabric", "cloth", "textil", "textile", "canvas"],
];

/** minúsculo + sem acento + sem pontuação de borda. Usado na indexação E na query. */
export function foldTerm(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * Um sinônimo precisa ser UM token indexável. "t-shirt" era tokenizado em ["t","shirt"] e
 * o "t" com prefix-match trazia todo doc com palavra começando em T — 1444 de 1620 itens
 * por causa de um hífen. Sinônimo com separador é partido, e caco curto demais é jogado
 * fora (prefixo de 1–2 letras casa com meio acervo).
 */
const MIN_SYNONYM_LEN = 3;

function toTokens(term: string): string[] {
  return term
    .split(/[\s\-_/.,]+/)
    .map(foldTerm)
    .filter((t) => t.length >= MIN_SYNONYM_LEN);
}

const EXPANSIONS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const group of GROUPS) {
    const folded = [...new Set(group.flatMap(toTokens))];
    for (const term of folded) {
      // Um termo pode viver em mais de um grupo ("fachada" é prédio E letreiro) —
      // acumula em vez de sobrescrever.
      m.set(term, [...new Set([...(m.get(term) ?? []), ...folded])]);
    }
  }
  return m;
})();

/** Expande um termo para sua classe de equivalência (inclui o próprio termo). */
export function expandTerm(term: string): string[] {
  const t = foldTerm(term);
  if (!t) return [];
  return EXPANSIONS.get(t) ?? [t];
}

export { MIN_SYNONYM_LEN };

/** Só pra debug/teste: quantos termos o dicionário cobre. */
export const SYNONYM_TERM_COUNT = EXPANSIONS.size;
