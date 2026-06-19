/**
 * GET /api/calibrate/load?name=<scene>&dir=<dir>
 *
 * SSoT: ler a calibração (`QuadEntry`) de uma cena do golden `quads.json`. Consumido
 * pelo photo-mockup editor pra **importar mesh + disp + material + máscara** já
 * calibrados, mantendo os dois editores 100% alinhados.
 *
 * Retorna `{ entry, surfaceMaskUrl? }`. `surfaceMaskUrl` é uma URL própria (rota
 * `/api/calibrate/overlay` reaproveitada não serve aqui — usamos a `/scenes/file`
 * ou um data URL inline pra evitar nova rota).
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getQuad, resolveDir } from "@/lib/quad-store";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const name = safeName(searchParams.get("name"));
  if (!name) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  const dir = resolveDir(searchParams.get("dir"));
  const entry = await getQuad(name, dir);
  if (!entry) return NextResponse.json({ entry: null });

  // Inclui a máscara inline (data URL) quando houver — evita criar nova rota e
  // garante atomicidade (entry+mask num único fetch).
  let surfaceMaskDataUrl: string | null = null;
  if (entry.surfaceMaskRel) {
    const rel = entry.surfaceMaskRel;
    if (!rel.includes("..")) {
      const p = join(dir, rel);
      if (existsSync(p)) {
        try {
          const b = await readFile(p);
          surfaceMaskDataUrl = `data:image/png;base64,${b.toString("base64")}`;
        } catch { /* */ }
      }
    }
  }
  return NextResponse.json({ entry, surfaceMaskDataUrl });
}
