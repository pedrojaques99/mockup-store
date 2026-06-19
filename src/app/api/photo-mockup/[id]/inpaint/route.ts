/**
 * POST /api/photo-mockup/[id]/inpaint { maskBase64, prompt }
 *
 * Recebe uma mask (white=onde preencher) + prompt, devolve PNG da cena com a
 * região preenchida. Útil pra remover occluder (mão tampando) ou trocar
 * elementos. Usa Flux Fill via Replicate (`genai.inpaintMask`).
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { inpaintMask } from "@/lib/genai";

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
  if (!body.maskBase64 || !body.prompt) return NextResponse.json({ error: "maskBase64 + prompt required" }, { status: 400 });

  const { ext } = JSON.parse(await readFile(metaPath, "utf-8")) as { ext: string };
  const scenePath = join(dir, `photo.${ext}`);
  if (!existsSync(scenePath)) return NextResponse.json({ error: "photo missing" }, { status: 404 });
  const sceneBuf = await readFile(scenePath);
  const maskBuf = Buffer.from(String(body.maskBase64).replace(/^data:image\/\w+;base64,/, ""), "base64");

  const out = await inpaintMask(sceneBuf, maskBuf, body.prompt);
  if (!out) return NextResponse.json({ error: "inpaint unavailable (set REPLICATE_API_TOKEN)" }, { status: 503 });

  return new NextResponse(new Uint8Array(out.png), {
    headers: {
      "Content-Type": "image/png", "Cache-Control": "no-store",
      "X-Provider": out.provider, "Server-Timing": `inpaint;dur=${Date.now() - t0}`,
    },
  });
}
