import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { detectKeyColorQuad } from "@/lib/photo-detect";
import { NEW_MOCKUPS_DIR, getQuad } from "@/lib/quad-store";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

/** Roda o detector unificado de key color numa cena e devolve o quad + metadados. */
export async function POST(req: NextRequest) {
  const { name } = await req.json();
  const safe = safeName(name);
  if (!safe) return NextResponse.json({ error: "nome inválido" }, { status: 400 });

  const full = join(NEW_MOCKUPS_DIR, safe);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });

  const m = await sharp(full).metadata();
  const width = m.width ?? 0, height = m.height ?? 0;
  if (!width || !height) return NextResponse.json({ error: "dimensões inválidas" }, { status: 500 });

  const [result, saved] = await Promise.all([
    detectKeyColorQuad(full, width, height),
    getQuad(safe),
  ]);
  if (!result) {
    return NextResponse.json({ error: "nenhum key color detectado", width, height, saved }, { status: 200 });
  }

  return NextResponse.json({ ...result, width, height, saved });
}
