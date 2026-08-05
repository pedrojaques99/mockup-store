/**
 * search-index — o CATÁLOGO da busca: carrega, funde, cacheia e invalida.
 *
 * O ranking em si mora em `search-engine.ts` (puro, testável). Aqui é só a parte suja:
 * Mongo (PSDs + cenas publicadas) ⊕ filesystem (cenas calibradas), com o `settings.json`
 * como SSoT de studio/tags por cima do doc do Mongo.
 *
 * O problema que isto resolveu: Mongo e filesystem eram buscados por algoritmos
 * DIFERENTES e colados no fim — `$text` de um lado, `String.includes()` do outro — então
 * a mesma query rankeava incoerente, e o `textScore` do Mongo ainda era descartado pela
 * ordenação alfabética do merge. Uma fonte de verdade, um ranking.
 */
import { existsSync } from "fs";
import { join } from "path";
import type MiniSearch from "minisearch";
import { getDb } from "./db";
import { findPsdForRef } from "./psd-index";
import { listPhotoScenes, type SceneInfo } from "./agent-mockup";
import {
  buildIndex, runSearch, computeFacets, borrowSiblingThumbnails,
  type SearchDoc, type SearchQuery, type Facets, type AspectBucket,
} from "./search-engine";
import { logQuery, getBoostFn } from "./search-telemetry";
import { getHidden } from "./hidden-store";
import { semanticRank } from "./semantic-index";
import { filtrarPsdsSumidos } from "./psd-presence";

export { aspectBucket, type SearchDoc, type SearchQuery, type Facets, type AspectBucket } from "./search-engine";

const PREVIEW_DIR = join(process.cwd(), "public", "photo-previews");

/**
 * Janela do stale-while-revalidate. Era 60s, e isso custava caro em memória: o
 * rebuild é um scan completo (Mongo + PSD no disco + cenas, ~6s) que aloca um
 * array novo de ~4.5k docs e — pelo `visibleCache = null` logo abaixo — jogava
 * fora o índice MiniSearch para reconstruí-lo do zero. A cada minuto de uso.
 * Medido no dev: a RSS subia ~100 MB por rodada de carga e não voltava.
 *
 * 5 min é o compromisso: escrita DENTRO do app já invalida na hora
 * (`invalidateCatalog()` no ingest e no publish) e esconder tem versão própria,
 * então a janela só vale para escrita FEITA POR FORA (os scripts do CLI).
 * `CATALOG_TTL_MS` no ambiente ajusta para quem estiver batendo CLI e UI juntos.
 */
const CATALOG_TTL_MS = Number(process.env.CATALOG_TTL_MS) || 300_000;

/**
 * Thumbnail da cena. Preferimos `.webp` (os previews passaram a ser gerados reduzidos —
 * o PNG cru chegava a 17 MB por card) e caímos pro `.png` legado enquanto não roda o
 * `scripts/regen-previews.ts` no acervo antigo.
 */
function previewUrlFor(id: string): string | undefined {
  if (existsSync(join(PREVIEW_DIR, `${id}.webp`))) return `/photo-previews/${id}.webp`;
  if (existsSync(join(PREVIEW_DIR, `${id}.png`))) return `/photo-previews/${id}.png`;
  return undefined;
}

/** SSoT de studio/tags de uma cena = settings.json (o que `photo-agent tag` escreve). */
export function sceneStudioOf(s: SceneInfo) {
  return s.studio ?? (s.published ? "Photo Scene" : "Local");
}
export function sceneTagsOf(s: SceneInfo) {
  return [s.surfaceType, "photo", s.published ? "publicada" : "local", ...(s.tags ?? [])];
}

const TAG_DIMS = ["niche", "style", "vibe", "material", "mockup_type", "setting", "color_palette"];

