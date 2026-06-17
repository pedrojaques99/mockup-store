/**
 * POST /api/photo-mockup/process
 * Extracts shadow map + mask (+ highlight for glossy surfaces) from the photo.
 * - Accepts a custom quad (user-adjusted corners); creates a minimal analysis.json if none exists.
 * - Lighting is always extracted from the RAW photo (not the magenta-prepared one).
 * - photo-clean.png is produced from photo-prepared.png if it exists (neutral surface after magenta removal).
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { extractGrayscaleLayers, extractMask, cleanMagentaMarker, extractOccluder, neutralizeNeonPixels, extractReflectionMask } from "@/lib/photo-shadow";
import type { QuadPoints } from "@/lib/photo-analyze";

const dataUrlToBuffer = (s: string) =>
  Buffer.from(s.replace(/^data:image\/\w+;base64,/, ""), "base64");

const quadBBox = (q: QuadPoints, w: number, h: number) => {
  const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x];
  const ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

const TMP_DIR  = join(process.cwd(), ".tmp",  "photo-scenes");
const DATA_DIR = join(process.cwd(), "data", "photo-scenes");

export async function POST(req: NextRequest) {
  const { id, quad: customQuad, featherPx, multiplyFloor, preBlur, surfaceMaskBase64, occluderMaskBase64, reflectionMaskBase64 } = await req.json();

  if (!id || typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const dataScene = join(DATA_DIR, id);
  const dir = existsSync(dataScene) ? dataScene : join(TMP_DIR, id);
  const metaPath     = join(dir, "meta.json");
  const analysisPath = join(dir, "analysis.json");

  if (!existsSync(metaPath)) {
    return NextResponse.json({ error: "Photo not found. Upload first." }, { status: 404 });
  }

  const { ext, width, height } = JSON.parse(await readFile(metaPath, "utf-8"));

  // Build or update analysis.json
  let analysis: any;
  if (!existsSync(analysisPath)) {
    if (!customQuad) {
      return NextResponse.json({ error: "No analysis found. Run AI detect or provide a quad." }, { status: 400 });
    }
    // Manual quad — create minimal analysis record
    analysis = {
      id,
      quad: customQuad,
      surfaceType: "manual",
      material: "unknown",
      hasOcclusion: false,
      occlusionDesc: "",
      lightingDir: "ambient",
      confidence: 0,
      imageWidth: width,
      imageHeight: height,
    };
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2));
  } else {
    analysis = JSON.parse(await readFile(analysisPath, "utf-8"));
    if (customQuad) {
      analysis.quad = customQuad;
      await writeFile(analysisPath, JSON.stringify(analysis, null, 2));
    }
  }

  const quad: QuadPoints = customQuad ?? analysis.quad;

  const rawPhotoPath = join(dir, `photo.${ext}`);
  // photo-prepared.png has magenta painted on the quad — use for cleanMagentaMarker only
  const preparedPath = join(dir, "photo-prepared.png");
  const cleanSourcePath = existsSync(preparedPath) ? preparedPath : rawPhotoPath;

  // Optional tuning params (all have safe lib defaults when omitted)
  const floor   = typeof multiplyFloor === "number" ? Math.max(0, Math.min(255, multiplyFloor)) : 0;
  const blurSig = typeof preBlur === "number" ? Math.max(0, Math.min(50, preBlur)) : 0;
  const feather = typeof featherPx === "number" ? Math.max(0, Math.min(40, featherPx)) : 3;

  const W = analysis.imageWidth, H = analysis.imageHeight;

  // SAM2 surface mask (full-image alpha) → crop to quad bbox for extractGrayscaleLayers.
  // Lighting then only transfers from real surface pixels (skips fingers/bg inside the quad).
  let surfaceMaskBuf: Buffer | undefined;
  if (typeof surfaceMaskBase64 === "string") {
    const box = quadBBox(quad, W, H);
    surfaceMaskBuf = await sharp(dataUrlToBuffer(surfaceMaskBase64))
      .resize(W, H, { fit: "fill" })
      .extract(box)
      .ensureAlpha()
      .png()
      .toBuffer();
  }

  const [{ screen, multiply }, maskBuf, cleanPhotoBuf, autoOccluderBuf, autoReflectionBuf] = await Promise.all([
    extractGrayscaleLayers(rawPhotoPath, quad, surfaceMaskBuf, floor, blurSig),  // raw photo for accurate lighting
    extractMask(W, H, quad, feather),
    // 1) fill solid magenta with sampled bg, 2) desaturate ONLY the saturated
    //    magenta band (hue 300±50, sat ≥ 0.18) so the pink fringe dies but the
    //    rest of the scene keeps its colour. NB: low minSat (e.g. 0.06) desaturates
    //    near-neutral scene pixels too → grayscales the whole photo. Keep it ≥ 0.18.
    cleanMagentaMarker(cleanSourcePath).then((b) => neutralizeNeonPixels(b, W, H, 300, 50, 0.18)),
    extractOccluder(rawPhotoPath, quad),
    // Reflection map — where the magenta surface bounced into the scene (floor/glass)
    extractReflectionMask(rawPhotoPath, quad, W, H),
  ]);

  // Brush override for the reflection map (user-painted) takes priority over auto-detect
  let reflectionBuf: Buffer = autoReflectionBuf;
  if (typeof reflectionMaskBase64 === "string") {
    reflectionBuf = await sharp(dataUrlToBuffer(reflectionMaskBase64))
      .resize(W, H, { fit: "fill" }).ensureAlpha().blur(4).png().toBuffer();
  }

  // Occluder: a user-painted SAM2 mask overrides the auto-detected one.
  // Cut the raw photo by the mask's shape → occluder.png (composited "over" at render).
  let occluderBuf: Buffer | null = autoOccluderBuf;
  if (typeof occluderMaskBase64 === "string") {
    const maskFull = await sharp(dataUrlToBuffer(occluderMaskBase64)).resize(W, H, { fit: "fill" }).ensureAlpha().png().toBuffer();
    occluderBuf = await sharp(await readFile(rawPhotoPath))
      .ensureAlpha()
      .composite([{ input: maskFull, blend: "dest-in" }])  // keep photo only where mask is opaque
      .png()
      .toBuffer();
  }

  // Clip the ART to the REAL surface: intersect the quad mask with the segment
  // surface mask (when applied) so the art shows only on the actual surface
  // (e.g. the round puck top), not the full quad rectangle → no bleed onto the scene.
  let artMask = maskBuf;
  if (surfaceMaskBuf) {
    const m = await sharp(maskBuf).metadata();
    const surf = await sharp(surfaceMaskBuf).resize(m.width!, m.height!, { fit: "fill" }).ensureAlpha().png().toBuffer();
    artMask = await sharp(maskBuf).ensureAlpha().composite([{ input: surf, blend: "dest-in" }]).png().toBuffer();
  }

  const writes: Promise<void>[] = [
    writeFile(join(dir, "shadow.png"), multiply),
    writeFile(join(dir, "shadow-screen.png"), screen),
    writeFile(join(dir, "mask.png"), artMask),
    writeFile(join(dir, "photo-clean.png"), cleanPhotoBuf),
    writeFile(join(dir, "reflection-mask.png"), reflectionBuf),
  ];
  if (occluderBuf) writes.push(writeFile(join(dir, "occluder.png"), occluderBuf));
  await Promise.all(writes);

  return NextResponse.json({ id, ready: true, quad });
}
