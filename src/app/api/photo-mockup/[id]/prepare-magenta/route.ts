/**
 * POST /api/photo-mockup/[id]/prepare-magenta
 * Paints the quad area with pure neon magenta (#FF00FF) on the photo.
 * Saves result as photo-prepared.png — process/route.ts uses this for cleanMagentaMarker.
 *
 * Accepts { quad, imageWidth, imageHeight } in body (no analysis.json required).
 * Falls back to analysis.json if body params not provided.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { extractMask } from "@/lib/photo-shadow";
import type { QuadPoints } from "@/lib/photo-analyze";

const TMP_DIR  = join(process.cwd(), ".tmp",  "photo-scenes");
const DATA_DIR = join(process.cwd(), "data", "photo-scenes");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || !/^[a-f0-9]{16}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const dataScene = join(DATA_DIR, id);
  const dir = existsSync(dataScene) ? dataScene : join(TMP_DIR, id);
  const metaPath     = join(dir, "meta.json");
  const analysisPath = join(dir, "analysis.json");

  if (!existsSync(metaPath)) {
    return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  }

  // Resolve quad + dimensions from body or analysis.json
  const body = await req.json().catch(() => ({})) as {
    quad?: QuadPoints;
    imageWidth?: number;
    imageHeight?: number;
  };

  let quad: QuadPoints;
  let w: number;
  let h: number;

  if (body.quad && body.imageWidth && body.imageHeight) {
    quad = body.quad;
    w    = body.imageWidth;
    h    = body.imageHeight;
  } else if (existsSync(analysisPath)) {
    const analysis = JSON.parse(await readFile(analysisPath, "utf-8"));
    quad = analysis.quad;
    w    = analysis.imageWidth;
    h    = analysis.imageHeight;
  } else {
    return NextResponse.json({ error: "No quad provided and no analysis.json found" }, { status: 400 });
  }

  const { ext } = JSON.parse(await readFile(metaPath, "utf-8"));
  const photoPath = join(dir, `photo.${ext}`);
  if (!existsSync(photoPath)) {
    return NextResponse.json({ error: "photo file not found" }, { status: 404 });
  }

  // Build bounding-box mask → expand to full image at quad offset
  const maskBuf = await extractMask(w, h, quad);

  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));

  const fullMask = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: maskBuf, left: minX, top: minY }])
    .png()
    .toBuffer();

  // Pure neon magenta (#FF00FF = H300°) clipped to quad
  const magentaClipped = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 255 } },
  })
    .composite([{ input: fullMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  // Composite over original photo → save as photo-prepared.png
  const photoBuf = await readFile(photoPath);
  const prepared = await sharp(photoBuf)
    .composite([{ input: magentaClipped, blend: "over" }])
    .png()
    .toBuffer();

  await writeFile(join(dir, "photo-prepared.png"), prepared);

  return NextResponse.json({ ready: true, width: w, height: h });
}
