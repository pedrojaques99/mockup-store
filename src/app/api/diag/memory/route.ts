/**
 * GET /api/diag/memory — o que está ocupando a memória DESTE processo.
 *
 * (Não use `_diag`: pasta iniciada por `_` é privada no App Router e não vira
 * rota — a versão anterior deste arquivo devolvia 404 em silêncio.)
 *
 * Existe porque "o app está pesado" não é diagnosticável de fora: a RSS que o
 * Gerenciador de Tarefas mostra é a marca d'água do processo (o V8 devolve pouco
 * ao SO), então ela não distingue "vazamento" de "heap que já foi coletado mas o
 * processo manteve". Aqui saem os dois números lado a lado, mais o tamanho dos
 * caches que este app mantém vivos de propósito.
 *
 * `?gc=1` força uma coleção antes de medir — só funciona com
 * `node --expose-gc`; sem isso o campo volta como `false` em vez de mentir.
 *
 * Fechado em produção: expor forma de memória de um processo é dado de
 * infraestrutura, e a rota não tem por que existir no build que vai pro cliente.
 */
import { NextRequest, NextResponse } from "next/server";
import { catalogStats } from "@/lib/search-index";

const MB = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const gcPedido = req.nextUrl.searchParams.get("gc") === "1";
  const gc = globalThis.gc;
  const coletou = gcPedido && typeof gc === "function";
  if (coletou) gc();

  const m = process.memoryUsage();
  return NextResponse.json({
    coletou,
    processo: {
      // O que o SO vê (a marca d'água — é este o número do painel).
      rssMB: MB(m.rss),
      // O que o JS realmente está usando agora.
      heapUsadoMB: MB(m.heapUsed),
      // O que o V8 reservou para o heap (heapUsado ≤ heapTotal ≤ rss).
      heapTotalMB: MB(m.heapTotal),
      // Buffers e ArrayBuffers — imagem decodificada mora aqui, não no heap.
      externalMB: MB(m.external),
      arrayBuffersMB: MB(m.arrayBuffers),
      uptimeMin: Math.round(process.uptime() / 6) / 10,
    },
    catalogo: catalogStats(),
  });
}
