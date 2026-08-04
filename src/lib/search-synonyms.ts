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

/**
 * Vocabulário de CONTEXTO (setor/vibe) — a ponte entre o que o usuário pensa e o que o
 * acervo escreve.
 *
 * Ninguém taggeia mockup com "engenharia": o acervo diz `construction`, `industrial`,
 * `hoarding`, `safety`. Então "engenharia" devolvia zero — não por falta de material, mas
 * por falta de vocabulário. Cada entrada aqui é um termo de INTENÇÃO apontando para os
 * termos que existem de fato no acervo.
 *
 * Diferente de `GROUPS`, isto é de MÃO ÚNICA. Grupo é classe de equivalência (quem digita
 * "outdoor" quer o mesmo que quem digita "billboard"); setor é hierarquia. Se fosse
 * simétrico, quem digitasse "coffee" levaria padaria, vinho e restaurante junto — perderia
 * a precisão de quem sabe o que quer. Quem pede o setor recebe o setor; quem pede a coisa
 * recebe a coisa.
 *
 * Regra de curadoria (medida, não achada — contagem sobre os 5892 docs do catálogo):
 * - Só entra como destino o termo que EXISTE no acervo. Sinônimo apontando para vocabulário
 *   inexistente é recall de mentira: a query deixa de dar zero e passa a dar zero mais caro.
 * - Fica de fora o termo genérico demais, mesmo sendo do setor: `building` (598 docs),
 *   `concrete` (739), `professional` (1018), `digital` (278). Um deles no cluster e a busca
 *   de setor devolve 10% do acervo — que é o mesmo que não filtrar nada.
 * - Fica de fora `car`: com prefix-match ligado, "car" casa card/cardboard/cards, e o acervo
 *   é feito de cartão. É a mesma armadilha do "t-shirt", agora por prefixo em vez de hífen.
 * - `organic` também ficou fora do agro: no acervo ele quase sempre é forma orgânica de
 *   design, não alimento orgânico.
 *
 * Os apelidos (chaves) podem não existir no acervo — é o ponto: é o que o usuário digita.
 */
const VIBES: { when: string[]; to: string[] }[] = [
  {
    when: ["engenharia", "engineering", "construcao", "construtora", "empreiteira", "obra", "obras", "canteiro", "construction", "industria", "industry"],
    to: ["construction", "industrial", "engineering", "hoarding", "safety", "steel", "manufacturing", "logistics", "helmet"],
  },
  {
    when: ["saude", "health", "healthcare", "medicina", "medico", "clinica", "hospital", "farmacia", "medical", "laboratorio"],
    to: ["medical", "clinical", "healthcare", "wellness", "scientific", "biotech", "science"],
  },
  {
    when: ["moda", "fashion", "estilista", "confeccao", "grife", "streetwear", "vestuario"],
    to: ["fashion", "apparel", "clothing", "streetwear", "textile", "boutique", "footwear", "casualwear", "denim", "knitted"],
  },
  {
    when: ["gastronomia", "gastronomy", "comida", "culinaria", "padaria", "cafeteria", "bebida", "bebidas", "chef", "delivery"],
    to: ["food", "beverage", "restaurant", "bakery", "cafe", "coffee", "culinary", "gourmet", "menu", "wine", "cocktails", "tableware"],
  },
  {
    when: ["tecnologia", "technology", "startup", "saas", "software", "tech", "programacao", "eletronico", "eletronicos"],
    to: ["tech", "software", "technology", "electronics", "hardware", "interface", "gadget", "device"],
  },
  {
    when: ["educacao", "education", "escola", "school", "universidade", "university", "faculdade", "ensino", "academico", "curso"],
    to: ["education", "educational", "academic", "university", "campus", "publishing"],
  },
  {
    when: ["esporte", "esportes", "sport", "sports", "fitness", "academia", "ginasio", "atleta", "athletic", "treino"],
    to: ["sports", "fitness", "athletic", "athletics", "running", "soccer", "hockey", "cycling", "golf", "olympics", "stadium", "jersey"],
  },
  {
    when: ["imobiliario", "imobiliaria", "imovel", "imoveis", "corretor", "realtor", "realty", "estate", "incorporadora"],
    to: ["estate", "residential", "architecture", "architectural", "interior"],
  },
  {
    when: ["automotivo", "automotive", "carro", "carros", "veiculo", "veiculos", "concessionaria", "oficina", "moto", "auto"],
    to: ["automotive", "vehicle", "truck", "van", "transport", "transportation", "transit", "moto"],
  },
  {
    when: ["beleza", "beauty", "cosmetico", "cosmeticos", "cosmetics", "maquiagem", "salao", "barbearia", "estetica", "skincare", "perfumaria"],
    to: ["beauty", "cosmetics", "skincare", "barbershop", "nails", "hair", "wellness", "jewelry"],
  },
  {
    when: ["juridico", "advocacia", "advogado", "legal", "financeiro", "finance", "banco", "contabilidade", "consultoria", "consulting", "seguradora"],
    to: ["legal", "corporate", "finance", "financial", "insurance", "consulting", "institutional", "official"],
  },
  {
    when: ["musica", "music", "evento", "eventos", "show", "shows", "festival", "banda", "balada", "nightlife", "concert", "concerts"],
    to: ["music", "concerts", "festival", "nightlife", "event", "events", "venue", "stage", "entertainment"],
  },
  {
    when: ["varejo", "retail", "comercio", "ecommerce", "pdv", "franquia", "supermercado"],
    to: ["retail", "store", "storefront", "shopping", "commerce", "merchandising", "boutique"],
  },
  {
    when: ["viagem", "turismo", "travel", "tourism", "hotelaria", "hospedagem", "ferias", "resort", "hotel", "pousada"],
    to: ["travel", "tourism", "hotel", "resort", "hospitality", "airport", "beach", "coastal", "tropical", "scenic"],
  },
  {
    when: ["agro", "agronegocio", "agriculture", "agricultura", "fazenda", "rural", "plantacao", "colheita"],
    to: ["agriculture", "farm", "nature", "plants", "greenery", "foliage", "vegetation", "grass"],
  },
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

/**
 * Mão única: só a CHAVE (o termo de setor) leva ao cluster. O destino não volta.
 * Passa pelo mesmo `toTokens` dos grupos — nenhum caco curto, nenhum termo com separador.
 */
const VIBE_EXPANSIONS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const { when, to } of VIBES) {
    const dest = [...new Set(to.flatMap(toTokens))];
    for (const alias of when.flatMap(toTokens)) {
      m.set(alias, [...new Set([...(m.get(alias) ?? []), ...dest])]);
    }
  }
  return m;
})();

/** Expande um termo para sua classe de equivalência + o cluster de setor (inclui o próprio termo). */
export function expandTerm(term: string): string[] {
  const t = foldTerm(term);
  if (!t) return [];
  const base = EXPANSIONS.get(t) ?? [t];
  const vibe = VIBE_EXPANSIONS.get(t);
  return vibe ? [...new Set([...base, ...vibe])] : base;
}

export { MIN_SYNONYM_LEN };

/** Só pra debug/teste: quantos termos o dicionário cobre. */
export const SYNONYM_TERM_COUNT = EXPANSIONS.size;

/** Só pra debug/teste: quantos termos de intenção (setor/vibe) têm cluster. */
export const VIBE_TERM_COUNT = VIBE_EXPANSIONS.size;
