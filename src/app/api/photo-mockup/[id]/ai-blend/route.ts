/**
 * POST /api/photo-mockup/[id]/ai-blend
 *
 * Refines a geometric composite using FLUX Dev img2img (Replicate).
 * Must be called after /render — it takes the geometric composite as input.
 *
 * Body: {
 *   compositeBase64: string  // the render result (data URI or raw base64)
 *   strength: number         // prompt_strength 0.1–0.7
 *   textureOpacity: number   // shadow texture overlay 0–1
 *   prompt?: string          // override auto-prompt
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { aiBlendSurface, type AIBlendQuality } from "@/lib/ai-blend";

const TMP_DIR  = join(process.cwd(), ".tmp",  "photo-scenes");
const DATA_DIR = join(process.cwd(), "data", "photo-scenes");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || !/^[a-f0-9]{16}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  if (!process.env.REPLICATE_API_TOKEN) {
    return NextResponse.json({ error: "REPLICATE_API_TOKEN not set" }, { status: 503 });
  }

  const dataScene = join(DATA_DIR, id);
  const dir = existsSync(dataScene) ? dataScene : join(TMP_DIR, id);
  const analysisPath = join(dir, "analysis.json");
  const shadowPath = join(dir, "shadow.png");
  const maskPath = join(dir, "mask.png");

  for (const p of [analysisPath, shadowPath, maskPath]) {
    if (!existsSync(p)) {
      return NextResponse.json(
        { error: `Missing: ${p.split(/[/\\]/).pop()}. Run process first.` },
        { status: 400 },
      );
    }
  }

  const body = await req.json();
  const { compositeBase64, strength, textureOpacity, prompt, quality } = body;

  if (!compositeBase64 || typeof compositeBase64 !== "string") {
    return NextResponse.json({ error: "compositeBase64 required" }, { status: 400 });
  }
  if (typeof strength !== "number" || strength < 0.05 || strength > 0.9) {
    return NextResponse.json({ error: "strength must be 0.05–0.9" }, { status: 400 });
  }

  const analysis = JSON.parse(await readFile(analysisPath, "utf-8"));
  const [shadowBuf, maskBuf] = await Promise.all([
    readFile(shadowPath),
    readFile(maskPath),
  ]);

  const artData = compositeBase64.startsWith("data:")
    ? compositeBase64
    : `data:image/png;base64,${compositeBase64}`;
  const compositeBuf = Buffer.from(artData.replace(/^data:image\/\w+;base64,/, ""), "base64");

  const { quad, imageWidth: W, imageHeight: H, surfaceType } = analysis;

  try {
    const resultBuf = await aiBlendSurface({
      compositeBuf,
      maskBuf,
      shadowBuf,
      quad,
      W,
      H,
      surfaceType,
      prompt: typeof prompt === "string" ? prompt : undefined,
      strength: Math.max(0.05, Math.min(0.9, strength)),
      textureOpacity: typeof textureOpacity === "number" ? Math.max(0, Math.min(1, textureOpacity)) : 0,
      quality: (["fast", "balanced", "quality"].includes(quality) ? quality : "balanced") as AIBlendQuality,
    });

    return new NextResponse(resultBuf as unknown as BodyInit, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    console.error("[ai-blend]", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
