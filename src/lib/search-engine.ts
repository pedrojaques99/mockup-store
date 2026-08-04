/**
 * search-engine — o miolo PURO da busca: tipos, índice, ranking e facetas.
 *
 * Separado de `search-index.ts` (que carrega o catálogo do Mongo/disco e cuida do cache)
 * por um motivo prático: assim dá pra testar ranking e recall contra um catálogo sintético,
 * sem banco e sem filesystem. Toda regra de relevância que quebrou aqui (fuzzy que não
 * pegava typo, sinônimo com hífen inflando o recall) virou teste porque este arquivo é
 * puro — nada aqui faz I/O.
 */
import MiniSearch from "minisearch";
import { expandTerm, foldTerm } from "./search-synonyms";

export interface SearchDoc {
  id: string;
  name: string;
  studio: string;
  description: string;
  referenceImageUrl?: string;
  dimensions?: Record<string, unknown>;
  tags: string[];
  psdFileName?: string;
  psdPath?: string;
  psdSizeBytes?: number;
  smartObjectName?: string;
  soInnerWidth?: number;
  soInnerHeight?: number;
  type?: string;
  photoSceneId?: string;
  /** derivados, só pra busca/faceta */
  mockupType: string[];
  aspect?: number;
  source: "mongo" | "fs";
}

/** Formato da superfície — a faceta que o pipeline mais usa ("casar arte↔cena por aspecto"). */
export type AspectBucket = "square" | "portrait" | "landscape";

export function aspectBucket(a: number | undefined): AspectBucket | undefined {
  if (!a || !isFinite(a) || a <= 0) return undefined;
  if (a < 0.85) return "portrait";
  if (a > 1.18) return "landscape";
  return "square";
}

/**
 * Ordenação da LISTAGEM (sem query de texto). Com query quem manda é a relevância —
 * reordenar o resultado de uma busca por nome joga fora o rank que a cascata montou.
 *
 * `shuffle` é a home que muda a cada abertura: embaralhamento SEMEADO, não aleatório de
 * verdade. Aleatório de verdade re-sorteia a cada página e o usuário vê o mesmo card duas
 * vezes enquanto rola — a semente é o que faz "surpresa" e "paginação" conviverem.
 */
export type SortMode = "popular" | "name" | "shuffle";

export interface SearchQuery {
  search?: string;
  studio?: string;
  tags?: string[];
  tagMode?: "AND" | "OR";
  aspect?: AspectBucket;
  requirePsd?: boolean;
  /** Default `popular`. Ignorado quando há `search` (aí a ordem é a relevância). */
  sort?: SortMode;
  /** Semente do `sort: "shuffle"`. Mesma semente ⇒ mesma ordem, em qualquer página. */
  seed?: number;
  /**
   * Ids que o embaralhamento deve puxar para a frente — hoje, as sugestões da marca ativa.
   * Viés, não filtro: o acervo inteiro continua na lista, só que atrás.
   */
  biasIds?: string[];
  page?: number;
  limit?: number;
}

export function matchesFacets(d: SearchDoc, q: SearchQuery) {
  if (q.studio && d.studio !== q.studio) return false;
  if (q.aspect && aspectBucket(d.aspect) !== q.aspect) return false;
  if (q.requirePsd && !d.psdPath && d.type !== "photo") return false;
  if (q.tags?.length) {
    const pool = new Set([...d.tags.map(foldTerm), foldTerm(d.studio), ...d.mockupType.map(foldTerm)]);
    const has = (t: string) => pool.has(foldTerm(t));
    return q.tagMode === "OR" ? q.tags.some(has) : q.tags.every(has);
  }
  return true;
}

// ---------------------------------------------------------------- thumbnails órfãs

/**
 * Nome-base de um mockup: sem extensão e sem o sufixo de variação de tamanho.
 *
 * Os bundles do acervo vêm como `X.psd` + `X Pequena.jpeg` (ou `Média`, `preview`).
 * O ingest gravou os dois como registros separados, e a imagem de referência ficou
 * no JPEG — o PSD, que é o que o produto realmente usa, ficou sem thumbnail.
 */