function dimsToTags(dimensions: Record<string, unknown> | undefined): string[] {
  if (!dimensions) return [];
  const out: string[] = [];
  for (const dim of TAG_DIMS) {
    const v = dimensions[dim];
    if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
    else if (typeof v === "string") out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- catálogo

let catalogCache: { docs: SearchDoc[]; at: number; fp: string } | null = null;
let visibleCache: VisibleView | null = null;
let building: Promise<SearchDoc[]> | null = null;

/** Placar do último rebuild: quanto o disco desmentiu o Mongo. Ver `catalogStats()`. */
let ultimaPresenca: {
  removidos: number;
  pastasSumidas: number;
  raizesOffline: string[];
  abortadoPeloTeto: boolean;
} = { removidos: 0, pastasSumidas: 0, raizesOffline: [], abortadoPeloTeto: false };

interface VisibleView {
  docs: SearchDoc[];
  mini: MiniSearch<SearchDoc> | null;
  /** Carimbo do catálogo cru e da lista de escondidos que geraram esta view. */
  catAt: number;
  hiddenVersion: number;
}

export function invalidateCatalog() {
  catalogCache = null;
  visibleCache = null;
}

/** O que este módulo está segurando na memória. Consumido por `/api/diag/memory`. */
export function catalogStats() {
  return {
    docs: catalogCache?.docs.length ?? 0,
    idadeSeg: catalogCache ? Math.round((Date.now() - catalogCache.at) / 1000) : null,
    ttlSeg: Math.round(CATALOG_TTL_MS / 1000),
    fingerprint: catalogCache?.fp ?? null,
    visiveis: visibleCache?.docs.length ?? 0,
    indiceMontado: !!visibleCache?.mini,
    rebuildEmVoo: !!building,
    presenca: ultimaPresenca,
  };
}

async function fetchMongoDocs(): Promise<SearchDoc[]> {
  try {
    const db = await getDb();
    const col = db.collection("community_presets");
    const rows = await col
      .find(
        { category: "reference", isAdminCurated: true },
        {
          projection: {
            id: 1, name: 1, studio: 1, description: 1, referenceImageUrl: 1, dimensions: 1,
            tags: 1, psdFileName: 1, psdPath: 1, smartObjectName: 1, soInnerWidth: 1,
            soInnerHeight: 1, type: 1, photoSceneId: 1,
          },
        },
      )
      .limit(20_000)
      .toArray();

    return rows.map((ref) => {
      let psdPath = ref.psdPath as string | undefined;
      let psdFileName = ref.psdFileName as string | undefined;
      let psdSizeBytes: number | undefined;
      if (!psdPath) {
        const psd = findPsdForRef(psdFileName || (ref.name as string), ref.studio as string);
        if (psd) {
          psdPath = psd.path;
          psdSizeBytes = psd.sizeBytes;
          psdFileName ??= psd.name;
        }
      }
      const dimensions = ref.dimensions as Record<string, unknown> | undefined;
      const mockupType = Array.isArray(dimensions?.mockup_type)
        ? (dimensions!.mockup_type as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const w = ref.soInnerWidth as number | undefined;
      const h = ref.soInnerHeight as number | undefined;
      return {
        id: ref.id as string,
        name: (ref.name as string) ?? "",
        studio: (ref.studio as string) ?? "Unknown",
        description: (ref.description as string) ?? "",
        referenceImageUrl: ref.referenceImageUrl as string | undefined,
        dimensions,
        tags: [...new Set([...(Array.isArray(ref.tags) ? ref.tags.filter((t: unknown): t is string => typeof t === "string") : []), ...dimsToTags(dimensions)])],
        psdFileName, psdPath, psdSizeBytes,
        smartObjectName: ref.smartObjectName as string | undefined,
        soInnerWidth: w, soInnerHeight: h,
        type: ref.type as string | undefined,
        photoSceneId: ref.photoSceneId as string | undefined,
        mockupType,
        aspect: w && h ? w / h : undefined,
        source: "mongo" as const,
      };
    });
  } catch (e) {
    // Mongo offline nunca pode deixar a home em skeleton eterno — segue só com o filesystem.
    console.error("[search-index] Mongo indisponível:", e instanceof Error ? e.message : e);
    return [];
  }
}

function sceneToDoc(s: SceneInfo): SearchDoc {
  return {
    id: s.id,
    name: s.name.replace(/\.[^.]+$/, ""),
    studio: sceneStudioOf(s),
    description: `${s.surfaceType} photo mockup`,
    referenceImageUrl: previewUrlFor(s.id),
    dimensions: { mockup_type: [s.surfaceType] },
    tags: sceneTagsOf(s),
    type: "photo",
    photoSceneId: s.id,
    mockupType: [s.surfaceType],
    aspect: s.aspect,
    source: "fs",
  };
}

/**
 * Catálogo unificado: Mongo + filesystem, com overlay do settings.json por cima do doc
 * do Mongo (publishes antigos gravavam `studio: "Photo Scene"` chapado — o arquivo manda).
 */
async function buildCatalog(): Promise<SearchDoc[]> {
  const [mongoDocs, scenes] = await Promise.all([
    fetchMongoDocs(),
    listPhotoScenes().catch(() => [] as SceneInfo[]),
  ]);
  const sceneMeta = new Map(scenes.map((s) => [s.id, s]));

  const merged = mongoDocs.map((d) => {
    const s = sceneMeta.get(d.photoSceneId ?? d.id);
    if (!s) return d;
    return {
      ...d,
      studio: s.studio ?? d.studio ?? sceneStudioOf(s),
      tags: [...new Set([...d.tags, ...sceneTagsOf(s)])],
      aspect: s.aspect ?? d.aspect,
      // O doc do Mongo pode apontar pro `.png` legado que já foi convertido.
      referenceImageUrl: previewUrlFor(s.id) ?? d.referenceImageUrl,
    };
  });

  const seen = new Set(merged.flatMap((d) => [d.id, d.photoSceneId].filter(Boolean) as string[]));
  for (const s of scenes) if (!seen.has(s.id)) merged.push(sceneToDoc(s));

  // Empresta a thumbnail do irmão (`X.psd` ⟷ `X Pequena.jpeg`) — medido: 27,5% da
  // primeira página do acervo renderizava um placeholder cinza tendo a foto do
  // MESMO mockup a um registro de distância. Correção de leitura, não de escrita:
  // o Mongo não é tocado, e um reingest limpo continua sendo o conserto de verdade.
  const { docs: withThumbs, borrowed } = borrowSiblingThumbnails(merged);
  if (borrowed) console.log(`[search-index] ${borrowed} thumbnails herdadas de irmão de mesmo nome-base`);

  // O disco manda: PSD apagado não vira card. Só de leitura — quem limpa o Mongo
  // é `npm run psd:prune`, porque disco de rede que pisca não pode apagar banco.
  const presenca = filtrarPsdsSumidos(withThumbs);
  ultimaPresenca = {
    removidos: presenca.removidos,
    pastasSumidas: presenca.pastasSumidas.length,
    raizesOffline: presenca.raizesOffline,
    abortadoPeloTeto: presenca.abortadoPeloTeto,
  };
  if (presenca.abortadoPeloTeto) {
    console.warn(
      "[search-index] mais da metade dos PSDs sumiu de uma vez — tratando como disco fora do ar, nada foi escondido",
    );
  } else if (presenca.removidos) {
    console.log(
      `[search-index] ${presenca.removidos} registro(s) escondidos: PSD não está mais no disco ` +
        `(${presenca.pastasSumidas.length} pasta(s)). Rode \`npm run psd:prune\` para limpar o Mongo.`,
    );
  }
  if (presenca.raizesOffline.length) {
    console.warn(`[search-index] raiz do PSD_DIRS inacessível, ignorada: ${presenca.raizesOffline.join(", ")}`);
  }

  return presenca.docs;
}

/**
 * Impressão digital do catálogo: muda quando muda algo que a busca enxerga.
 * Não é hash criptográfico — é um resumo barato (id + o que o ranking indexa)
 * para responder UMA pergunta: "o rebuild trouxe a mesma coisa?".
 */
function fingerprint(docs: SearchDoc[]): string {
  let h = 5381;
  for (const d of docs) {
    const s = `${d.id}|${d.name}|${d.studio}|${d.aspect}|${d.referenceImageUrl ?? ""}|${d.tags.length}`;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return `${docs.length}:${h.toString(36)}`;
}

function refresh(): Promise<SearchDoc[]> {
  // Dedup de builds concorrentes: 10 requests simultâneos varriam o disco 10 vezes.
  building ??= buildCatalog()
    .then((docs) => {
      // O rebuild quase sempre devolve EXATAMENTE o mesmo catálogo — o acervo não
      // muda sozinho a cada 5 minutos. Antes, mesmo assim, o `visibleCache = null`
      // descartava o índice MiniSearch inteiro (4.5k docs) e a próxima busca pagava
      // para reconstruí-lo, deixando o anterior de lixo para o GC. Comparando a
      // impressão digital, catálogo igual = índice preservado, zero alocação.
      const fp = fingerprint(docs);
      if (catalogCache && catalogCache.fp === fp) {
        catalogCache.at = Date.now(); // só re-carimba: docs e índice seguem válidos
        return catalogCache.docs;
      }
      catalogCache = { docs, at: Date.now(), fp };
      visibleCache = null;
      return docs;
    })
    .finally(() => { building = null; });
  return building;
}

/**
 * Stale-while-revalidate. Montar o catálogo custa ~6s (Mongo + resolução de PSD no disco
 * + leitura das cenas); com TTL puro, um usuário por minuto pagava esses 6s na cara. Aqui
 * o cache vencido é servido na hora e o rebuild acontece atrás — ninguém espera.
 */
async function getRawCatalog(): Promise<SearchDoc[]> {
  if (catalogCache) {
    if (Date.now() - catalogCache.at >= CATALOG_TTL_MS) refresh().catch(() => {});
    return catalogCache.docs;
  }
  return refresh();
}

/**
 * O catálogo menos os itens escondidos.
 *
 * Esconder um card não pode custar os ~6s de rebuild do catálogo cru, e o índice
 * MiniSearch não pode continuar servindo o que foi escondido. Então a view
 * visível é memoizada por (carimbo do catálogo, versão da lista de escondidos):
 * esconder invalida só a view — o catálogo cru e sua janela de 60s ficam de pé.
 */
async function getCatalog(): Promise<SearchDoc[]> {
  return (await getVisible()).docs;
}

async function getVisible(): Promise<VisibleView> {
  const all = await getRawCatalog();
  const { ids, version } = await getHidden();
  const catAt = catalogCache?.at ?? 0;
  if (!visibleCache || visibleCache.catAt !== catAt || visibleCache.hiddenVersion !== version) {
    visibleCache = {
      docs: ids.size ? all.filter((d) => !ids.has(d.id)) : all,
      mini: null,
      catAt,
      hiddenVersion: version,
    };
  }
  return visibleCache;
}

async function getIndex(): Promise<{ mini: MiniSearch<SearchDoc>; docs: SearchDoc[] }> {
  const view = await getVisible();
  view.mini ??= buildIndex(view.docs);
  return { mini: view.mini, docs: view.docs };
}

/**
 * Ids do catálogo que apontam para estes arquivos.
 *
 * O painel de duplicatas só conhece caminho no disco; o catálogo é indexado por
 * id. E a relação não é 1:1 — duas refs do Mongo podem resolver para o mesmo
 * `.psd`, então esconder "esse arquivo" tem de esconder todos os cards dele.
 */
export async function refIdsByPsdPath(paths: string[]): Promise<string[]> {
  const wanted = new Set(paths.map((p) => p.replace(/\\/g, "/").toLowerCase()));
  if (!wanted.size) return [];
  const all = await getRawCatalog();
  return all
    .filter((d) => d.psdPath && wanted.has(d.psdPath.replace(/\\/g, "/").toLowerCase()))
    .map((d) => d.id);
}

/** Os docs escondidos, para o painel de gerenciamento ("mostrar ocultos"). */
export async function hiddenRefs(): Promise<SearchDoc[]> {
  const { ids } = await getHidden();
  if (!ids.size) return [];
  return (await getRawCatalog()).filter((d) => ids.has(d.id));
}

// ---------------------------------------------------------------- API pública

// ---------------------------------------------------------------- viés de marca (home)

/**
 * Ids que a sugestão brand-aware devolve para a marca ativa, cacheados.
 *
 * A home embaralhada pede esses ids a cada carga; a sugestão custa uma ida à Visant e um
 * score sobre 600 candidatos do Mongo. Sem cache, "abrir a home" viraria a operação mais
 * cara do produto. E se a Visant estiver fora, o viés simplesmente não acontece — a home
 * embaralha sem marca em vez de falhar, porque a galeria é a tela que não pode depender
 * de rede de terceiro.
 */
const BIAS_TTL_MS = 10 * 60_000;
const biasCache = new Map<string, { ids: string[]; at: number }>();

export async function brandBiasIds(brandId: string, limit = 40): Promise<string[]> {
  const hit = biasCache.get(brandId);
  if (hit && Date.now() - hit.at < BIAS_TTL_MS) return hit.ids;
  try {
    const { suggestForBrand } = await import("./suggest-core");
    const res = await suggestForBrand(brandId, { limit });
    const ids = res.suggestions
      .map((s) => (s.ref as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string");
    biasCache.set(brandId, { ids, at: Date.now() });
    return ids;
  } catch (e) {
    console.error("[search-index] viés de marca indisponível:", e instanceof Error ? e.message : e);
    biasCache.set(brandId, { ids: [], at: Date.now() });
    return [];
  }
}

export async function searchRefs(q: SearchQuery) {
  const t0 = Date.now();
  const { mini, docs } = await getIndex();
  const term = q.search?.trim() ?? "";
  // A popularidade entra NOS DOIS caminhos. Com texto ela desempata a relevância;
  // sem texto ela É a ordenação (`sort: "popular"`, o default). Antes o boost só
  // era carregado quando havia query — e a primeira tela de toda sessão, que é
  // justamente a sem query, ignorava tudo o que a telemetria tinha aprendido.
  // `getBoostFn("")` devolve só a popularidade global (afinidade query↔doc vazia),
  // que é exatamente o sinal certo para uma listagem.
  const boost = q.sort === "name" ? undefined : await getBoostFn(term);

  // Camada densa: só entra quando há texto, e nunca pode derrubar a busca. Embeddings
  // desligados, cache vazio ou provedor fora ⇒ `null` ⇒ o resultado é o léxico de sempre.
  let semanticIds: string[] | undefined;
  if (term) {
    try {
      semanticIds = (await semanticRank(term, { k: 120 })) ?? undefined;
    } catch (e) {
      console.error("[search-index] camada densa falhou (seguindo só no léxico):", e instanceof Error ? e.message : e);
    }
  }

  const { pass, ...result } = runSearch(docs, mini, q, boost, semanticIds);

  if (term) {
    void logQuery({
      q: term, hits: result.total, ms: Date.now() - t0, pass,
      studio: q.studio || undefined, aspect: q.aspect, tags: q.tags?.length ? q.tags : undefined,
    });
  }
  return result;
}

export async function getFacets(q: SearchQuery = {}): Promise<Facets> {
  return computeFacets(await getCatalog(), q);
}

/**
 * Busca por id, **preservando a ordem pedida**.
 *
 * É o que sustenta a busca por imagem: o ranking vem do índice vetorial da
 * Visant (`/api/search-by-image`), que devolve ids ordenados por similaridade, e
 * a renderização continua sendo a do catálogo de sempre — um formato de card só.
 * Ordenar aqui pelo catálogo (alfabético) jogaria fora exatamente a informação
 * pela qual se chamou o vetor.
 *
 * Id que não está no catálogo simplesmente não volta: é item sem PSD resolvido
 * ou fora do recorte do grid, e inventar um card vazio seria a UI mentindo sobre
 * o que ela tem.
 */
export async function refsByIds(ids: string[]): Promise<SearchDoc[]> {
  if (!ids.length) return [];
  const docs = await getCatalog();
  const byId = new Map(docs.map((d) => [d.id, d]));
  const out: SearchDoc[] = [];
  for (const id of ids) {
    const doc = byId.get(id);
    if (doc) out.push(doc);
  }
  return out;
}
