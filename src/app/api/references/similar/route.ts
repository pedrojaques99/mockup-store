/**
 * GET /api/references/similar?id=&limit= — "ver similares" a partir de um card.
 *
 * Duas rotas de similaridade já existiam e nenhuma serve aqui: `/api/search-by-image`
 * precisa de um ARQUIVO (é para quando o usuário traz uma imagem de fora), e
 * `/api/suggest` fala de marca, não de mockup. Esta responde a pergunta que se faz olhando
 * um card: "mais parecidos com ESTE".
 *
 * Preferência pelo vetor; queda para o léxico. Com embeddings ligados, "parecido" é
 * proximidade no espaço semântico. Sem eles, vira uma busca pelas próprias tags e tipo do
 * mockup — pior, mas honesta e sempre disponível: um botão que às vezes não faz nada é
 * pior que um botão que às vezes acerta menos.
 */
import { NextRequest, NextResponse } from "next/server";
import { centroidRank } from "@/lib/semantic-index";
import { refsByIds, searchRefs, type SearchDoc } from "@/lib/search-index";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const limitRaw = parseInt(searchParams.get("limit") || "60");
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 60 : limitRaw), 120);

  try {
    const [seed] = await refsByIds([id]);
    if (!seed) return NextResponse.json({ error: "mockup não está no catálogo" }, { status: 404 });

    const exclude = new Set([id]);
    const dense = (await centroidRank([id], { k: limit, exclude })) ?? [];
    if (dense.length) {
      const references = await refsByIds(dense);
      return NextResponse.json({ seed, references, total: references.length, mode: "semantic" });
    }

    // Fallback léxico: as tags e o tipo do próprio mockup viram a query. Nome não entra —
    // nome de arquivo do acervo (`MM_Apparel_AP-EAP-16`) casaria só com irmãos do bundle,
    // que é a resposta menos útil possível para "mostre outros parecidos".
    const terms = [...new Set([...seed.tags, ...seed.mockupType])].slice(0, 8).join(" ");
    if (!terms.trim()) {
      return NextResponse.json({ seed, references: [], total: 0, mode: "none" });
    }
    const r = await searchRefs({ search: terms, limit: limit + 1 });
    const references = (r.references as SearchDoc[]).filter((d) => d.id !== id).slice(0, limit);
    return NextResponse.json({ seed, references, total: references.length, mode: "lexical" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro inesperado" },
      { status: 500 },
    );
  }
}
