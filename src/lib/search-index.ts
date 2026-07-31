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
  buildIndex, runSearch, computeFacets,
  type SearchDoc, type SearchQuery, type Facets, type AspectBucket,
} from "./search-engine";
import { logQuery, getBoostFn } from "./search-telemetry";

export { aspectBucket, type SearchDoc, type SearchQuery, type Facets, type AspectBucket } from "./search-engine";

const PREVIEW_DIR = join(process.cwd(), "public", "photo-previews");
const CATALOG_TTL_MS = 60_000;

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

let catalogCache: { docs: SearchDoc[]; at: number } | null = null;
let indexCache: MiniSearch<SearchDoc> | null = null;
let building: Promise<SearchDoc[]> | null = null;

export function invalidateCatalog() {
  catalogCache = null;
  indexCache = null;
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

  return merged;
}

function refresh(): Promise<SearchDoc[]> {
  // Dedup de builds concorrentes: 10 requests simultâneos varriam o disco 10 vezes.
  building ??= buildCatalog()
    .then((docs) => {
      catalogCache = { docs, at: Date.now() };
      indexCache = null;
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
async function getCatalog(): Promise<SearchDoc[]> {
  if (catalogCache) {
    if (Date.now() - catalogCache.at >= CATALOG_TTL_MS) refresh().catch(() => {});
    return catalogCache.docs;
  }
  return refresh();
}

async function getIndex(): Promise<{ mini: MiniSearch<SearchDoc>; docs: SearchDoc[] }> {
  const docs = await getCatalog();
  indexCache ??= buildIndex(docs);
  return { mini: indexCache, docs };
}

// ---------------------------------------------------------------- API pública

export async function searchRefs(q: SearchQuery) {
  const t0 = Date.now();
  const { mini, docs } = await getIndex();
  const term = q.search?.trim() ?? "";
  // Popularidade só entra quando há texto — numa listagem sem busca a ordem é alfabética
  // e previsível de propósito.
  const boost = term ? await getBoostFn(term) : undefined;
  const { pass, ...result } = runSearch(docs, mini, q, boost);

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
