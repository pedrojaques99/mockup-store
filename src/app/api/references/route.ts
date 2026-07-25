/**
 * GET /api/references — grid da home.
 *
 * Adaptador fino sobre `src/lib/search-index.ts` (catálogo unificado Mongo+filesystem,
 * MiniSearch com peso por campo + prefixo + fuzzy + sinônimos PT/EN). Antes daqui viviam
 * dois algoritmos de busca concorrentes e um merge que descartava o score de relevância.
 */
import { NextRequest, NextResponse } from "next/server";
import { searchRefs, type AspectBucket } from "@/lib/search-index";

const ASPECTS = new Set<AspectBucket>(["square", "portrait", "landscape"]);

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
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

  const result = await searchRefs({
    search, studio, tags, tagMode, aspect,
    requirePsd: hasPsd,
    page: isNaN(page) ? 1 : page,
    limit: isNaN(limit) ? 60 : limit,
  });

  return NextResponse.json(result);
}
