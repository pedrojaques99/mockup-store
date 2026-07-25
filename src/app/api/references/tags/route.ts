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
import { getDb } from "@/lib/db";

type DimensionTags = Record<string, Array<{ value: string; count: number }>>;

const TTL_MS = 60_000;
let cache: { data: DimensionTags; at: number } | null = null;
let inflight: Promise<DimensionTags> | null = null;

export async function GET() {
  try {
    return NextResponse.json(await getDimensionTags());
  } catch (e) {
    // Mongo offline não pode derrubar a home — sem dimensões, o filtro some, o grid fica.
    console.error("[tags] Mongo indisponível:", e instanceof Error ? e.message : e);
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
  const db = await getDb();

  const pipeline = [
    { $match: { category: "reference", isAdminCurated: true } },
    { $project: { dimensions: { $objectToArray: "$dimensions" } } },
    { $unwind: "$dimensions" },
    { $unwind: "$dimensions.v" },
    {
      $group: {
        _id: { dim: "$dimensions.k", value: "$dimensions.v" },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 as const } },
    // Teto de segurança: sem isto a agregação devolvia o produto cartesiano inteiro de
    // dimensão × valor, e a UI só mostra as primeiras dezenas de cada uma.
    { $limit: 2_000 },
  ];

  const raw = await db.collection("community_presets").aggregate(pipeline).toArray();

  const tags: DimensionTags = {};
  for (const r of raw) {
    const dim = r._id.dim;
    if (!tags[dim]) tags[dim] = [];
    tags[dim].push({ value: r._id.value, count: r.count });
  }

  return tags;
}
