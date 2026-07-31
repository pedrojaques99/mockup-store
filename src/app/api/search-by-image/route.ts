import { NextResponse } from "next/server";
import { searchByImage } from "@/lib/visant";

/**
 * Busca visual — delega o embedding pra Visant e devolve ids ranqueados.
 *
 * Devolve id + score, não registros inteiros, de propósito: o grid já renderiza
 * a partir do índice local (`search-index.ts`), e o `id` é a mesma chave nos
 * dois lados porque ambos leem a coleção `community_presets`. Assim a ordem vem
 * do vetor e a renderização continua sendo a de sempre — sem um segundo formato
 * de card pra manter.
 *
 * Cena PSD entra no resultado. O que fica de fora é o que ainda não tem vetor,
 * isto é, o que não passou pelo enriquecimento.
 */
export const runtime = "nodejs";
/** Imagem inteira no corpo — o padrão de 4.5MB do Next não serve. */
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { imageBase64?: string; limit?: number };
    const imageBase64 = body?.imageBase64;

    if (typeof imageBase64 !== "string" || imageBase64.length < 32) {
      return NextResponse.json({ error: "imageBase64 é obrigatório" }, { status: 400 });
    }

    const limit = Math.min(96, Math.max(1, Number(body?.limit) || 48));
    const matches = await searchByImage(imageBase64, { limit });

    return NextResponse.json({ matches, total: matches.length });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    // Não conectado é 401, não 502 — o cliente precisa distinguir "faça login"
    // de "o serviço caiu", senão mostra "tente de novo" pra quem só precisa logar.
    const status = /Não conectado/i.test(message) ? 401 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
