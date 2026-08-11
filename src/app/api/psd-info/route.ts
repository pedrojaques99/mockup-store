import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { getDb } from "@/lib/db";
import { computeFaces } from "@visant/psd-engine";
import { scanPsd, type ColorSlot } from "@/lib/psd-scan";

/**
 * Cor sólida de um PSD indexado ANTES do campo existir.
 *
 * O índice do Mongo tem 3.520 PSDs; reindexar tudo para ganhar um campo é abrir
 * cada arquivo de novo — o trabalho caro que o seed existe para evitar. Então
 * quem já tem `colorSlots` responde na hora, e só o registro velho paga uma
 * leitura, uma vez por processo.
 *
 * O cache é por `filePath`: o mesmo PSD abre várias vezes no drawer (cada vez
 * que o usuário volta pro card), e sem isso cada volta relia o arquivo inteiro
 * do Drive.
 */
const cacheCores = new Map<string, ColorSlot[]>();

function coresDoDisco(filePath?: string): ColorSlot[] {
  if (!filePath || !existsSync(filePath)) return [];
  const emCache = cacheCores.get(filePath);
  if (emCache) return emCache;
  const meta = scanPsd(filePath);
  const slots = meta?.colorSlots ?? [];
  cacheCores.set(filePath, slots);
  return slots;
}

export async function GET(req: NextRequest) {
  const fileName = req.nextUrl.searchParams.get("name");
  if (!fileName) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const db = await getDb();
  const meta = await db.collection("psd_metadata").findOne({ fileName });

  if (!meta) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    fileName: meta.fileName,
    width: meta.width,
    height: meta.height,
    sizeBytes: meta.sizeBytes,
    smartObjects: meta.smartObjects,
    adjustments: meta.adjustments,
    faces: computeFaces(meta.smartObjects || []),
    colorSlots: meta.colorSlots ?? coresDoDisco(meta.filePath),
  });
}
