/**
 * GET /api/fs/stat?path= — a pasta existe? tem o quê dentro?
 *
 * Alimenta a validação ao vivo do campo de caminho. Antes o usuário só
 * descobria que errou o caminho depois de mandar varrer e tomar um 404.
 *
 * Também conta os arquivos que o Drive mantém só na nuvem, porque a varredura
 * lê os primeiros bytes de cada um e isso DISPARA o download: numa pasta de
 * milhares de PSDs é a diferença entre minutos e horas. Avisar antes é o
 * mínimo.
 */
import { NextRequest, NextResponse } from "next/server";
import { statCaminho } from "@/lib/fs-browse";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!path.trim()) {
    return NextResponse.json({ existe: false, ehPasta: false, entradas: 0, naNuvem: 0 });
  }
  return NextResponse.json(statCaminho(path));
}
