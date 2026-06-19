import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { extractDisplacementMap } from "@/lib/photo-shadow";
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

/**
 * Mapa de profundidade (displacement) da superfície dentro do quad, p/ preview.
 * Cinza claro = relevo/luz, escuro = recuo/sombra; PRETO fora do quad (neutro em
 * blend screen). A UI sobrepõe com mix-blend screen + opacidade → "malha" de relevo
 * visível. `blur` controla a suavização (preBlur de extractDisplacementMap).
 */
export async function POST(req: NextRequest) {
  const { name, dir: dirParam, quad, blur = 8 } = await req.json();
  const safe = safeName(name);
  if (!safe) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  if (!validQuad(quad)) return NextResponse.json({ error: "quad inválido" }, { status: 400 });

  const dir = resolveDir(dirParam);
  const full = join(dir, safe);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });

  const m = await sharp(full).metadata();
  const png = await extractDisplacementMap(full, m.width ?? 0, m.height ?? 0, quad, Math.max(0, Number(blur) || 0));

  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
