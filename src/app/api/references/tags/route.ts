/**
 * GET /api/references/tags — valores por dimensão (niche/style/vibe/material/…).
 *
 * A agregação faz `$objectToArray` + `$unwind` DUPLO sobre a coleção inteira, e a home
 * chamava isso a cada mount. O resultado muda só quando o acervo muda (ingest/publish),
 * então cacheia em processo com o mesmo TTL do catálogo da busca.
 *
 * NÃO confundir com `/api/references/facets`: aquele conta o que o GRID mostra (Mongo +
 * filesystem, com o overlay do settings.json) e é o que manda nos filtros de estúdio e
 * aspecto. Este aqui é só o detalhamento por dimensão, que só existe nos docs do Mongo.
 */
import { NextResponse } from "next/server";
import { contarDimensoes } from "@/lib/dimension-counts";

type DimensionTags = Record<string, Array<{ value: string; count: number }>>;

const TTL_MS = 60_000;
let cache: { data: DimensionTags; at: number } | null = null;
let inflight: Promise<DimensionTags> | null = null;

export async function GET() {
  try {
    return NextResponse.json(await getDimensionTags());
  } catch (e) {
    // Catálogo fora do ar não pode derrubar a home — sem dimensões, o filtro
    // some, o grid fica.
    console.error("[tags] catálogo indisponível:", e instanceof Error ? e.message : e);
    return NextResponse.json(cache?.data ?? {});
  }
}

async function getDimensionTags(): Promise<DimensionTags> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  // Dedup de chamadas concorrentes: vários mounts simultâneos disparavam a mesma
  // agregação pesada em paralelo.
  inflight ??= dimensionTags()
    .then((data) => { cache = { data, at: Date.now() }; return data; })
    .finally(() => { inflight = null; });
  return inflight;
}

async function dimensionTags(): Promise<DimensionTags> {
  // A contagem mora em `dimension-counts` porque este pipeline era IGUAL ao do
  // `brand-match.getTaxonomy()` — e era o único `aggregate` do projeto, ou seja,
  // a única coisa que impedia o app de rodar sem Mongo depois que o catálogo
  // virou local (o driver SQLite não implementa `aggregate`).
  const linhas = await contarDimensoes();
  const tags: DimensionTags = {};
  for (const { dim, value, count } of linhas) {
    (tags[dim] ??= []).push({ value, count });
  }
  return tags;
}