export function mockupBaseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(psd|jpe?g|png|webp|tiff?)$/i, "")
    .replace(/\b(pequena|pequeno|media|média|grande|preview|small|medium|large)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Empresta a thumbnail do irmão de mesmo nome-base **e mesmo estúdio**.
 *
 * Medido no acervo real: 55 de 200 itens da primeira página não tinham
 * `referenceImageUrl` — 27,5% do grid renderizando um ícone de camadas cinza — e
 * 39 deles (71%) tinham um irmão com imagem. `01 Displacement` ficava cego enquanto
 * `01 Displacement Pequena`, o MESMO mockup, exibia a foto.
 *
 * Só empresta: nunca inventa. Item sem irmão continua sem imagem, porque o estado
 * "não temos preview deste PSD" é informação verdadeira e o grid tem de poder
 * mostrá-la. Exigir o mesmo estúdio evita casar dois mockups homônimos de acervos
 * diferentes.
 */
export function borrowSiblingThumbnails<T extends { name: string; studio: string; referenceImageUrl?: string }>(
  docs: T[],
): { docs: T[]; borrowed: number } {
  const byBase = new Map<string, string>();
  for (const d of docs) {
    if (!d.referenceImageUrl) continue;
    const key = `${d.studio}\u0000${mockupBaseName(d.name)}`;
    if (!byBase.has(key)) byBase.set(key, d.referenceImageUrl);
  }
  let borrowed = 0;
  const out = docs.map((d) => {
    if (d.referenceImageUrl) return d;
    const url = byBase.get(`${d.studio}\u0000${mockupBaseName(d.name)}`);
    if (!url) return d;
    borrowed++;
    return { ...d, referenceImageUrl: url };
  });
  return { docs: out, borrowed };
}

// ---------------------------------------------------------------- índice

const SEARCH_FIELDS = ["name", "studio", "tags", "mockupType", "description", "psdFileName", "smartObjectName"];

export function buildIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const mini = new MiniSearch<SearchDoc>({
    idField: "id",
    fields: SEARCH_FIELDS,
    storeFields: [],
    // "prédio" ≡ "predio", "Soccer248" ≡ "soccer248". Mesma normalização na query.
    processTerm: (term) => foldTerm(term) || null,
    tokenize: (text) => text.split(/[\s\-_/.,()[\]{}|]+/).filter(Boolean),
    extractField: (doc, field) => {
      const v = (doc as unknown as Record<string, unknown>)[field];
      if (Array.isArray(v)) return v.join(" ");
      return v == null ? "" : String(v);
    },
  });
  mini.addAll(docs);
  return mini;
}

/**
 * Query → expressão MiniSearch. Cada token vira um OR dos seus sinônimos, e os tokens
 * se combinam com AND: "outdoor na rua" = (outdoor|billboard|…) AND (rua|street|urbano|…).
 */
export function buildQuery(search: string) {
  const tokens = search.split(/[\s\-_/.,]+/).map(foldTerm).filter(Boolean);
  if (!tokens.length) return null;
  return {
    combineWith: "AND" as const,
    queries: tokens.map((t) => {
      const syns = expandTerm(t);
      return syns.length > 1 ? { combineWith: "OR" as const, queries: syns } : t;
    }),
  };
}

const BASE_OPTS = {
  boost: { name: 6, tags: 4, studio: 3, mockupType: 2, psdFileName: 1.5, smartObjectName: 1, description: 1 },
  prefix: true,
  weights: { fuzzy: 0.5, prefix: 0.7 },
};

/**
 * Cascata precisão → recall. Ligar fuzzy sempre inflava o resultado (uma query boa trazia
 * 2/3 do acervo) e ainda assim errava typo de 2 edições. Então: primeiro exato+prefixo;
 * só se vier pouco resultado é que afrouxa. Quem escreveu certo nunca paga o ruído de quem
 * escreveu errado.
 */
