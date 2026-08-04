/**
 * GET /api/references — grid da home.
 *
 * Adaptador fino sobre `src/lib/search-index.ts` (catálogo unificado Mongo+filesystem,
 * MiniSearch com peso por campo + prefixo + fuzzy + sinônimos PT/EN). Antes daqui viviam
 * dois algoritmos de busca concorrentes e um merge que descartava o score de relevância.
 */
import { NextRequest, NextResponse } from "next/server";
import { searchRefs, refsByIds, brandBiasIds, type AspectBucket } from "@/lib/search-index";

const ASPECTS = new Set<AspectBucket>(["square", "portrait", "landscape"]);
const SORTS = new Set(["name", "popular", "shuffle"]);

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // `ids` — hidratação de um ranking que veio de fora (busca por imagem). A
  // ordem do parâmetro É o resultado; nada aqui reordena.
  const idsParam = searchParams.get("ids");
  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
    const references = await refsByIds(ids);
    return NextResponse.json({ references, total: references.length, page: 1, pages: 1 });
  }

  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "60"), 200);
  const search = searchParams.get("search") || "";
  const studio = searchParams.get("studio") || "";
  // Multi-tag: `tags` (CSV, até 5) com modo AND/OR. Mantém compat com `tag`.
  const tags = (searchParams.get("tags") || searchParams.get("tag") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
  const tagMode = searchParams.get("tagMode") === "OR" ? "OR" : "AND";
  const aspectRaw = (searchParams.get("aspect") || "") as AspectBucket;
  const aspect = ASPECTS.has(aspectRaw) ? aspectRaw : undefined;
  const hasPsd = searchParams.get("has_psd") === "true";
  // Só a listagem ordena; com texto quem manda é a relevância (o motor ignora).
  const sortRaw = searchParams.get("sort") || "popular";
  const sort = (SORTS.has(sortRaw) ? sortRaw : "popular") as "name" | "popular" | "shuffle";

  // Home que muda: a semente vem do cliente (uma por carga da página) para que rolar até a
  // página 3 não re-sorteie o acervo. Sem semente, o shuffle seria uma ordem por request —
  // ou seja, card repetido enquanto o usuário rola.
  const seedRaw = parseInt(searchParams.get("seed") || "");
  const seed = isNaN(seedRaw) ? 1 : seedRaw;
  // Marca ativa enviesa o embaralhamento (não filtra). Só custa quando o shuffle está em uso.
  const brandId = searchParams.get("brandId") || "";
  const biasIds = sort === "shuffle" && brandId && !search ? await brandBiasIds(brandId) : undefined;

  const result = await searchRefs({
    search, studio, tags, tagMode, aspect, sort, seed, biasIds,
    requirePsd: hasPsd,
    page: isNaN(page) ? 1 : page,
    limit: isNaN(limit) ? 60 : limit,
  });

  return NextResponse.json(result);
}
