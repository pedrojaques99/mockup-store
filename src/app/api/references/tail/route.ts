/**
 * POST /api/references/tail — a continuação algorítmica do grid.
 *
 * "Fim da Biblioteca" quase nunca era verdade: era o fim do RECORTE. Uma busca por
 * "billboard" acaba em 40 cards, e o acervo tem milhares — a tela dizia "fim" com 98% do
 * catálogo ainda por ver. Esta rota responde a pergunta que o rodapé deveria fazer:
 * *"e depois disto, o que mais?"* — sem query nenhuma, só a partir do que já está na tela.
 *
 * Três camadas, da mais inteligente para a mais burra, e todas devolvem card de verdade:
 *
 * 1. **Semântica** (`centroidRank`): centróide do que o usuário acabou de rolar → vizinhos.
 *    É o único caminho que aprende o assunto sem ninguém escrever nada.
 * 2. **Léxica**: as tags e tipos das sementes viram query. Sem BYOK de embedding, é isto
 *    que mantém o rio correndo — pior recomendação, mesma continuidade.
 * 3. **Acervo por popularidade**: o que sobrou, na ordem da listagem padrão. Existe para o
 *    caso em que semente e tags não levam a lugar nenhum (mockup sem tag, catálogo pequeno).
 *
 * `references: []` só acontece quando o usuário viu MESMO tudo — e aí o "Fim" é honesto.
 * O cliente manda `exclude` com tudo o que já pintou, então nada se repete no scroll.
 */
import { NextRequest, NextResponse } from "next/server";
import { centroidRank } from "@/lib/semantic-index";
import { refsByIds, searchRefs, type SearchDoc } from "@/lib/search-index";

interface TailBody {
  /** Últimos ids vistos — o "assunto" do momento. */
  seeds?: unknown;
  /** Tudo que já foi renderizado no grid (inclui as sementes). */
  exclude?: unknown;
  limit?: unknown;
}

const asIds = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];

export async function POST(req: NextRequest) {
  let body: TailBody;
  try {
    body = (await req.json()) as TailBody;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const limitRaw = typeof body.limit === "number" ? body.limit : 30;
  const limit = Math.min(Math.max(1, Math.round(limitRaw) || 30), 60);
  // Só as últimas sementes: o centróide de 400 cards é o centróide do acervo inteiro
  // (ou seja, nada). O assunto é o que está debaixo do olho agora.
  const seeds = asIds(body.seeds).slice(-24);
  const exclude = new Set([...asIds(body.exclude), ...seeds]);

  try {
    if (seeds.length) {
      const dense = (await centroidRank(seeds, { k: limit, exclude })) ?? [];
      if (dense.length) {
        const references = await refsByIds(dense);
        if (references.length) {
          return NextResponse.json({ references, total: references.length, mode: "semantic" });
        }
      }

      const seedDocs = await refsByIds(seeds);
      const terms = [...new Set(seedDocs.flatMap((d) => [...d.tags, ...d.mockupType]))]
        .slice(0, 8)
        .join(" ");
      if (terms.trim()) {
        const r = await searchRefs({ search: terms, limit: limit + exclude.size });
        const references = (r.references as SearchDoc[])
          .filter((d) => !exclude.has(d.id))
          .slice(0, limit);
        if (references.length) {
          return NextResponse.json({ references, total: references.length, mode: "lexical" });
        }
      }
    }

    const r = await searchRefs({ limit: limit + exclude.size });
    const references = (r.references as SearchDoc[])
      .filter((d) => !exclude.has(d.id))
      .slice(0, limit);
    return NextResponse.json({ references, total: references.length, mode: "catalog" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "erro inesperado" },
      { status: 500 },
    );
  }
}