const PASSES = [
  { ...BASE_OPTS, fuzzy: 0, combineWith: "AND" as const },
  // Tolerância a erro só em termo longo — em termo curto o fuzzy vira ruído puro.
  { ...BASE_OPTS, fuzzy: (t: string) => (t.length <= 4 ? 0 : 0.34), combineWith: "AND" as const },
  { ...BASE_OPTS, fuzzy: (t: string) => (t.length <= 4 ? 0 : 0.34), combineWith: "OR" as const },
];
const ENOUGH_HITS = 5;

// ---------------------------------------------------------------- fusão densa (vibe)

/**
 * Reciprocal Rank Fusion entre a lista léxica (BM25) e a densa (embeddings).
 *
 * Fusão por score normalizado é onde esse tipo de busca costuma apodrecer: BM25 anda de 0 a 15,
 * cosseno de 0.6 a 0.95, e as distribuições não têm a mesma forma — um outlier de qualquer um
 * dos lados sequestra o ranking depois de normalizar. RRF joga os scores fora e olha só POSIÇÃO,
 * que é a única coisa comparável entre os dois motores.
 *
 * `K = 60` é a constante clássica: amortece o topo o bastante para que um 1º lugar de um motor
 * não atropele um 2º-e-3º concordantes do outro.
 *
 * Assimetria deliberada: a lista léxica tem peso maior. Quem digitou o nome exato do mockup
 * quer AQUELE mockup — a camada densa está aqui para resgatar o que não foi escrito
 * ("engenharia" → canteiro), não para opinar sobre o que já foi.
 */
const RRF_K = 60;
const LEXICAL_WEIGHT = 1.4;

export function fuseRRF(lexical: string[], semantic: string[]): string[] {
  if (!semantic.length) return lexical;
  if (!lexical.length) return semantic;
  const score = new Map<string, number>();
  const add = (ids: string[], weight: number) => {
    for (let i = 0; i < ids.length; i++) {
      score.set(ids[i], (score.get(ids[i]) ?? 0) + weight / (RRF_K + i + 1));
    }
  };
  add(lexical, LEXICAL_WEIGHT);
  add(semantic, 1);
  // Empate resolvido pela ordem léxica (estável): duas listas discordando não podem
  // produzir ordens diferentes entre requests idênticos.
  const rankLex = new Map(lexical.map((id, i) => [id, i]));
  return [...score.keys()].sort((a, b) => {
    const d = score.get(b)! - score.get(a)!;
    if (d) return d;
    return (rankLex.get(a) ?? Infinity) - (rankLex.get(b) ?? Infinity);
  });
}

// ---------------------------------------------------------------- embaralhamento semeado

/** PRNG determinístico e barato. Precisa ser reprodutível: a semente é o contrato. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Sorteio por doc, e não `array.sort(() => Math.random())`.
 *
 * O motivo é paginação: a página 2 é uma requisição nova, com o array em outra ordem de
 * entrada. Só um valor que depende de `(semente, id)` — e de mais nada — devolve a mesma
 * ordem global nas duas chamadas.
 */
function shuffleKey(id: string, seed: number): number {
  return mulberry32(hashString(id) ^ (seed >>> 0))();
}

const BIAS_WEIGHT = 0.45;
const POPULAR_WEIGHT = 0.15;
/**
 * Penalidade de card sem thumbnail. Medido na primeira captura da home embaralhada:
 * 4 dos 15 cards da primeira dobra eram "Sem prévia" — ou seja, o sorteio estava
 * gastando a área mais cara da tela com o item que não dá para escolher pelo olho.
 * Penalidade, não filtro: o item continua na lista, só não abre a galeria.
 */
const NO_PREVIEW_PENALTY = 0.35;

/**
 * A home que muda: sorteio + dois vieses fracos.
 *
 * Aleatório puro fazia a primeira dobra virar loteria — item sem thumbnail e mockup que
 * ninguém nunca abriu ocupando a área mais cara da tela. Então o sorteio manda (peso 1),
 * mas leva um empurrão de quem é sugestão da marca ativa e outro, menor, de popularidade.
 * O acervo inteiro continua na lista: é viés, não filtro.
 */
