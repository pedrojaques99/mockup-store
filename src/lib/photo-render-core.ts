/**
 * photo-render-core — CORE ÚNICO do render de mockup-foto (WYSIWYG).
 *
 * Tanto a prévia (/calibrate) quanto a produção (/photo-mockup/[id]/render) passam por
 * aqui, então o look é idêntico por construção. Produção é a fonte da verdade; os defaults
 * vivem em `photo-render-params.ts`. Ver docs/PLAN-render-wysiwyg-unify.md.
 *
 * Fase 1: `extractSceneAssets` — extrator único de luz/máscara/cast/clean/reflexo/occluder.
 *   Usado pelo *bake* (process route) e pela prévia *live*, com os MESMOS params.
 */
import sharp from "sharp";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import {
  extractGrayscaleLayers, extractMask, extractReflectionMask, extractOccluder,
  extractColorCastLayer, cleanMagentaMarker, neutralizeNeonPixels, contractMask,
} from "./photo-shadow";
import type { QuadPoints } from "./photo-analyze";
import type { RenderFX } from "./photo-fx";
import { buildPhotoSceneDoc, type SceneOptions } from "./photo-scene";
import { buildMaterialOverlay, MATERIAL_BLEND, type MaterialKind } from "./material-fx";
import { generateMeshDisplacement, meshIsWarped, composeDispFields, type WarpMesh } from "./mesh-warp";
import {
  LIGHT_FLOOR, LIGHT_PREBLUR, MASK_FEATHER, MASK_CONTRACT, NEON_HUE, NEON_RANGE, NEON_MINSAT,
  REFLECTION_OPTS, type RenderQuality,
} from "./photo-render-params";

export interface SceneAnalysis {
  quad: QuadPoints;
  imageWidth: number;
  imageHeight: number;
  surfaceType?: string;
}

export interface SceneAssets {
  /** Overlay de sombra (multiply) — bbox do quad. */
  multiply: Buffer;
  /** Overlay de brilho (screen) — bbox do quad. */
  screen: Buffer;
  /** Máscara da superfície (bbox do quad, alpha); já interseccionada com SAM se fornecida. */
  mask: Buffer;
  /** Mapa de reflexo (full-image) ou null no modo `fast`. */
  reflectionMask: Buffer | null;
  /** Foto limpa (magenta removido + neon neutralizado), full-image. */
  cleanPhoto: Buffer;
  /** Recorte do oclusor à frente da superfície (full-image) ou null. */
  occluder: Buffer | null;
  /** Camada de color-cast da cena (full-image). */
  colorCast: Buffer;
}

/**
 * Extrai TODOS os assets de cena a partir da foto crua, com os params de produção
 * (SSoT em photo-render-params). Extração pura/automática — overrides do usuário
 * (máscara SAM já é aplicada aqui via `surfaceMaskBuf`; pincéis de occluder/reflexo e
 * AI-clean ficam por conta de quem chama, ex.: o process route).
 */
