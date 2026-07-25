/**
 * GET /api/references/stats — saúde da busca.
 *
 * Existe por um motivo específico: o bug do `"t-shirt"` (uma query trazia 1444 de 1620
 * itens) só foi descoberto porque alguém foi medir na mão. `zeroResult` e `byPass` são os
 * sinais que teriam apontado isso sozinhos — query sem resultado é buraco de vocabulário,
 * e query que só resolve no passe 3 (fuzzy + OR) é sintoma de dicionário incompleto.
 *
 * Consumo humano: `npx tsx scripts/search-report.ts`.
 */
import { NextResponse } from "next/server";
import { getSearchStats } from "@/lib/search-telemetry";

export async function GET() {
  return NextResponse.json(await getSearchStats());
}
