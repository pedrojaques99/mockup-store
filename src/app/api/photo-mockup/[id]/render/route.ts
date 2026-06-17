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

// Blend dos overlays Luz/Sombra → modos do libvips (Sharp). Mesmos nomes do CSS
// mix-blend-mode usado no preview, exceto "normal" → "over".
const LUZ_SHARP_BLEND: Record<string, "over" | "multiply" | "screen" | "overlay" | "soft-light" | "hard-light" | "darken" | "lighten"> = {
  normal: "over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  darken: "darken",
  lighten: "lighten",
};

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
  const { artBase64, shadowOpacity, highlightOpacity, castOpacity, maskFeather, maskContract, fx, warp, textureAmount, specularOpacity, luzOverlays } = body;

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
  let maskRaw = feather > 0
    ? await sharp(maskDisk).ensureAlpha().blur(feather).png().toBuffer()
    : maskDisk;

  // Quad geometry (inner size for warp/relief + bbox for mask/specular placement).
  const q = analysis.quad as { tl:{x:number;y:number}; tr:{x:number;y:number}; br:{x:number;y:number}; bl:{x:number;y:number} };
  const dist = (a:{x:number;y:number}, b:{x:number;y:number}) => Math.hypot(a.x-b.x, a.y-b.y);
  const innerW = Math.max(1, Math.round((dist(q.tl,q.tr) + dist(q.bl,q.br)) / 2));
  const innerH = Math.max(1, Math.round((dist(q.tl,q.bl) + dist(q.tr,q.br)) / 2));
  const qxs = [q.tl.x,q.tr.x,q.br.x,q.bl.x], qys = [q.tl.y,q.tr.y,q.br.y,q.bl.y];
  const qMinX = Math.max(0, Math.floor(Math.min(...qxs)));
  const qMinY = Math.max(0, Math.floor(Math.min(...qys)));
  const outW = Math.max(1, Math.ceil(Math.max(...qxs) - Math.min(...qxs)));
  const outH = Math.max(1, Math.ceil(Math.max(...qys) - Math.min(...qys)));

  // Curved-surface warp (cylinder / edge bend) + surface-relief texture. Built early so
  // the SAME curvature is applied to the mask → boundary bends with the art (perfect bend).
  // Texture relief goes only on the art (it shouldn't jiggle the mask edge).
  let warpDisp: { buffer: Buffer; scale: number } | null = null;
  const texAmt = typeof textureAmount === "number" ? Math.max(0, Math.min(1, textureAmount)) : 0;
  if ((warp && typeof warp === "object") || texAmt > 0) {
    const { buildWarpDisplacement, buildTextureRelief, hasWarp, displaceMask } = await import("@/lib/photo-warp");
    const w = (warp && typeof warp === "object") ? warp : {};
    const relief = texAmt > 0
      ? await buildTextureRelief(
          await sharp(await readFile(rawPhotoPath)).extract({ left: qMinX, top: qMinY, width: outW, height: outH }).png().toBuffer(),
          texAmt, innerW,
        )
      : null;
    warpDisp = await buildWarpDisplacement(innerW, innerH, w, relief);          // art: curvature + relief
    if (hasWarp(w)) {                                                            // mask: curvature only
      const maskMap = await buildWarpDisplacement(innerW, innerH, w);
      if (maskMap) maskRaw = await displaceMask(maskRaw, maskMap.buffer, maskMap.scale, outW, outH);
    }
  }

  // Defringe — contract the mask so the antialiased boundary band never lets the
  // underlying photo (frame/gray) bleed through as a halo on the art edge.
  // Driven by the "Limpar borda" slider (px); default 1.
  const contractPx = typeof maskContract === "number" ? Math.max(0, Math.min(8, Math.round(maskContract))) : 1;
  if (contractPx > 0) {
    const { contractMask } = await import("@/lib/photo-shadow");
    maskRaw = await contractMask(maskRaw, contractPx);
  }

  // SSoT for the full-image mask used by every post-FX pass (specular, light wrap,
  // grain, contact shadow, FX clip). Same maskRaw at the same quad offset every time —
  // build once, lazily, and reuse.
  let _fullMask: Buffer | null = null;
  const getFullMask = async (): Promise<Buffer> =>
    (_fullMask ??= await sharp({
      create: { width: analysis.imageWidth, height: analysis.imageHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: maskRaw, left: qMinX, top: qMinY }])
      .png()
      .toBuffer());

  // SSAA — compose at S× then downscale (lanczos3). The render canvas is locked to the
  // photo size (doc.width/height), so edges (mask + warp grid) only get as many samples
  // as the photo has pixels. Supersampling gives smooth edges; lossless for the photo
  // (upscale S× → downscale S× ≈ original). Adaptive: skip for already-large photos.
  const S = Math.max(analysis.imageWidth, analysis.imageHeight) > 3000 ? 1 : 2;
  const upscale = async (b: Buffer): Promise<Buffer> => {
    if (S <= 1) return b;
    const m = await sharp(b).metadata();
    return sharp(b).resize({ width: Math.round((m.width ?? 1) * S), kernel: "lanczos3" }).png().toBuffer();
  };

  const [photoImg, multiplyImg, maskImg, screenImg] = await Promise.all([
    upscale(await readFile(photoPath)).then(loadImage),
    upscale(await readFile(shadowPath)).then(loadImage),
    upscale(maskRaw).then(loadImage),
    existsSync(screenPath) ? upscale(await readFile(screenPath)).then(loadImage) : Promise.resolve(null),
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
  let artBuf: Buffer = Buffer.from(artData.replace(/^data:image\/\w+;base64,/, ""), "base64");

  // Anti-moiré: pre-filter the art if it's much larger than the surface it warps into.
  // Downsampling fine detail through the warp without this aliases (moiré). Lanczos
  // resize to ~2× the inner size is the standard mipmap-ish prefilter.
  try {
    const meta = await sharp(artBuf).metadata();
    const cap = Math.max(innerW, innerH) * 2;
    if (meta.width && meta.height && Math.max(meta.width, meta.height) > cap * 1.25) {
      artBuf = await sharp(artBuf)
        .resize({ width: meta.width >= meta.height ? cap : undefined, height: meta.height > meta.width ? cap : undefined, kernel: "lanczos3", fit: "inside" })
        .png().toBuffer();
    }
  } catch { /* non-fatal — use art as-is */ }

  const artImg = await loadImage(artBuf);

  const arts: ArtMap = { surface: artImg };

  const sceneOpts: SceneOptions = {};
  if (typeof shadowOpacity === "number") sceneOpts.multiplyOpacity = Math.max(0, Math.min(1, shadowOpacity));
  if (typeof highlightOpacity === "number") sceneOpts.screenOpacity = Math.max(0, Math.min(1, highlightOpacity));
  if (typeof castOpacity === "number") sceneOpts.castOpacity = Math.max(0, Math.min(1, castOpacity));

  // Scale the scene geometry by S so the quad/mask line up with the upscaled assets.
  const docAnalysis = S > 1
    ? {
        ...analysis,
        imageWidth: analysis.imageWidth * S,
        imageHeight: analysis.imageHeight * S,
        quad: {
          tl: { x: q.tl.x * S, y: q.tl.y * S }, tr: { x: q.tr.x * S, y: q.tr.y * S },
          br: { x: q.br.x * S, y: q.br.y * S }, bl: { x: q.bl.x * S, y: q.bl.y * S },
        },
      }
    : analysis;
  const doc = buildPhotoSceneDoc(docAnalysis, sceneOpts);

  // Inject the displacement (the mask was already displaced to match above).
  // dispScale is in px of the face → scale with S since the face is now S× larger.
  if (warpDisp) {
    const face: any = doc.faces[0];
    (assets as any).displacement = await loadImage(warpDisp.buffer);
    face.dispRef = "displacement";
    face.dispScale = warpDisp.scale * S;
  }

  const canvas = renderScene(doc, assets, arts as any, createCanvas as any);
  let png = toBuffer(canvas as any, "image/png") as Buffer;

  // Downscale back to native resolution (lanczos3) before the post-FX passes, which all
  // operate at native size against the original analysis/mask.
  if (S > 1) {
    png = await sharp(png).resize(analysis.imageWidth, analysis.imageHeight, { kernel: "lanczos3" }).png().toBuffer();
  }

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

  // Specular — screen the photo's bright reflections back over the art (glossy gloss).
  const specOp = typeof specularOpacity === "number" ? specularOpacity : 0;
  if (specOp > 0) {
    const { applySpecular } = await import("@/lib/photo-fx");
    png = await applySpecular(png, await readFile(rawPhotoPath), await getFullMask(), analysis.imageWidth, analysis.imageHeight, specOp);
  }

  // Light wrap — ambient scene light bleeding onto the art's inner edge (under occluders).
  const lightWrap = typeof body.lightWrap === "number" ? body.lightWrap : 0;
  if (lightWrap > 0) {
    const { applyLightWrap } = await import("@/lib/photo-fx");
    png = await applyLightWrap(png, await readFile(rawPhotoPath), await getFullMask(), analysis.imageWidth, analysis.imageHeight, lightWrap, 18);
  }

  // Grain + colour match — make the art belong to the scene (temperature + noise).
  const matchScene = typeof body.matchScene === "number" ? body.matchScene : 0;
  if (matchScene > 0) {
    const { applyGrainColorMatch } = await import("@/lib/photo-fx");
    png = await applyGrainColorMatch(png, await readFile(rawPhotoPath), await getFullMask(), analysis.imageWidth, analysis.imageHeight, matchScene);
  }

  // Contact shadow — ground the surface with a soft cast shadow below its edge.
  const contactShadow = typeof body.contactShadow === "number" ? body.contactShadow : 0;
  if (contactShadow > 0) {
    const { applyContactShadow } = await import("@/lib/photo-fx");
    png = await applyContactShadow(png, await getFullMask(), analysis.imageWidth, analysis.imageHeight, contactShadow);
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

      // Clip FX to the surface mask, then overlay on original
      const fxMasked = await sharp(fxFull)
        .composite([{ input: await getFullMask(), blend: "dest-in" }])
        .png()
        .toBuffer();

      png = await sharp(original)
        .composite([{ input: fxMasked, blend: "over" }])
        .png()
        .toBuffer();
    }
  }

  // Luz/Sombra — overlays do usuário compostos sobre TODO o canvas final, no topo
  // (espelha o LuzOverlay do preview: mesma fórmula de contraste/opacidade/blend).
  // Feito com Sharp em resolução nativa → sem mexer no engine nem no fator SSAA.
  if (Array.isArray(luzOverlays) && luzOverlays.length) {
    const W = analysis.imageWidth, H = analysis.imageHeight;
    const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
    for (const ov of luzOverlays.slice(0, 4)) {
      try {
        let buf: Buffer | null = null;
        if (typeof ov.srcBase64 === "string" && ov.srcBase64) {
          buf = Buffer.from(ov.srcBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
        } else if (typeof ov.srcPath === "string" && ov.srcPath && !ov.srcPath.includes("..") && existsSync(ov.srcPath)) {
          buf = await readFile(ov.srcPath);
        }
        if (!buf) continue;

        const scale = typeof ov.scale === "number" ? Math.max(0.05, Math.min(5, ov.scale)) : 1;
        const rotation = typeof ov.rotation === "number" ? ov.rotation : 0;
        const opacity = typeof ov.opacity === "number" ? Math.max(0, Math.min(1, ov.opacity)) : 1;
        const contrast = typeof ov.contrast === "number" ? Math.max(10, Math.min(300, ov.contrast)) : 100;
        const px = ov.position && typeof ov.position.x === "number" ? ov.position.x : 0.5;
        const py = ov.position && typeof ov.position.y === "number" ? ov.position.y : 0.5;
        const blend = LUZ_SHARP_BLEND[ov.blendMode as string] ?? "over";

        // rotate (bbox cresce) → resize p/ largura relativa ao canvas → raw p/ aplicar
        // contraste (só RGB) + opacidade (alpha) num passe.
        let s = sharp(buf).ensureAlpha();
        if (rotation) s = s.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
        s = s.resize({ width: Math.max(1, Math.round(scale * W)) });
        const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
        const a = contrast / 100, b = 128 * (1 - a);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = clamp255(a * data[i] + b);
          data[i + 1] = clamp255(a * data[i + 1] + b);
          data[i + 2] = clamp255(a * data[i + 2] + b);
          data[i + 3] = Math.round(data[i + 3] * opacity);
        }
        const layer = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();

        // posiciona centralizado em (px,py) num canvas do tamanho da base, depois
        // compõe com o blend escolhido (transparência é alpha-aware no libvips).
        const placed = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: layer, left: Math.round(px * W - info.width / 2), top: Math.round(py * H - info.height / 2) }])
          .png()
          .toBuffer();
        png = await sharp(png).composite([{ input: placed, blend }]).png().toBuffer();
      } catch { /* overlay inválido — ignora, não derruba o render */ }
    }
  }

  return new NextResponse(png as unknown as BodyInit, {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
