import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { buildPhotoSceneDoc, type SceneOptions } from "@/lib/photo-scene";
import { applyRenderFX, type RenderFX } from "@/lib/photo-fx";
import type { AssetMap, ArtMap } from "@visant/psd-engine";

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
  const metaPath = join(dir, "meta.json");
  const analysisPath = join(dir, "analysis.json");
  const shadowPath = join(dir, "shadow.png");
  const maskPath = join(dir, "mask.png");

  for (const p of [metaPath, analysisPath, shadowPath, maskPath]) {
    if (!existsSync(p)) {
      return NextResponse.json(
        { error: `Not ready: ${p.split(/[/\\]/).pop()} missing. Run process first.` },
        { status: 400 }
      );
    }
  }

  const body = await req.json();
  const { artBase64, shadowOpacity, highlightOpacity, castOpacity, maskFeather, fx } = body;

  if (!artBase64 || typeof artBase64 !== "string") {
    return NextResponse.json({ error: "artBase64 required" }, { status: 400 });
  }

  const { ext } = JSON.parse(await readFile(metaPath, "utf-8"));
  const analysis = JSON.parse(await readFile(analysisPath, "utf-8"));

  const { createNodeAdapter, renderScene } = await import("@visant/psd-engine");
  const { createCanvas, loadImage, toBuffer } = await createNodeAdapter();

  const rawPhotoPath = join(dir, `photo.${ext}`);
  const cleanPhotoPath = join(dir, "photo-clean.png");
  const photoPath = existsSync(cleanPhotoPath) ? cleanPhotoPath : rawPhotoPath;
  const screenPath = join(dir, "shadow-screen.png");

  // Mask feather is applied live at render time — it's just a blur on the
  // bounding-box polygon mask, so it needs no lighting re-extraction.
  const maskDisk = await readFile(maskPath);
  const feather = typeof maskFeather === "number" ? Math.max(0, Math.min(40, maskFeather)) : 0;
  const maskRaw = feather > 0
    ? await sharp(maskDisk).ensureAlpha().blur(feather).png().toBuffer()
    : maskDisk;

  const [photoImg, multiplyImg, maskImg, screenImg] = await Promise.all([
    loadImage(await readFile(photoPath)),
    loadImage(await readFile(shadowPath)),
    loadImage(maskRaw),
    existsSync(screenPath) ? loadImage(await readFile(screenPath)) : Promise.resolve(null),
  ]);

  const assets: AssetMap = {
    photo: photoImg,
    light_multiply: multiplyImg,
    light_screen: (screenImg ?? multiplyImg) as typeof multiplyImg,
    mask: maskImg,
  };

  const artData = artBase64.startsWith("data:")
    ? artBase64
    : `data:image/png;base64,${artBase64}`;
  const artBuf = Buffer.from(artData.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const artImg = await loadImage(artBuf);

  const arts: ArtMap = { surface: artImg };

  const sceneOpts: SceneOptions = {};
  if (typeof shadowOpacity === "number") sceneOpts.multiplyOpacity = Math.max(0, Math.min(1, shadowOpacity));
  if (typeof highlightOpacity === "number") sceneOpts.screenOpacity = Math.max(0, Math.min(1, highlightOpacity));
  if (typeof castOpacity === "number") sceneOpts.castOpacity = Math.max(0, Math.min(1, castOpacity));

  const doc = buildPhotoSceneDoc(analysis, sceneOpts);

  const canvas = renderScene(doc, assets, arts as any, createCanvas as any);
  let png = toBuffer(canvas as any, "image/png") as Buffer;

  // Reflexo — tint the scene's reflection regions with the artwork's colours
  // (Photoshop "Color" blend). Lives under the occluder so plants stay on top.
  const reflectionMaskPath = join(dir, "reflection-mask.png");
  const reflectionOpacity = typeof body.reflectionOpacity === "number" ? body.reflectionOpacity : 0;
  if (reflectionOpacity > 0 && existsSync(reflectionMaskPath)) {
    const { applyReflection } = await import("@/lib/photo-fx");
    png = await applyReflection(
      png, artBuf, await readFile(reflectionMaskPath),
      analysis.imageWidth, analysis.imageHeight,
      reflectionOpacity, typeof body.reflectionBlur === "number" ? body.reflectionBlur : 24,
    );
  }

  // Composite foreground occluder on top (e.g. plant in front of surface)
  const occluderPath = join(dir, "occluder.png");
  if (existsSync(occluderPath)) {
    png = await sharp(png)
      .composite([{ input: await readFile(occluderPath), blend: "over" }])
      .png()
      .toBuffer();
  }

  // Post-process FX (grain, warmth, saturation, brightness) — mask-clipped to surface only
  if (fx && typeof fx === "object") {
    const fxObj = fx as RenderFX;
    const neutral =
      (fxObj.saturation ?? 100) === 100 &&
      (fxObj.brightness ?? 100) === 100 &&
      (fxObj.contrast   ?? 100) === 100 &&
      (fxObj.warmth     ?? 0)   === 0   &&
      (fxObj.grain      ?? 0)   === 0;

    if (!neutral) {
      const original = png;
      const fxFull   = await applyRenderFX(png, fxObj);

      // Expand bounding-box mask to full image size at quad offset
      const q   = analysis.quad as { tl: {x:number;y:number}; tr: {x:number;y:number}; br: {x:number;y:number}; bl: {x:number;y:number} };
      const xs  = [q.tl.x, q.tr.x, q.br.x, q.bl.x];
      const ys  = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
      const minX = Math.max(0, Math.floor(Math.min(...xs)));
      const minY = Math.max(0, Math.floor(Math.min(...ys)));

      const fullMask = await sharp({
        create: { width: analysis.imageWidth, height: analysis.imageHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: maskRaw, left: minX, top: minY }])
        .png()
        .toBuffer();

      // Clip FX to mask area, then overlay on original
      const fxMasked = await sharp(fxFull)
        .composite([{ input: fullMask, blend: "dest-in" }])
        .png()
        .toBuffer();

      png = await sharp(original)
        .composite([{ input: fxMasked, blend: "over" }])
        .png()
        .toBuffer();
    }
  }

  return new NextResponse(png as unknown as BodyInit, {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
