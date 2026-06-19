import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { buildMaterialOverlay, MATERIAL_BLEND, type MaterialKind } from "@/lib/material-fx";
import { resolveDir } from "@/lib/quad-store";
import type { QuadCorners } from "@/lib/key-color-core";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}
function validQuad(q: any): q is QuadCorners {
  return q && ["tl", "tr", "br", "bl"].every((k) => q[k] && typeof q[k].x === "number" && typeof q[k].y === "number");
}

/** Overlay procedural do material recortado ao quad (preview). Blend em X-Blend. */
export async function POST(req: NextRequest) {
  const { name, dir: dirParam, quad, material = "none", intensity, angle, scale } = await req.json();
  const safe = safeName(name);
  if (!safe) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  if (!validQuad(quad)) return NextResponse.json({ error: "quad inválido" }, { status: 400 });

  const dir = resolveDir(dirParam);
  const full = join(dir, safe);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });

  const m = await sharp(full).metadata();
  const kind = material as MaterialKind;
  const png = await buildMaterialOverlay(m.width ?? 0, m.height ?? 0, quad, {
    material: kind,
    intensity: typeof intensity === "number" ? intensity : undefined,
    angle: typeof angle === "number" ? angle : undefined,
    scale: typeof scale === "number" ? scale : undefined,
  });

  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Blend": MATERIAL_BLEND[kind] ?? "normal" },
  });
}
