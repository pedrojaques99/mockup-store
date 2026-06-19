/**
 * POST /api/photo-mockup/[id]/variation { prompt, n? }
 *
 * Gera N variantes do RENDER mantendo composição via ControlNet. Pega o
 * `render-cache` mais recente (ou a foto base se não houver). Retorna JSON com
 * data-URLs (cliente decide qual usar).
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { variation } from "@/lib/genai";

const TMP_DIR = join(process.cwd(), ".tmp", "photo-scenes");
const DATA_DIR = join(process.cwd(), "data", "photo-scenes");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t0 = Date.now();
  const { id } = await params;
  if (!/^[a-f0-9]{16}$/.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const dataDir = join(DATA_DIR, id);
  const dir = existsSync(dataDir) ? dataDir : join(TMP_DIR, id);
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) return NextResponse.json({ error: "scene not found" }, { status: 404 });
  const body = await req.json();
  if (!body.prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

  const { ext } = JSON.parse(await readFile(metaPath, "utf-8")) as { ext: string };
  const renderPath = join(dir, "render-latest.png");
  const srcPath = existsSync(renderPath) ? renderPath : join(dir, `photo.${ext}`);
  if (!existsSync(srcPath)) return NextResponse.json({ error: "source missing" }, { status: 404 });

  const out = await variation(await readFile(srcPath), body.prompt, Math.max(1, Math.min(6, body.n ?? 3)));
  if (!out) return NextResponse.json({ error: "variation unavailable (set REPLICATE_API_TOKEN)" }, { status: 503 });
  const urls = out.map((g) => `data:image/png;base64,${g.png.toString("base64")}`);

  return NextResponse.json({ urls, provider: out[0]?.provider ?? null, ms: Date.now() - t0 });
}
