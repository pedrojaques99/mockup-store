/**
 * POST /api/calibrate/classify  { name, dir? }
 *
 * Auto-detecta o tipo de input (magenta / white-label / custom) de uma cena e
 * retorna um preset calibrado (detector + surface + material + relevo) — base
 * do "Smart Presets" do /calibrate.
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { resolveDir } from "@/lib/quad-store";
import { analyzeScene } from "@/lib/scene-classify";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = safeName(body.name);
  if (!name) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  const dir = resolveDir(body.dir);
  const full = join(dir, name);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });
  try {
    const tenant = (req.headers.get("x-tenant") || (typeof body.tenant === "string" ? body.tenant : "")).trim() || undefined;
    const an = await analyzeScene(full, { ai: !!body.ai, tenant });
    return NextResponse.json(an);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "classify failed" }, { status: 500 });
  }
}
