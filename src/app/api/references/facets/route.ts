/**
 * GET /api/references/facets — contagens de estúdio / tag / aspecto em uma passada.
 *
 * Substitui as agregações separadas de `/studios` e `/tags`, que rodavam no Mongo e por
 * isso discordavam do que o grid realmente mostra (cenas do filesystem fora da conta,
 * `studio` do settings.json ignorado).
 */
import { NextRequest, NextResponse } from "next/server";
import { getFacets } from "@/lib/search-index";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hasPsd = searchParams.get("has_psd") === "true";
  const facets = await getFacets({ search: searchParams.get("search") || "", requirePsd: hasPsd });
  return NextResponse.json(facets);
}
