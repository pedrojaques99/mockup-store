import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { buildPhotoSceneDoc, type SceneOptions } from "@/lib/photo-scene";
import { applyRenderFX, type RenderFX } from "@/lib/photo-fx";
import { getEngine, readFileCached, sha, getBaseComposite, setBaseComposite } from "@/lib/render-cache";
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

const mtime = (p: string): number => { try { return statSync(p).mtimeMs; } catch { return 0; } };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || !/^[a-f0-9]{16}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // ── Server-Timing: marca etapas pra header (observabilidade do gargalo). ──
  const T: Array<[string, number]> = [];
  let _t = Date.now();
  const mark = (name: string) => { const now = Date.now(); T.push([name, now - _t]); _t = now; };

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
  const { artBase64, shadowOpacity, highlightOpacity, castOpacity, maskFeather, maskContract, fx, warp, textureAmount, specularOpacity, luzOverlays, mesh } = body;

  if (!artBase64 || typeof artBase64 !== "string") {
    return NextResponse.json({ error: "artBase64 required" }, { status: 400 });
  }

  const { ext } = JSON.parse(await readFileCached(metaPath).then((b) => b.toString("utf-8")));
  const analysis = JSON.parse(await readFileCached(analysisPath).then((b) => b.toString("utf-8")));

  const engine = await getEngine();
  const { createCanvas, loadImage, toBuffer, renderScene, perspectiveWarp } = engine;
  mark("init");

  const rawPhotoPath = join(dir, `photo.${ext}`);
  const cleanPhotoPath = join(dir, "photo-clean.png");
  const photoPath = existsSync(cleanPhotoPath) ? cleanPhotoPath : rawPhotoPath;
  const screenPath = join(dir, "shadow-screen.png");

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

  // Art decode + anti-moiré prefilter. Lazy: no cache-hit, só roda se um FX de look
  // precisar (reflexo/luz) — o engine (que consome a arte) nem é chamado.
  let _art: { artBuf: Buffer; artImg: unknown } | null = null;
  const ensureArt = async (): Promise<{ artBuf: Buffer; artImg: unknown }> => {
    if (_art) return _art;
    const artData = artBase64.startsWith("data:") ? artBase64 : `data:image/png;base64,${artBase64}`;
    let artBuf: Buffer = Buffer.from(artData.replace(/^data:image\/\w+;base64,/, ""), "base64");
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
    _art = { artBuf, artImg: await loadImage(artBuf) };
    return _art;
  };

  // ── Tier 1: cache do composite BASE (engine+downscale) + fullMask, keyed pela
  //    geometria. Mexer só no look (sombra/realismo/grão/specular…) reaproveita a base
  //    e pula warp+SSAA+engine. A chave inclui mtime dos assets → re-extração invalida. ──
  const filesSig = sha(mtime(photoPath), mtime(shadowPath), mtime(screenPath), mtime(maskPath));
  const geomKey = id + ":" + sha(
    artBase64, q, warp ?? null, mesh ?? null, textureAmount ?? 0, maskFeather ?? 0, maskContract ?? 1,
    shadowOpacity ?? null, highlightOpacity ?? null, castOpacity ?? null, S, filesSig,
  );

  let basePng: Buffer;
  let fullMask: Buffer;
  const cached = getBaseComposite(geomKey);

  if (cached) {
    basePng = cached.basePng;
    fullMask = cached.fullMask;
    mark("base-cache-hit");
  } else {
    // Mask feather is applied live — it's just a blur on the bbox polygon mask.
    const maskDisk = await readFileCached(maskPath);
    const feather = typeof maskFeather === "number" ? Math.max(0, Math.min(40, maskFeather)) : 0;
    let maskRaw = feather > 0
      ? await sharp(maskDisk).ensureAlpha().blur(feather).png().toBuffer()
      : maskDisk;

    // Curved-surface warp (cylinder / edge bend) + surface-relief texture. Built early so
    // the SAME curvature is applied to the mask → boundary bends with the art (perfect bend).
    let warpDisp: { buffer: Buffer; scale: number } | null = null;
    const texAmt = typeof textureAmount === "number" ? Math.max(0, Math.min(1, textureAmount)) : 0;
    if ((warp && typeof warp === "object") || texAmt > 0) {
      const { buildWarpDisplacement, buildTextureRelief, hasWarp, displaceMask } = await import("@/lib/photo-warp");
      const w = (warp && typeof warp === "object") ? warp : {};
      const relief = texAmt > 0
        ? await buildTextureRelief(
            await sharp(await readFileCached(rawPhotoPath)).extract({ left: qMinX, top: qMinY, width: outW, height: outH }).png().toBuffer(),
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
    const contractPx = typeof maskContract === "number" ? Math.max(0, Math.min(8, Math.round(maskContract))) : 1;
    if (contractPx > 0) {
      const { contractMask } = await import("@/lib/photo-shadow");
      maskRaw = await contractMask(maskRaw, contractPx);
    }
    mark("mask");

    // fullMask — máscara da superfície no espaço da imagem (W×H, alpha). SSoT de todo
    // FX de look. Construída uma vez aqui e cacheada junto da base.
    fullMask = await sharp({
      create: { width: analysis.imageWidth, height: analysis.imageHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: maskRaw, left: qMinX, top: qMinY }])
      .png()
      .toBuffer();

    const screenPathExists = existsSync(screenPath);
    const [photoImg, multiplyImg, maskImg, screenImg] = await Promise.all([
      upscale(await readFileCached(photoPath)).then(loadImage),
      upscale(await readFileCached(shadowPath)).then(loadImage),
      upscale(maskRaw).then(loadImage),
      screenPathExists ? upscale(await readFileCached(screenPath)).then(loadImage) : Promise.resolve(null),
    ]);
    mark("ssaa");

    const assets: AssetMap = {
      photo: photoImg as never,
      light_multiply: multiplyImg as never,
      light_screen: (screenImg ?? multiplyImg) as never,
      mask: maskImg as never,
    };

    const { artImg } = await ensureArt();
    const arts: ArtMap = { surface: artImg as never };

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
    if (warpDisp) {
      const face = doc.faces[0] as { dispRef?: string; dispScale?: number };
      (assets as Record<string, unknown>).displacement = await loadImage(warpDisp.buffer);
      face.dispRef = "displacement";
      face.dispScale = warpDisp.scale * S;
    }

    // Malha de warp (envelope Coons — SSoT do doc) **+** warpDisp (cylinder/bend +
    // texture relief): trabalham juntos. Composição via composeDispFields — soma os
    // offsets em px reais e renormaliza. O engine recebe UM displacement com tudo.
    if (mesh && Array.isArray(mesh.points)) {
      const { generateMeshDisplacement, meshIsWarped, composeDispFields } = await import("@/lib/mesh-warp");
      const scalePt = (p?: { x: number; y: number }) => (p ? { x: p.x * S, y: p.y * S } : undefined);
      const sMesh = S > 1
        ? { ...mesh, points: mesh.points.map((p: { x: number; y: number }) => ({ x: p.x * S, y: p.y * S })),
            tangents: mesh.tangents?.map((t: Record<string, { x: number; y: number } | undefined>) => ({
              h: scalePt(t.h), v: scalePt(t.v),
              hOut: scalePt(t.hOut), hIn: scalePt(t.hIn), vOut: scalePt(t.vOut), vIn: scalePt(t.vIn),
            })) }
        : mesh;
      if (meshIsWarped(sMesh)) {
        const md = await generateMeshDisplacement(sMesh);
        if (md) {
          const face = doc.faces[0] as { dispRef?: string; dispScale?: number };
          // Se já há warpDisp (cylinder/bend/textura), compor os dois → um disp só.
          if (warpDisp) {
            const Wc = analysis.imageWidth * S, Hc = analysis.imageHeight * S;
            const composed = await composeDispFields([
              { png: md.png, w: md.width, h: md.height, scale: md.dispScale, offsetX: md.offsetX, offsetY: md.offsetY },
              // warpDisp é gerado no espaço inner (innerW×innerH) e o engine o casa pelo quad.
              // Aqui assumimos full-canvas pra somar — mais simples e funcional pra blend macro+micro.
              { png: warpDisp.buffer, w: Wc, h: Hc, scale: warpDisp.scale * S, offsetX: 0, offsetY: 0 },
            ], Wc, Hc);
            (assets as Record<string, unknown>).displacement = await loadImage(composed.png);
            face.dispScale = composed.scale;
          } else {
            (assets as Record<string, unknown>).displacement = await loadImage(md.png);
            face.dispScale = md.dispScale;
          }
          face.dispRef = "displacement";
        }
      }
    }

    const canvas = renderScene(doc, assets, arts as never, createCanvas as never);
    let png = toBuffer(canvas, "image/png") as Buffer;
    mark("engine");

    // Downscale back to native resolution (lanczos3) before the post-FX passes.
    if (S > 1) {
      png = await sharp(png).resize(analysis.imageWidth, analysis.imageHeight, { kernel: "lanczos3" }).png().toBuffer();
    }
    mark("downscale");

    basePng = png;
    setBaseComposite(geomKey, { basePng, fullMask });
  }

  // ── LOOK (barato) — roda sobre a base. Tudo daqui pra baixo NÃO re-warpa. ──
  let png = basePng;
  const W0 = analysis.imageWidth, H0 = analysis.imageHeight;

  // FX de loop puro (reflexo, specular, light-wrap, grão/match, contato): trocam
  // pixels crus entre si (Tier 2). Decodifica a base 1×, encadeia, encoda 1× — só
  // entra no rail se algum estiver ativo (cache-hit sem look devolve a base intacta).
  const reflectionMaskPath = join(dir, "reflection-mask.png");
  const reflectionOpacity = typeof body.reflectionOpacity === "number" ? body.reflectionOpacity : 0;
  const reflActive = reflectionOpacity > 0 && existsSync(reflectionMaskPath);
  const specOp = typeof specularOpacity === "number" ? specularOpacity : 0;
  const lightWrap = typeof body.lightWrap === "number" ? body.lightWrap : 0;
  const matchScene = typeof body.matchScene === "number" ? body.matchScene : 0;
  const contactShadow = typeof body.contactShadow === "number" ? body.contactShadow : 0;

  if (reflActive || specOp > 0 || lightWrap > 0 || matchScene > 0 || contactShadow > 0) {
    const { toPixels, fromPixels, applyReflection, applySpecular, applyLightWrap, applyGrainColorMatch, applyContactShadow } = await import("@/lib/photo-fx");
    let px = await toPixels(basePng);
    const maskPx = await toPixels(fullMask);

    if (reflActive) {
      const { artBuf } = await ensureArt();
      px = await applyReflection(px, artBuf, maskPx, W0, H0, reflectionOpacity, typeof body.reflectionBlur === "number" ? body.reflectionBlur : 24);
    }
    if (specOp > 0)       px = await applySpecular(px, await readFileCached(rawPhotoPath), maskPx, W0, H0, specOp);
    if (lightWrap > 0)    px = await applyLightWrap(px, await readFileCached(rawPhotoPath), maskPx, W0, H0, lightWrap, 18);
    if (matchScene > 0)   px = await applyGrainColorMatch(px, await readFileCached(rawPhotoPath), maskPx, W0, H0, matchScene);
    if (contactShadow > 0) px = await applyContactShadow(px, maskPx, W0, H0, contactShadow);

    png = await fromPixels(px);
  }
  mark("fx-passes");

  // Composite foreground occluder on top (e.g. plant in front of surface)
  const occluderPath = join(dir, "occluder.png");
  if (existsSync(occluderPath)) {
    png = await sharp(png)
      .composite([{ input: await readFileCached(occluderPath), blend: "over" }])
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
        .composite([{ input: fullMask, blend: "dest-in" }])
        .png()
        .toBuffer();

      png = await sharp(original)
        .composite([{ input: fxMasked, blend: "over" }])
        .png()
        .toBuffer();
    }
  }
  mark("look-fx");

  // Luz/Sombra — overlays do usuário compostos sobre TODO o canvas final, no topo
  // (espelha o LuzOverlay do preview: mesma fórmula de contraste/opacidade/blend).
  if (Array.isArray(luzOverlays) && luzOverlays.length) {
    const W = analysis.imageWidth, H = analysis.imageHeight;
    const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

    // Máscaras de clip da Luz (maskMode), em px nativos (W×H), alpha = cobertura.
    let _luzSurfMask: Buffer | null = null, _luzArtMask: Buffer | null = null;
    const luzMaskBuf = async (mode: unknown): Promise<Buffer | null> => {
      if (mode === "surface") {
        if (!_luzSurfMask) {
          const cv = createCanvas(W, H); const c = (cv as { getContext: (t: string) => CanvasRenderingContext2D }).getContext("2d");
          c.fillStyle = "#fff"; c.beginPath();
          c.moveTo(q.tl.x, q.tl.y); c.lineTo(q.tr.x, q.tr.y); c.lineTo(q.br.x, q.br.y); c.lineTo(q.bl.x, q.bl.y);
          c.closePath(); c.fill();
          _luzSurfMask = toBuffer(cv, "image/png") as Buffer;
        }
        return _luzSurfMask;
      }
      if (mode === "art") {
        if (!_luzArtMask) {
          const { artImg } = await ensureArt();
          const cv = createCanvas(W, H); const c = (cv as { getContext: (t: string) => unknown }).getContext("2d");
          const corners = [q.tl, q.tr, q.br, q.bl].map((p) => ({ x: p.x, y: p.y }));
          perspectiveWarp(c, artImg, (artImg as { width: number }).width, (artImg as { height: number }).height, corners);
          _luzArtMask = toBuffer(cv, "image/png") as Buffer;
        }
        return _luzArtMask;
      }
      return null;
    };
    // Aplica o clip (dest-in) num layer já posicionado (W×H) antes do blend final.
    const clipLuz = async (placed: Buffer, mode: unknown): Promise<Buffer> => {
      const m = await luzMaskBuf(mode);
      return m ? await sharp(placed).composite([{ input: m, blend: "dest-in" }]).png().toBuffer() : placed;
    };
    for (const ov of luzOverlays.slice(0, 4)) {
      try {
        let buf: Buffer | null = null;
        if (typeof ov.srcBase64 === "string" && ov.srcBase64) {
          buf = Buffer.from(ov.srcBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
        } else if (typeof ov.srcPath === "string" && ov.srcPath && !ov.srcPath.includes("..") && existsSync(ov.srcPath)) {
          buf = await readFileCached(ov.srcPath);
        }
        if (!buf) continue;

        // Recorte da textura (espaço próprio, pré-transform).
        const cr = ov.crop;
        if (cr && (cr.x > 0.001 || cr.y > 0.001 || cr.w < 0.999 || cr.h < 0.999)) {
          const meta = await sharp(buf).metadata();
          const nw = meta.width ?? 0, nh = meta.height ?? 0;
          if (nw && nh) {
            const cx = Math.max(0, Math.min(nw - 1, Math.round(cr.x * nw)));
            const cy = Math.max(0, Math.min(nh - 1, Math.round(cr.y * nh)));
            const cw = Math.max(1, Math.min(nw - cx, Math.round(cr.w * nw)));
            const ch = Math.max(1, Math.min(nh - cy, Math.round(cr.h * nh)));
            const cropped = await sharp(buf).ensureAlpha().extract({ left: cx, top: cy, width: cw, height: ch }).png().toBuffer();
            buf = await sharp({ create: { width: nw, height: nh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
              .composite([{ input: cropped, left: cx, top: cy }]).png().toBuffer();
          }
        }

        const scale = typeof ov.scale === "number" ? Math.max(0.05, Math.min(5, ov.scale)) : 1;
        const rotation = typeof ov.rotation === "number" ? ov.rotation : 0;
        const opacity = typeof ov.opacity === "number" ? Math.max(0, Math.min(1, ov.opacity)) : 1;
        const contrast = typeof ov.contrast === "number" ? Math.max(10, Math.min(300, ov.contrast)) : 100;
        const px = ov.position && typeof ov.position.x === "number" ? ov.position.x : 0.5;
        const py = ov.position && typeof ov.position.y === "number" ? ov.position.y : 0.5;
        const blend = LUZ_SHARP_BLEND[ov.blendMode as string] ?? "over";

        // Warp de perspectiva (4 cantos) — MESMA homografia DLT da arte.
        const wq = ov.warpQuad;
        if (wq && wq.tl && wq.tr && wq.br && wq.bl) {
          const { data: td, info: ti } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const ca = contrast / 100, cb = 128 * (1 - ca);
          for (let i = 0; i < td.length; i += 4) {
            td[i] = clamp255(ca * td[i] + cb);
            td[i + 1] = clamp255(ca * td[i + 1] + cb);
            td[i + 2] = clamp255(ca * td[i + 2] + cb);
            td[i + 3] = Math.round(td[i + 3] * opacity);
          }
          const texPng = await sharp(td, { raw: { width: ti.width, height: ti.height, channels: 4 } }).png().toBuffer();
          const src = await loadImage(texPng);
          const cv = createCanvas(W, H);
          const cx2 = (cv as { getContext: (t: string) => unknown }).getContext("2d");
          const corners = [wq.tl, wq.tr, wq.br, wq.bl].map((p: { x: number; y: number }) => ({ x: p.x * W, y: p.y * H }));
          perspectiveWarp(cx2, src, ti.width, ti.height, corners);
          const placed = await clipLuz(toBuffer(cv, "image/png") as Buffer, ov.maskMode);
          png = await sharp(png).composite([{ input: placed, blend }]).png().toBuffer();
          continue;
        }

        // rotate → resize p/ largura relativa ao canvas → raw p/ contraste+opacidade.
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

        const placedRaw = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: layer, left: Math.round(px * W - info.width / 2), top: Math.round(py * H - info.height / 2) }])
          .png()
          .toBuffer();
        const placed = await clipLuz(placedRaw, ov.maskMode);
        png = await sharp(png).composite([{ input: placed, blend }]).png().toBuffer();
      } catch { /* overlay inválido — ignora, não derruba o render */ }
    }
  }
  mark("luz");

  const serverTiming = T.map(([n, d]) => `${n};dur=${d}`).join(", ");

  return new NextResponse(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Server-Timing": serverTiming,
    },
  });
}
