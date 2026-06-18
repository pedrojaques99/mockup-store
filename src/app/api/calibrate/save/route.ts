import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { quadIoU, type QuadCorners } from "@/lib/key-color-core";
import { upsertQuad, NEW_MOCKUPS_DIR, type QuadEntry } from "@/lib/quad-store";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

function validQuad(q: any): q is QuadCorners {
  return q && ["tl", "tr", "br", "bl"].every(
    (k) => q[k] && typeof q[k].x === "number" && typeof q[k].y === "number",
  );
}

/** Salva o quad corrigido no golden, gravando auto+manual+IoU para a camada de inteligência. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const safe = safeName(body.name);
  if (!safe) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  if (!validQuad(body.quad)) return NextResponse.json({ error: "quad inválido" }, { status: 400 });

  const full = join(NEW_MOCKUPS_DIR, safe);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });

  const m = await sharp(full).metadata();
  const auto: QuadCorners | undefined = validQuad(body.auto) ? body.auto : undefined;

  const entry: QuadEntry = {
    quad: body.quad,
    auto,
    method: typeof body.method === "string" ? body.method : "key-color",
    surfaceType: typeof body.surfaceType === "string" ? body.surfaceType : "billboard",
    hue: typeof body.hue === "number" ? body.hue : undefined,
    source: "manual",
    confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    iou: auto ? quadIoU(auto, body.quad) : undefined,
    detectorVersion: typeof body.detectorVersion === "number" ? body.detectorVersion : undefined,
    imageWidth: m.width ?? 0,
    imageHeight: m.height ?? 0,
    savedAt: Date.now(),
  };

  const saved = await upsertQuad(safe, entry);
  return NextResponse.json({ saved });
}
