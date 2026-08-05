import { NextRequest, NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { loadQuads, loadIgnored, resolveDir } from "@/lib/quad-store";

export interface CalibrateScene {
  name: string;
  width: number;
  height: number;
  url: string;
  status: "manual" | "auto" | "unsaved";
  confidence?: number;
  iou?: number;
  surfaceType?: string;
  triage: number; // menor = precisa mais de atenção (ordena a fila)
}

/** Lista as cenas da pasta (default Render/New Mockups), mescla com o golden e ordena por triagem. */
export async function GET(req: NextRequest) {
  const dir = resolveDir(req.nextUrl.searchParams.get("dir"));
  if (!existsSync(dir)) {
    return NextResponse.json({ error: `Pasta não encontrada: ${dir}`, dir }, { status: 404 });
  }

  const files = (await readdir(dir))
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();
  const golden = await loadQuads(dir);
  const ignored = new Set(await loadIgnored(dir));

  const scenes: CalibrateScene[] = [];
  for (const name of files) {
    if (ignored.has(name)) continue;
    const full = join(dir, name);
    let width = 0, height = 0;
    try {
      const m = await sharp(full).metadata();
      width = m.width ?? 0; height = m.height ?? 0;
    } catch { continue; }

    const entry = golden[name];
    const status: CalibrateScene["status"] = !entry ? "unsaved" : entry.source;
    // Triagem: não-salvo primeiro (0), depois confiança baixa, depois manual salvo no fim.
    const triage = status === "unsaved" ? 0
      : status === "auto" ? 1 + (entry.confidence ?? 0)
      : 10 + (entry.iou ?? 1);

    scenes.push({
      name, width, height,
      // `raw=1` é obrigatório: a tela de calibração desenha esta imagem num
      // canvas do tamanho de `naturalWidth`/`naturalHeight` e lê os pixels para
      // detectar o quad, comparando com o `width`/`height` que o sharp mediu no
      // arquivo ORIGINAL logo acima. Um derivado reduzido passaria despercebido
      // e deslocaria todo quad calibrado a partir daqui.
      url: `/api/local-image?path=${encodeURIComponent(full)}&raw=1`,
      status,
      confidence: entry?.confidence,
      iou: entry?.iou,
      surfaceType: entry?.surfaceType,
      triage,
    });
  }

  scenes.sort((a, b) => a.triage - b.triage);
  return NextResponse.json({ scenes, ignored: [...ignored].sort(), dir });
}
