import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { loadQuads, NEW_MOCKUPS_DIR } from "@/lib/quad-store";

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

/** Lista as cenas de Render/New Mockups, mescla com o golden e ordena por triagem. */
export async function GET() {
  if (!existsSync(NEW_MOCKUPS_DIR)) {
    return NextResponse.json({ error: `Pasta não encontrada: ${NEW_MOCKUPS_DIR}` }, { status: 404 });
  }

  const files = (await readdir(NEW_MOCKUPS_DIR))
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort();
  const golden = await loadQuads();

  const scenes: CalibrateScene[] = [];
  for (const name of files) {
    const full = join(NEW_MOCKUPS_DIR, name);
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
      url: `/api/local-image?path=${encodeURIComponent(full)}`,
      status,
      confidence: entry?.confidence,
      iou: entry?.iou,
      surfaceType: entry?.surfaceType,
      triage,
    });
  }

  scenes.sort((a, b) => a.triage - b.triage);
  return NextResponse.json({ scenes });
}
