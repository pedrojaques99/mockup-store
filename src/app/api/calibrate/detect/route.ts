import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { detectKeyColorQuad, autoDetectSurface } from "@/lib/photo-detect";
import { resolveDir, getQuad } from "@/lib/quad-store";
import { loadProfile, applyBias } from "@/lib/engine-feedback";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

/**
 * Roda o detector escolhido numa cena e devolve o quad + metadados.
 * method:
 *   "key-color" (default) — placeholder magenta/neon (detectKeyColorQuad)
 *   "white"               — superfície branca/clara sem magenta (autoDetectSurface)
 *   "manual"              — sem detecção; UI cai no quad centralizado pra arrastar
 */
export async function POST(req: NextRequest) {
  const { name, dir: dirParam, method = "key-color" } = await req.json();
  const safe = safeName(name);
  if (!safe) return NextResponse.json({ error: "nome inválido" }, { status: 400 });

  const dir = resolveDir(dirParam);
  const full = join(dir, safe);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });

  const m = await sharp(full).metadata();
  const width = m.width ?? 0, height = m.height ?? 0;
  if (!width || !height) return NextResponse.json({ error: "dimensões inválidas" }, { status: 500 });

  const saved = await getQuad(safe, dir);

  if (method === "manual") {
    return NextResponse.json({ quad: null, hue: -1, confidence: 0, method: "manual", width, height, saved });
  }

  if (method === "white") {
    const r = await autoDetectSurface(full, width, height);
    if (!r) return NextResponse.json({ error: "nenhuma superfície branca detectada", method: "white", width, height, saved }, { status: 200 });
    return NextResponse.json({ quad: r.quad, hue: -1, confidence: r.confidence, method: "white", surfaceType: r.surfaceType, width, height, saved });
  }

  // key-color (default)
  const result = await detectKeyColorQuad(full, width, height);
  if (!result) {
    return NextResponse.json({ error: "nenhum key color detectado", method: "key-color", width, height, saved }, { status: 200 });
  }
  // Bias aprendido: corrige o viés sistemático do detector (engine retro-alimentado).
  const profile = await loadProfile();
  const st = saved?.surfaceType ?? "billboard";
  const quad = applyBias(result.quad, st, profile);
  return NextResponse.json({ ...result, quad, width, height, saved, profileVersion: profile.version });
}