export function shuffleOrder(
  docs: SearchDoc[],
  seed: number,
  biasIds?: string[],
  boost?: BoostFn,
): SearchDoc[] {
  const bias = biasIds?.length ? new Set(biasIds) : null;
  const key = (d: SearchDoc) =>
    shuffleKey(d.id, seed) +
    (bias?.has(d.id) ? BIAS_WEIGHT : 0) +
    (boost ? boost(d.id) * POPULAR_WEIGHT : 0) -
    (d.referenceImageUrl ? 0 : NO_PREVIEW_PENALTY);
  return [...docs].sort((a, b) => key(b) - key(a) || a.id.localeCompare(b.id));
}

/** Sinal de popularidade por doc (0..1) — ver `search-signals.ts`. */
export type BoostFn = (docId: string) => number;

export interface RankedResult {
  references: SearchDoc[];
  total: number;
  page: number;
  pages: number;
  /**
   * Primeiro passe da cascata que devolveu algo (1 = exato, 3 = só resolveu no fuzzy+OR,
   * 4 = nenhum passe léxico achou nada e quem salvou foi a camada densa).
   * Sinal de telemetria: query que só vive no passe 3 é buraco de vocabulário — e no 4,
   * buraco que a busca por vibe está tapando sozinha (candidata a virar sinônimo).
   */
  pass: number;
}

/**
 * Busca + facetas + paginação sobre um catálogo já indexado. Puro: mesmas entradas,
 * mesma saída, sem I/O.
 */
export function runSearch(
  docs: SearchDoc[],
  mini: MiniSearch<SearchDoc>,
  q: SearchQuery,
  boost?: BoostFn,
  /**
   * Ids ordenados pela camada densa (embeddings), já filtrados pelas facetas por quem chamou.
   * `undefined`/vazio ⇒ a busca é exatamente a de antes. A vibe é aditiva por construção:
   * sem chave de embeddings, sem rede, sem cache — nada aqui muda.
   */
  semanticIds?: string[],
): RankedResult {
  const page = Math.max(1, q.page ?? 1);
  const limit = Math.min(Math.max(1, q.limit ?? 60), 200);
  const byId = new Map(docs.map((d) => [d.id, d]));

  let hits: SearchDoc[];
  let pass = 0;

  const expr = q.search?.trim() ? buildQuery(q.search) : null;
  if (expr) {
    // filter DENTRO do MiniSearch: facetas cortam antes do rank, e o rank sobrevive.
    const filter = (r: { id: unknown }) => {
      const d = byId.get(String(r.id));
      return !!d && matchesFacets(d, q);
    };
    // O que a galera abre/renderiza sobe: mesmo texto, ordem melhor. Multiplicador
    // deliberadamente modesto — popularidade DESEMPATA, nunca sequestra a relevância.
    const boostDocument = boost ? (id: string) => 1 + boost(id) : undefined;

    // ACUMULA, não substitui. A versão anterior trocava o resultado do passe exato pelo
    // do passe frouxo sempre que viesse pouca coisa — então uma query com 3 acertos
    // perfeitos era inundada por fuzzy+OR, e os 3 certos afundavam no meio do ruído.
    // Agora cada passe só ACRESCENTA na cauda: o que o passe exato achou fica no topo.
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < PASSES.length; i++) {
      const results = mini.search(expr, { ...PASSES[i], filter, boostDocument });
      for (const r of results) {
        const id = String(r.id);
        if (!seen.has(id)) { seen.add(id); ordered.push(id); }
      }
      if (results.length && !pass) pass = i + 1;
      if (ordered.length >= ENOUGH_HITS) break;
    }
    // A camada densa entra DEPOIS da cascata, não no lugar dela: o que a busca por vibe
    // acrescenta é recall (o mockup de canteiro de obra que ninguém taggeou "engenharia"),
    // e recall novo não pode custar a precisão de quem digitou o nome certo.
    const dense = semanticIds?.filter((id) => {
      const d = byId.get(id);
      return !!d && matchesFacets(d, q);
    });
    const fused = dense?.length ? fuseRRF(ordered, dense) : ordered;
    if (dense?.length && !pass) pass = 4; // 4 = só a camada densa achou. Buraco de vocabulário puro.
    hits = fused.map((id) => byId.get(id)!).filter(Boolean);
  } else if ((q.sort ?? "popular") === "shuffle") {
    hits = shuffleOrder(docs.filter((d) => matchesFacets(d, q)), q.seed ?? 1, q.biasIds, boost);
  } else {
    // A LISTAGEM (sem query) é a primeira tela de toda sessão, e até aqui ela era
    // `localeCompare` do nome — sempre A→Z, sem jeito de trocar. Consequência real
    // no acervo do usuário: as cinco primeiras posições eram `01`, `01 Displacement`,
    // `01 Displacement Pequena`, `01 Form Displacer`, `01 Form Displacer Pequena` —
    // variações do MESMO bundle, porque nome de arquivo não é critério de escolha
    // de mockup. Pior: a telemetria já media popularidade global
    // (`signals.docs[id]`, log-escalada e anti-feedback-loop) e esse sinal só entrava
    // no ranking QUANDO havia query. O produto jogava fora tudo o que tinha aprendido
    // exatamente na tela onde 100% das sessões começam.
    //
    // Agora o default é popularidade, com o nome como desempate — determinístico,
    // então um acervo novo (zero cliques) cai no A→Z de antes, sem surpresa.
    const filtered = docs.filter((d) => matchesFacets(d, q));
    const byName = (a: SearchDoc, b: SearchDoc) => a.name.localeCompare(b.name);
    if ((q.sort ?? "popular") === "popular" && boost) {
      const pop = new Map(filtered.map((d) => [d.id, boost(d.id)]));
      hits = filtered.sort((a, b) => (pop.get(b.id)! - pop.get(a.id)!) || byName(a, b));
    } else {
      hits = filtered.sort(byName);
    }
  }

  const start = (page - 1) * limit;
  return {
    references: hits.slice(start, start + limit),
    total: hits.length,
    page,
    pages: Math.max(1, Math.ceil(hits.length / limit)),
    pass,
  };
}

