/**
 * GET /api/fs/browse?path= — navegador de pastas do próprio app.
 *
 * Sem `path`, lista as unidades. É o caminho portátil: funciona em qualquer
 * browser e em qualquer sistema, não abre janela nenhuma do SO, e é testável.
 * O seletor nativo do Windows (`pick-folder`) é a conveniência por cima disto,
 * não a única porta.
 */
import { NextRequest, NextResponse } from "next/server";
import { listarPastas, listarUnidades, pastaPai, statCaminho } from "@/lib/fs-browse";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const path = (req.nextUrl.searchParams.get("path") ?? "").trim();

  if (!path) {
    return NextResponse.json({ atual: null, pai: null, pastas: listarUnidades() });
  }

  const info = statCaminho(path);
  if (!info.existe || !info.ehPasta) {
    return NextResponse.json({ error: "Pasta não encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    atual: path,
    pai: pastaPai(path),
    pastas: listarPastas(path),
  });
}
