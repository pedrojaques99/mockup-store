/**
 * `/api/update` — checar e aplicar atualização pelo app.
 *
 * Uma rota que roda `git merge` e `npm ci` é execução de código. Aqui isso é
 * aceitável porque o app é local: roda na máquina da pessoa, com o acervo dela.
 * Mas "é local" é premissa, não fato, e premissa não checada vira falha. Então
 * a rota **exige que a requisição venha da própria máquina** e recusa qualquer
 * outra origem — se alguém expuser esta porta na rede, o pior que acontece é a
 * rota parar de responder, não a máquina ser tomada.
 *
 * GET  → estado (leitura, não escreve nada)
 * POST → aplica (exige clique na interface)
 */
import { NextRequest, NextResponse } from "next/server";
import { estadoUpdate, aplicarUpdate } from "@/lib/update";

export const runtime = "nodejs";
// Estado de git não pode ser cacheado: a resposta muda a cada push no remoto.
export const dynamic = "force-dynamic";

/**
 * Só a própria máquina. `x-forwarded-for` presente indica proxy à frente, ou
 * seja, alguém publicou isto — e aí nem tentamos adivinhar.
 */
function daPropriaMaquina(req: NextRequest): boolean {
  if (req.headers.get("x-forwarded-for")) return false;
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

const RECUSA = NextResponse.json(
  { erro: "A atualização só funciona com o app aberto na própria máquina." },
  { status: 403 }
);

export async function GET(req: NextRequest) {
  if (!daPropriaMaquina(req)) return RECUSA;
  return NextResponse.json(await estadoUpdate());
}

export async function POST(req: NextRequest) {
  if (!daPropriaMaquina(req)) return RECUSA;
  const r = await aplicarUpdate();
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
