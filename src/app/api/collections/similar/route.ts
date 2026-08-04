/**
 * GET /api/collections/similar?brandId=&limit= — "completar a coleção".
 *
 * Duas fontes, uma lista:
 *  1. os vizinhos semânticos do que JÁ foi curado (centróide dos embeddings da coleção);
 *  2. a sugestão brand-aware que já existia (`/api/suggest`).
 *
 * A ordem importa: o vizinho semântico vem primeiro porque ele responde a uma pergunta
 * mais específica — "mais como ISTO que você escolheu" — enquanto a sugestão de marca
 * responde "o que combina com a marca em geral". Quanto mais o usuário cura, melhor a
 * primeira fica; a segunda é o que sustenta a coleção vazia, onde não há centróide algum.
 *
 * O que já está na coleção nunca aparece: recomendar o que a pessoa já escolheu é o modo
 * mais rápido de um painel de sugestão virar ruído.
 *
 * Sem embeddings configurados a rota não quebra — perde a metade semântica e segue com a
 * sugestão de marca.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCollection } from "@/lib/collection-store";
import { centroidRank } from "@/lib/semantic-index";
import { refsByIds, type SearchDoc } from "@/lib/search-index";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brandId = searchParams.get("brandId");
  if (!brandId) return NextResponse.json({ error: "brandId obrigatório" }, { status: 400 });

  const limitRaw = parseInt(searchParams.get("limit") || "18");
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 18 : limitRaw), 60);

  try {
    const col = await getCollection(brandId);
    const curated = new Set((col?.items ?? []).map((i) => i.id));

    let semantic: string[] = [];
    if (curated.size) {
      semantic = (await centroidRank([...curated], { k: limit, exclude: curated })) ?? [];
    }

    let brandIds: string[] = [];
    try {
      const { suggestForBrand } = await import("@/lib/suggest-core");
      const res = await suggestForBrand(brandId, { limit: limit * 2 });
      brandIds = res.suggestions
        .map((s) => (s.ref as { id?: unknown }).id)
        .filter((id): id is string => typeof id === "string");
    } catch (e) {
      // Visant fora não pode zerar o painel quando a metade semântica funcionou.
      console.error("[collections/similar] sugestão de marca indisponível:", e instanceof Error ? e.message : e);
    }

    const seen = new Set(curated);
    const ordered: string[] = [];
    for (const id of [...semantic, ...brandIds]) {
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
      if (ordered.length >= limit) break;
    }

    const references: SearchDoc[] = await refsByIds(ordered);
    return NextResponse.json({
      brandId,
      references,
      /** De onde veio a lista — a UI diz ao usuário por que está vendo isto. */
      source: semantic.length ? (brandIds.length ? "both" : "semantic") : "brand",
      curated: curated.size,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro inesperado" },
      { status: 500 },
    );
  }
}
