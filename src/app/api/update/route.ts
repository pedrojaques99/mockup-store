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
import { estadoUpdate, aplicarUpdate, requisicaoLocal } from "@/lib/update";

export const runtime = "nodejs";
// Estado de git não pode ser cacheado: a resposta muda a cada push no remoto.
export const dynamic = "force-dynamic";

/**
 * ⚠️ NUNCA transforme isto num `NextResponse` de módulo. O corpo de uma
 * `Response` é um stream que se lê UMA vez: reaproveitar o mesmo objeto entre
 * requisições faz a segunda recusa em diante sair com **corpo vazio**, e o
 * cliente recebe um 403 mudo. Foi assim aqui, e o corpo vazio foi justamente o
 * que atrasou o diagnóstico — parecia 403 de outra camada, não da rota.
 */
const recusa = () =>
  NextResponse.json(
    { erro: "A atualização só funciona com o app aberto na própria máquina." },
    { status: 403 }
  );

export async function GET(req: NextRequest) {
  if (!requisicaoLocal(req.headers)) return recusa();
  return NextResponse.json(await estadoUpdate());
}

export async function POST(req: NextRequest) {
  if (!requisicaoLocal(req.headers)) return recusa();
  const r = await aplicarUpdate();
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
