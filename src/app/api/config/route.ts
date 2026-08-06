/**
 * `/api/config` — o que o painel de configurações lê e grava.
 *
 * Duas regras duras aqui:
 *
 * 1. **A chave em claro nunca sai.** O GET devolve presença, máscara e origem.
 *    Um painel que reexibe a chave para "conferir" a coloca no HTML, no cache
 *    do browser e em qualquer extensão instalada — e o ganho é zero, porque
 *    quem quer conferir troca.
 * 2. **A origem viaja junto.** Com `process.env` vencendo a config, uma chave
 *    travada no `.env.local` faria o painel aceitar a edição e não mudar nada.
 *    Devolvendo `origem`, a UI desabilita o campo e explica. Sem isso, o modo
 *    de falha é o silencioso.
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import {
  PROVEDORES,
  lerConfig,
  gravarConfig,
  valorChave,
  mascarar,
  pastasAcervo,
  pastasOverlay,
  portaRender,
  aplicarConfigNoProcesso,
  caminhoConfig,
  type ChaveProvedor,
} from "@/lib/app-config";
import { invalidateCatalog } from "@/lib/search-index";
import { driverAtivo } from "@/lib/db";

export const runtime = "nodejs";

const CHAVES_VALIDAS = new Set<string>(PROVEDORES.map((p) => p.chave));

export async function GET() {
  try {
    aplicarConfigNoProcesso();
    const acervo = pastasAcervo();
    const overlay = pastasOverlay();
    const render = portaRender();

    return NextResponse.json({
      arquivo: caminhoConfig(),
      catalogo: driverAtivo(),
      acervo: {
        origem: acervo.origem,
        pastas: acervo.valor.map((p) => ({ caminho: p, existe: existsSync(p) })),
      },
      overlay: { origem: overlay.origem, pastas: overlay.valor },
      render: { porta: render.valor, origem: render.origem },
      provedores: PROVEDORES.map((p) => {
        const { valor, origem } = valorChave(p.chave);
        return {
          chave: p.chave,
          nome: p.nome,
          liga: p.liga,
          // Presença e máscara. O valor em claro fica no servidor.
          definida: !!valor,
          mascara: valor ? mascarar(valor) : null,
          origem,
        };
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Não consegui ler a configuração: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      psdDirs?: string[];
      overlayDirs?: string[];
      renderPort?: number;
      chaves?: Record<string, string>;
    };

    const chaves: Partial<Record<ChaveProvedor, string>> = {};
    for (const [k, v] of Object.entries(body.chaves ?? {})) {
      if (!CHAVES_VALIDAS.has(k)) {
        return NextResponse.json(
          { error: `Chave desconhecida: ${k}. Aceito: ${[...CHAVES_VALIDAS].join(", ")}` },
          { status: 400 },
        );
      }
      if (typeof v !== "string") continue;
      chaves[k as ChaveProvedor] = v;
    }

    const parcial: Parameters<typeof gravarConfig>[0] = {};
    if (Array.isArray(body.psdDirs)) {
      parcial.psdDirs = body.psdDirs.map((s) => String(s).trim()).filter(Boolean);
    }
    if (Array.isArray(body.overlayDirs)) {
      parcial.overlayDirs = body.overlayDirs.map((s) => String(s).trim()).filter(Boolean);
    }
    if (typeof body.renderPort === "number" && Number.isFinite(body.renderPort)) {
      parcial.renderPort = Math.floor(body.renderPort);
    }
    if (Object.keys(chaves).length) parcial.chaves = chaves;

    gravarConfig(parcial);
    aplicarConfigNoProcesso();
    // Mudou pasta do acervo ⇒ o catálogo em cache está descrevendo outro disco.
    if (parcial.psdDirs) invalidateCatalog();

    const cfg = lerConfig();
    return NextResponse.json({
      ok: true,
      // Devolve o que ficou gravado, sem as chaves — o cliente relê pelo GET.
      psdDirs: cfg.psdDirs ?? [],
      overlayDirs: cfg.overlayDirs ?? [],
      renderPort: cfg.renderPort ?? null,
      catalogoInvalidado: !!parcial.psdDirs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Não consegui gravar a configuração: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