export async function extractSceneAssets(
  rawPhoto: string | Buffer,
  analysis: SceneAnalysis,
  opts: { surfaceMaskBuf?: Buffer; cleanSource?: string | Buffer; fast?: boolean } = {},
): Promise<SceneAssets> {
  const { quad, imageWidth: W, imageHeight: H } = analysis;
  const cleanSource = opts.cleanSource ?? rawPhoto;
  const fast = opts.fast ?? false; // preview: pula occluder/reflexo (caros) → itera fluido

  const [layers, maskRaw, cleanPhoto, occluder, reflectionMask, colorCast] = await Promise.all([
    extractGrayscaleLayers(rawPhoto, quad, opts.surfaceMaskBuf, LIGHT_FLOOR, LIGHT_PREBLUR),
    extractMask(W, H, quad, MASK_FEATHER),
    cleanMagentaMarker(cleanSource).then((b) => neutralizeNeonPixels(b, W, H, NEON_HUE, NEON_RANGE, NEON_MINSAT)),
    fast ? Promise.resolve(null) : extractOccluder(rawPhoto, quad),
    fast ? Promise.resolve(null) : extractReflectionMask(rawPhoto, quad, W, H, REFLECTION_OPTS),
    extractColorCastLayer(rawPhoto, W, H, quad),
  ]);

  // Intersecta a máscara da arte com a superfície real (SAM) → arte só na superfície.
  let mask = maskRaw;
  if (opts.surfaceMaskBuf) {
    const m = await sharp(maskRaw).metadata();
    const surf = await sharp(opts.surfaceMaskBuf).resize(m.width!, m.height!, { fit: "fill" }).ensureAlpha().png().toBuffer();
    mask = await sharp(maskRaw).ensureAlpha().composite([{ input: surf, blend: "dest-in" }]).png().toBuffer();
  }

  return { multiply: layers.multiply, screen: layers.screen, mask, reflectionMask, cleanPhoto, occluder, colorCast };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 2 — buildBaseComposite: a "base" cacheável (mask prep + disp + material +
// cast + SSAA + engine + downscale). Mesmo código nos dois caminhos = WYSIWYG.
// ─────────────────────────────────────────────────────────────────────────────

/** Subconjunto do engine (@visant/psd-engine / node-canvas) que o core consome. */
export interface RenderEngine {
  createCanvas: (w: number, h: number) => unknown;
  loadImage: (b: Buffer) => Promise<unknown>;
  toBuffer: (c: unknown, t: string) => Buffer;
  renderScene: (doc: unknown, assets: unknown, arts: unknown, cc: unknown) => unknown;
  perspectiveWarp: (ctx: unknown, img: unknown, w: number, h: number, corners: unknown) => void;
}

type Pt = { x: number; y: number };
const scaleQuad = (q: QuadPoints, S: number): QuadPoints => ({
  tl: { x: q.tl.x * S, y: q.tl.y * S }, tr: { x: q.tr.x * S, y: q.tr.y * S },
  br: { x: q.br.x * S, y: q.br.y * S }, bl: { x: q.bl.x * S, y: q.bl.y * S },
});
function scaleMesh(m: WarpMesh, S: number): WarpMesh {
  const sp = (p?: Pt) => (p ? { x: p.x * S, y: p.y * S } : undefined);
  return {
    ...m,
    points: m.points.map((p) => ({ x: p.x * S, y: p.y * S })),
    tangents: m.tangents?.map((t) => ({
      h: sp(t.h)!, v: sp(t.v)!, hOut: sp(t.hOut), hIn: sp(t.hIn), vOut: sp(t.vOut), vIn: sp(t.vIn),
    })),
  };
}

export interface BaseParams {
  warp?: Record<string, number> | null;
  textureAmount?: number;
  mesh?: WarpMesh | null;
  maskFeather?: number;
  maskContract?: number;
  shadowOpacity?: number;
  highlightOpacity?: number;
  castOpacity?: number;
  material?: { kind: MaterialKind; intensity?: number; angle?: number; scale?: number } | null;
}

export interface BaseInput {
  engine: RenderEngine;
  analysis: SceneAnalysis;
  photo: Buffer;     // foto base (limpa)
  rawPhoto: Buffer;  // foto crua (relevo de textura)
  multiply: Buffer;
  screen: Buffer;
  mask: Buffer;      // máscara da superfície, recortada no bbox do quad (origem qMinX,qMinY)
  colorCast?: Buffer;
  artBase64: string;
  params: BaseParams;
  quality: RenderQuality;
}

/** Compõe a BASE (engine) — idêntica em prévia e produção. Devolve base + fullMask nativos. */
export async function buildBaseComposite(input: BaseInput): Promise<{ basePng: Buffer; fullMask: Buffer; innerW: number; innerH: number }> {
  const { engine, analysis, params, quality } = input;
  const { createCanvas, loadImage, toBuffer, renderScene } = engine;
  const W = analysis.imageWidth, H = analysis.imageHeight;
  const q = analysis.quad;
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const innerW = Math.max(1, Math.round((d(q.tl, q.tr) + d(q.bl, q.br)) / 2));
  const innerH = Math.max(1, Math.round((d(q.tl, q.bl) + d(q.tr, q.br)) / 2));
  const qxs = [q.tl.x, q.tr.x, q.br.x, q.bl.x], qys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  const qMinX = Math.max(0, Math.floor(Math.min(...qxs)));
  const qMinY = Math.max(0, Math.floor(Math.min(...qys)));
  const outW = Math.max(1, Math.ceil(Math.max(...qxs) - Math.min(...qxs)));
  const outH = Math.max(1, Math.ceil(Math.max(...qys) - Math.min(...qys)));

  // SSAA só no HD (e só quando a foto não é já enorme). Preview = S1 (caller já reduziu res).
  const S = quality === "hd" ? (Math.max(W, H) > 3000 ? 1 : 2) : 1;
  const upscale = async (b: Buffer): Promise<Buffer> => {
    if (S <= 1) return b;
    const m = await sharp(b).metadata();
    return sharp(b).resize({ width: Math.round((m.width ?? 1) * S), kernel: "lanczos3" }).png().toBuffer();
  };

  // máscara: feather opcional
  const feather = typeof params.maskFeather === "number" ? Math.max(0, Math.min(40, params.maskFeather)) : 0;
  let maskRaw = feather > 0 ? await sharp(input.mask).ensureAlpha().blur(feather).png().toBuffer() : input.mask;

  // warp (cylinder/bend) + relevo de textura → displacement da arte; a máscara recebe o
  // MESMO warp (sem o relevo) pra dobrar junto.
  let warpDisp: { buffer: Buffer; scale: number } | null = null;
  const texAmt = typeof params.textureAmount === "number" ? Math.max(0, Math.min(1, params.textureAmount)) : 0;
  const warp = params.warp && typeof params.warp === "object" ? params.warp : null;
  if (warp || texAmt > 0) {
    const { buildWarpDisplacement, buildTextureRelief, hasWarp, displaceMask } = await import("./photo-warp");
    const w = warp ?? {};
    const relief = texAmt > 0
      ? await buildTextureRelief(
          await sharp(input.rawPhoto).extract({ left: qMinX, top: qMinY, width: outW, height: outH }).png().toBuffer(),
          texAmt, innerW)
      : null;
    warpDisp = await buildWarpDisplacement(innerW, innerH, w, relief);
    if (hasWarp(w)) {
      const maskMap = await buildWarpDisplacement(innerW, innerH, w);
      if (maskMap) maskRaw = await displaceMask(maskRaw, maskMap.buffer, maskMap.scale, outW, outH);
    }
  }

  // defringe — contrai a borda da máscara (anti-halo do fundo)
  const contractPx = typeof params.maskContract === "number" ? Math.max(0, Math.min(8, Math.round(params.maskContract))) : MASK_CONTRACT;
  if (contractPx > 0) maskRaw = await contractMask(maskRaw, contractPx);

  // fullMask (res nativa) — SSoT do clip dos looks
  const fullMask = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: maskRaw, left: qMinX, top: qMinY }]).png().toBuffer();

  const [photoImg, multiplyImg, screenImg, maskImg] = await Promise.all([
    upscale(input.photo).then(loadImage),
    upscale(input.multiply).then(loadImage),
    upscale(input.screen).then(loadImage),
    upscale(maskRaw).then(loadImage),
  ]);

  const assets: Record<string, unknown> = {
    photo: photoImg, light_multiply: multiplyImg, light_screen: screenImg, mask: maskImg,
  };

  // color-cast asset (produção não carregava → o slider de cast era morto)
  if (input.colorCast && (params.castOpacity ?? 0) !== 0) {
    assets.color_cast = await loadImage(await upscale(input.colorCast));
  }

  // material procedural (asset "material") — agora também em produção
  let materialOpt: SceneOptions["material"] | undefined;
  if (params.material && params.material.kind && params.material.kind !== "none") {
    const matBuf = await buildMaterialOverlay(Math.round(W * S), Math.round(H * S), scaleQuad(q, S), {
      material: params.material.kind, intensity: params.material.intensity,
      angle: params.material.angle, scale: params.material.scale,
    });
    if (matBuf) { assets.material = await loadImage(matBuf); materialOpt = { blend: MATERIAL_BLEND[params.material.kind] }; }
  }

  // arte: decode + prefiltro anti-moiré (~2× inner)
  const artData = input.artBase64.startsWith("data:") ? input.artBase64 : `data:image/png;base64,${input.artBase64}`;
  let artBuf: Buffer = Buffer.from(artData.replace(/^data:image\/\w+;base64,/, ""), "base64");
  try {
    const meta = await sharp(artBuf).metadata();
    const cap = Math.max(innerW, innerH) * 2;
    if (meta.width && meta.height && Math.max(meta.width, meta.height) > cap * 1.25) {
      artBuf = await sharp(artBuf).resize({ width: meta.width >= meta.height ? cap : undefined, height: meta.height > meta.width ? cap : undefined, kernel: "lanczos3", fit: "inside" }).png().toBuffer();
    }
  } catch { /* usa a arte como veio */ }
  const arts = { surface: await loadImage(artBuf) };

  const sceneOpts: SceneOptions = {};
  if (typeof params.shadowOpacity === "number") sceneOpts.multiplyOpacity = Math.max(0, Math.min(1, params.shadowOpacity));
  if (typeof params.highlightOpacity === "number") sceneOpts.screenOpacity = Math.max(0, Math.min(1, params.highlightOpacity));
  if (typeof params.castOpacity === "number") sceneOpts.castOpacity = Math.max(0, Math.min(1, params.castOpacity));
  if (materialOpt) sceneOpts.material = materialOpt;

  const docAnalysis = S > 1
    ? { ...analysis, imageWidth: Math.round(W * S), imageHeight: Math.round(H * S), quad: scaleQuad(q, S) }
    : analysis;
  const doc = buildPhotoSceneDoc(docAnalysis as never, sceneOpts);

  // displacement: warp/relief + malha (Coons) — compostos em face-space (bbox do quad)
  if (warpDisp) {
    const face = doc.faces[0] as { dispRef?: string; dispScale?: number };
    assets.displacement = await loadImage(warpDisp.buffer);
    face.dispRef = "displacement"; face.dispScale = warpDisp.scale * S;
  }
  if (params.mesh && Array.isArray(params.mesh.points)) {
    const sMesh = S > 1 ? scaleMesh(params.mesh, S) : params.mesh;
    if (meshIsWarped(sMesh)) {
      const md = await generateMeshDisplacement(sMesh, { quad: docAnalysis.quad });
      if (md) {
        const face = doc.faces[0] as { dispRef?: string; dispScale?: number };
        if (warpDisp) {
          const composed = await composeDispFields([
            { png: md.png, w: md.width, h: md.height, scale: md.dispScale, offsetX: 0, offsetY: 0 },
            { png: warpDisp.buffer, w: md.width, h: md.height, scale: warpDisp.scale * S, offsetX: 0, offsetY: 0 },
          ], md.width, md.height);
          assets.displacement = await loadImage(composed.png); face.dispScale = composed.scale;
        } else {
          assets.displacement = await loadImage(md.png); face.dispScale = md.dispScale;
        }
        face.dispRef = "displacement";
      }
    }
  }

  const canvas = renderScene(doc, assets, arts as never, createCanvas as never);
  let basePng = toBuffer(canvas, "image/png") as Buffer;
  if (S > 1) basePng = await sharp(basePng).resize(W, H, { kernel: "lanczos3" }).png().toBuffer();

  return { basePng, fullMask, innerW, innerH };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 3 — applyLooks: o rail de pós-FX (reflexo/specular/light-wrap/grão/contato
// + occluder + applyRenderFX + luzOverlays). Roda sobre a base nos DOIS caminhos.
// ─────────────────────────────────────────────────────────────────────────────

const LUZ_SHARP_BLEND: Record<string, "over" | "multiply" | "screen" | "overlay" | "soft-light" | "hard-light" | "darken" | "lighten"> = {
  normal: "over", multiply: "multiply", screen: "screen", overlay: "overlay",
  "soft-light": "soft-light", "hard-light": "hard-light", darken: "darken", lighten: "lighten",
};

export interface LuzOverlay {
  srcBase64?: string; srcPath?: string;
  crop?: { x: number; y: number; w: number; h: number };
  scale?: number; rotation?: number; opacity?: number; contrast?: number;
  position?: { x: number; y: number };
  blendMode?: string; maskMode?: string;
  warpQuad?: { tl: Pt; tr: Pt; br: Pt; bl: Pt };
}

export interface LooksParams {
  reflectionOpacity?: number; reflectionBlur?: number;
  specularOpacity?: number; lightWrap?: number; matchScene?: number; contactShadow?: number;
  fx?: RenderFX | null;
  luzOverlays?: LuzOverlay[];
}

export interface LooksInput {
  engine: RenderEngine;
  analysis: SceneAnalysis;
  png: Buffer;
  fullMask: Buffer;
  rawPhoto: Buffer;
  artBase64?: string;
  reflectionMask?: Buffer | null;
  occluder?: Buffer | null;
  params: LooksParams;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" ? v : d);

/** Aplica o rail de looks sobre a base. Idêntico em prévia e produção. */
export async function applyLooks(input: LooksInput): Promise<Buffer> {
  const { engine, analysis, params } = input;
  const { createCanvas, loadImage, toBuffer, perspectiveWarp } = engine;
  const W = analysis.imageWidth, H = analysis.imageHeight;
  const q = analysis.quad;
  let png = input.png;

  // arte (lazy) — reflexo + máscara "art" da luz
  let _artBuf: Buffer | null = null, _artImg: unknown = null;
  const ensureArt = async (): Promise<{ artBuf: Buffer | null; artImg: unknown }> => {
    if (!_artBuf && input.artBase64) {
      _artBuf = Buffer.from(input.artBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      _artImg = await loadImage(_artBuf);
    }
    return { artBuf: _artBuf, artImg: _artImg };
  };

  // FX de loop puro (Tier 2): decodifica 1×, encadeia, encoda 1× — só roda se algo ativo.
  const reflectionOpacity = num(params.reflectionOpacity);
  const reflActive = reflectionOpacity > 0 && !!input.reflectionMask;
  const specOp = num(params.specularOpacity), lightWrap = num(params.lightWrap);
  const matchScene = num(params.matchScene), contactShadow = num(params.contactShadow);

  if (reflActive || specOp > 0 || lightWrap > 0 || matchScene > 0 || contactShadow > 0) {
    const { toPixels, fromPixels, applyReflection, applySpecular, applyLightWrap, applyGrainColorMatch, applyContactShadow } = await import("./photo-fx");
    let px = await toPixels(png);
    const maskPx = await toPixels(input.fullMask);
    if (reflActive) { const { artBuf } = await ensureArt(); if (artBuf) px = await applyReflection(px, artBuf, maskPx, W, H, reflectionOpacity, num(params.reflectionBlur, 24)); }
    if (specOp > 0) px = await applySpecular(px, input.rawPhoto, maskPx, W, H, specOp);
    if (lightWrap > 0) px = await applyLightWrap(px, input.rawPhoto, maskPx, W, H, lightWrap, 18);
    if (matchScene > 0) px = await applyGrainColorMatch(px, input.rawPhoto, maskPx, W, H, matchScene);
    if (contactShadow > 0) px = await applyContactShadow(px, maskPx, W, H, contactShadow);
    png = await fromPixels(px);
  }

  // occluder (planta/objeto à frente)
  if (input.occluder) {
    png = await sharp(png).composite([{ input: input.occluder, blend: "over" }]).png().toBuffer();
  }

  // applyRenderFX (grão/warmth/saturação/brilho/contraste) — clipado na máscara
  if (params.fx && typeof params.fx === "object") {
    const fxObj = params.fx;
    const neutral = (fxObj.saturation ?? 100) === 100 && (fxObj.brightness ?? 100) === 100 &&
      (fxObj.contrast ?? 100) === 100 && (fxObj.warmth ?? 0) === 0 && (fxObj.grain ?? 0) === 0;
    if (!neutral) {
      const { applyRenderFX } = await import("./photo-fx");
      const original = png;
      const fxFull = await applyRenderFX(png, fxObj);
      const fxMasked = await sharp(fxFull).composite([{ input: input.fullMask, blend: "dest-in" }]).png().toBuffer();
      png = await sharp(original).composite([{ input: fxMasked, blend: "over" }]).png().toBuffer();
    }
  }

  // Luz/Sombra — overlays do usuário sobre o canvas final (mesma fórmula do preview).
  if (Array.isArray(params.luzOverlays) && params.luzOverlays.length) {
    const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
    let _luzSurfMask: Buffer | null = null, _luzArtMask: Buffer | null = null;
    const luzMaskBuf = async (mode: unknown): Promise<Buffer | null> => {
      if (mode === "surface") {
        if (!_luzSurfMask) {
          const cv = createCanvas(W, H); const c = (cv as { getContext: (t: string) => CanvasRenderingContext2D }).getContext("2d");
          c.fillStyle = "#fff"; c.beginPath();
          c.moveTo(q.tl.x, q.tl.y); c.lineTo(q.tr.x, q.tr.y); c.lineTo(q.br.x, q.br.y); c.lineTo(q.bl.x, q.bl.y);
          c.closePath(); c.fill();
          _luzSurfMask = toBuffer(cv, "image/png");
        }
        return _luzSurfMask;
      }
      if (mode === "art") {
        if (!_luzArtMask) {
          const { artImg } = await ensureArt();
          if (!artImg) return null;
          const cv = createCanvas(W, H); const c = (cv as { getContext: (t: string) => unknown }).getContext("2d");
          const corners = [q.tl, q.tr, q.br, q.bl].map((p) => ({ x: p.x, y: p.y }));
          perspectiveWarp(c, artImg, (artImg as { width: number }).width, (artImg as { height: number }).height, corners);
          _luzArtMask = toBuffer(cv, "image/png");
        }
        return _luzArtMask;
      }
      return null;
    };
    const clipLuz = async (placed: Buffer, mode: unknown): Promise<Buffer> => {
      const m = await luzMaskBuf(mode);
      return m ? await sharp(placed).composite([{ input: m, blend: "dest-in" }]).png().toBuffer() : placed;
    };
    for (const ov of params.luzOverlays.slice(0, 4)) {
      try {
        let buf: Buffer | null = null;
        if (typeof ov.srcBase64 === "string" && ov.srcBase64) {
          buf = Buffer.from(ov.srcBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
        } else if (typeof ov.srcPath === "string" && ov.srcPath && !ov.srcPath.includes("..") && existsSync(ov.srcPath)) {
          buf = await readFile(ov.srcPath);
        }
        if (!buf) continue;

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

        const wq = ov.warpQuad;
        if (wq && wq.tl && wq.tr && wq.br && wq.bl) {
          const { data: td, info: ti } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const ca = contrast / 100, cb = 128 * (1 - ca);
          for (let i = 0; i < td.length; i += 4) {
            td[i] = clamp255(ca * td[i] + cb); td[i + 1] = clamp255(ca * td[i + 1] + cb);
            td[i + 2] = clamp255(ca * td[i + 2] + cb); td[i + 3] = Math.round(td[i + 3] * opacity);
          }
          const texPng = await sharp(td, { raw: { width: ti.width, height: ti.height, channels: 4 } }).png().toBuffer();
          const src = await loadImage(texPng);
          const cv = createCanvas(W, H);
          const cx2 = (cv as { getContext: (t: string) => unknown }).getContext("2d");
          const corners = [wq.tl, wq.tr, wq.br, wq.bl].map((p) => ({ x: p.x * W, y: p.y * H }));
          perspectiveWarp(cx2, src, ti.width, ti.height, corners);
          const placed = await clipLuz(toBuffer(cv, "image/png"), ov.maskMode);
          png = await sharp(png).composite([{ input: placed, blend }]).png().toBuffer();
          continue;
        }

        let s = sharp(buf).ensureAlpha();
        if (rotation) s = s.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
        s = s.resize({ width: Math.max(1, Math.round(scale * W)) });
        const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
        const a = contrast / 100, b = 128 * (1 - a);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = clamp255(a * data[i] + b); data[i + 1] = clamp255(a * data[i + 1] + b);
          data[i + 2] = clamp255(a * data[i + 2] + b); data[i + 3] = Math.round(data[i + 3] * opacity);
        }
        const layer = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
        const placedRaw = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: layer, left: Math.round(px * W - info.width / 2), top: Math.round(py * H - info.height / 2) }])
          .png().toBuffer();
        const placed = await clipLuz(placedRaw, ov.maskMode);
        png = await sharp(png).composite([{ input: placed, blend }]).png().toBuffer();
      } catch { /* overlay inválido — ignora */ }
    }
  }

  return png;
}
