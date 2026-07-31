/**
 * POST /api/references/click — "este resultado foi o que eu queria".
 *
 * Fecha o loop de aprendizado da busca: o que a galera abre/renderiza a partir de uma
 * query vira `boostDocument` no ranking da próxima vez. Mesmo princípio do
 * `engine-feedback`, que já usa cada publish como ground-truth pro detector de quad.
 *
 * Best-effort por design: responde 204 mesmo se falhar. Um sinal perdido não é erro que
 * mereça aparecer pro usuário — e telemetria jamais pode quebrar a navegação.
 */
import { NextRequest, NextResponse } from "next/server";
import { logClick } from "@/lib/search-telemetry";

export async function POST(req: NextRequest) {
  try {
    const { query, id } = await req.json();
    // A query é OPCIONAL. Exigi-la aqui (como a versão anterior fazia, espelhando
    // a mesma trava no cliente) descartava todo sinal vindo da navegação do grid —
    // e a listagem sem busca é onde 100% das sessões começam. Sem termo, `logClick`
    // incrementa só a popularidade global, que é exatamente o sinal que a ordenação
    // "Mais usados" consome.
    if (typeof id === "string" && id) {
      await logClick(typeof query === "string" ? query.trim() : "", id);
    }
  } catch { /* sinal perdido não vira erro pro usuário */ }
  return new NextResponse(null, { status: 204 });
}