// ---------------------------------------------------------------- facetas

export interface Facets {
  studios: { name: string; count: number }[];
  tags: { name: string; count: number }[];
  aspects: { name: AspectBucket; count: number }[];
}

/** Estúdios que viraram lixo na ingestão (nomes de arquivo, não de estúdio). */
const FILE_LIKE = /\.(png|jpe?g|gif|webp|psd|psb|tiff?)$/i;

/**
 * Contagens de faceta em UMA passada sobre o catálogo — substitui as agregações separadas
 * (`/studios` e `/tags`) que ainda por cima discordavam do que o grid mostrava.
 */
export function computeFacets(docs: SearchDoc[], q: SearchQuery = {}): Facets {
  // As facetas contam o universo ANTES do próprio corte, senão cada chip zeraria os outros.
  const pool = docs.filter((d) => matchesFacets(d, { ...q, studio: undefined, tags: undefined, aspect: undefined }));

  const studios = new Map<string, number>();
  const tags = new Map<string, number>();
  const aspects = new Map<AspectBucket, number>();

  for (const d of pool) {
    if (d.studio && !FILE_LIKE.test(d.studio)) studios.set(d.studio, (studios.get(d.studio) ?? 0) + 1);
    for (const t of new Set(d.tags)) if (t) tags.set(t, (tags.get(t) ?? 0) + 1);
    const b = aspectBucket(d.aspect);
    if (b) aspects.set(b, (aspects.get(b) ?? 0) + 1);
  }

  const sorted = <T>(m: Map<T, number>) =>
    [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  return {
    studios: sorted(studios),
    tags: sorted(tags).slice(0, 120),
    aspects: sorted(aspects) as { name: AspectBucket; count: number }[],
  };
}
