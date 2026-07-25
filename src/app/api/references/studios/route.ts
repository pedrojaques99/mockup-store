/**
 * GET /api/references/studios — lista de estúdios do dropdown.
 *
 * Sai do MESMO catálogo do grid (`search-index`), senão o dropdown promete um estúdio que
 * o grid não entrega: a agregação antiga rodava só no Mongo, onde cena publicada carrega
 * um `studio: "Photo Scene"` velho e as cenas do filesystem nem existem.
 */
import { NextResponse } from "next/server";
import { getFacets } from "@/lib/search-index";

export async function GET() {
  const { studios } = await getFacets({ requirePsd: true });
  return NextResponse.json(studios);
}
