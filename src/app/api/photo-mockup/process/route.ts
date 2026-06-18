/**
 * POST /api/photo-mockup/process
 * Extracts shadow map + mask (+ highlight for glossy surfaces) from the photo.
 * - Accepts a custom quad (user-adjusted corners); creates a minimal analysis.json if none exists.
 * - Lighting is always extracted from the RAW photo (not the magenta-prepared one).
 * - photo-clean.png is produced from photo-prepared.png if it exists (neutral surface after magenta removal).
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, unlink, rename } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { extractGrayscaleLayers, extractMask, cleanMagentaMarker, extractOccluder, neutralizeNeonPixels, extractReflectionMask } from "@/lib/photo-shadow";
import type { QuadPoints } from "@/lib/photo-analyze";

const dataUrlToBuffer = (s: string) =>
  Buffer.from(s.replace(/^data:image\/\w+;base64,/, ""), "base64");

// Escrita ATÔMICA: grava num tmp único e renomeia (rename é atômico no mesmo FS).
// Garante que o /render nunca leia um arquivo meio-escrito enquanto o /process roda.
let _wseq = 0;
async function atomicWrite(path: string, buf: Buffer): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.${_wseq++}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, path);
}

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
  const { id, quad: customQuad, featherPx, multiplyFloor, preBlur, surfaceMaskBase64, occluderMaskBase64, reflectionMaskBase64, aiClean, cleanPrompt } = await req.json();

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

  // ── photo-clean: cru (rápido) OU recriado por IA (inpaint do quad) ──────────
  //   `aiClean` → FLUX Fill regenera o quad limpo e cacheia por quad (clean-ai.json);
  //   processos seguintes (sem aiClean) PRESERVAM o clean-IA se o quad não mudou.
  const quadKey = JSON.stringify([quad.tl, quad.tr, quad.br, quad.bl].map((p) => [Math.round(p.x), Math.round(p.y)]));
  const cleanAiPath = join(dir, "clean-ai.json");
  const cleanPath = join(dir, "photo-clean.png");
  let cleanAiMeta: { quad: string } | null = null;
  try { if (existsSync(cleanAiPath)) cleanAiMeta = JSON.parse(await readFile(cleanAiPath, "utf-8")); } catch { /* */ }

  let finalCleanBuf: Buffer | null = cleanPhotoBuf; // default: cru
  let cleanMaterial: string | null = null;
  let aiCleaned = false;        // a IA REALMENTE recriou? (pra não reportar sucesso falso)
  let aiCleanError: string | null = null;
  if (aiClean && process.env.REPLICATE_API_TOKEN) {
    try {
      // Prompt: o do usuário OU adivinhado por visão (material real da superfície).
      let prompt: string;
      if (typeof cleanPrompt === "string" && cleanPrompt.trim()) {
        prompt = cleanPrompt.trim();
      } else {
        const { guessSurfaceMaterial } = await import("@/lib/surface-material");
        cleanMaterial = await guessSurfaceMaterial(await readFile(rawPhotoPath), ext).catch(() => null);
        prompt = cleanMaterial
          ? `seamlessly continue this surface as ${cleanMaterial}, same texture, reflections and lighting, photorealistic, no magenta, no pink, no text, no logo`
          : "seamlessly continue the surrounding surface material and texture into this region, same material, color, reflections and lighting, photorealistic, no magenta, no pink, no text, no logo";
      }
      const pts = [quad.tl, quad.tr, quad.br, quad.bl].map((p) => `${p.x},${p.y}`).join(" ");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/><polygon points="${pts}" fill="white"/></svg>`;
      const quadMask = await sharp(Buffer.from(svg)).blur(2).png().toBuffer();
      const { fluxFillEdit } = await import("@/lib/replicate-edit");
      const r = await fluxFillEdit({
        imageDataUrl: `data:image/png;base64,${cleanPhotoBuf.toString("base64")}`,
        maskDataUrl: `data:image/png;base64,${quadMask.toString("base64")}`,
        prompt,
        steps: 28,
      });
      finalCleanBuf = await sharp(Buffer.from(r.base64.replace(/^data:image\/\w+;base64,/, ""), "base64"))
        .resize(W, H, { fit: "fill" }).png().toBuffer();
      await writeFile(cleanAiPath, JSON.stringify({ quad: quadKey, material: cleanMaterial }));
      aiCleaned = true;
    } catch (e: any) {
      // IA falhou → mantém a limpeza simples (cru) e reporta honesto (sem sucesso falso).
      finalCleanBuf = cleanPhotoBuf;
      aiCleanError = e?.message ?? "falha no inpaint";
    }
  } else if (cleanAiMeta && cleanAiMeta.quad === quadKey && existsSync(cleanPath)) {
    finalCleanBuf = null; // clean-IA válido pro quad atual → preserva
  } else if (cleanAiMeta) {
    try { await unlink(cleanAiPath); } catch { /* */ } // quad mudou → invalida
  }

  const writes: Promise<void>[] = [
    atomicWrite(join(dir, "shadow.png"), multiply),
    atomicWrite(join(dir, "shadow-screen.png"), screen),
    atomicWrite(join(dir, "mask.png"), artMask),
    atomicWrite(join(dir, "reflection-mask.png"), reflectionBuf),
  ];
  if (finalCleanBuf) writes.push(atomicWrite(cleanPath, finalCleanBuf));
  if (occluderBuf) writes.push(atomicWrite(join(dir, "occluder.png"), occluderBuf));
  await Promise.all(writes);

  return NextResponse.json({ id, ready: true, quad, cleanMaterial, aiCleaned: aiClean ? aiCleaned : undefined, aiCleanError });
}
