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
import {
  extractGrayscaleLayers, extractMask, extractReflectionMask, extractOccluder,
  extractColorCastLayer, cleanMagentaMarker, neutralizeNeonPixels,
} from "./photo-shadow";
import type { QuadPoints } from "./photo-analyze";
import {
  LIGHT_FLOOR, LIGHT_PREBLUR, MASK_FEATHER, NEON_HUE, NEON_RANGE, NEON_MINSAT, REFLECTION_OPTS,
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
  /** Mapa de reflexo (full-image). */
  reflectionMask: Buffer;
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
  opts: { surfaceMaskBuf?: Buffer; cleanSource?: string | Buffer } = {},
): Promise<SceneAssets> {
  const { quad, imageWidth: W, imageHeight: H } = analysis;
  const cleanSource = opts.cleanSource ?? rawPhoto;

  const [layers, maskRaw, cleanPhoto, occluder, reflectionMask, colorCast] = await Promise.all([
    extractGrayscaleLayers(rawPhoto, quad, opts.surfaceMaskBuf, LIGHT_FLOOR, LIGHT_PREBLUR),
    extractMask(W, H, quad, MASK_FEATHER),
    cleanMagentaMarker(cleanSource).then((b) => neutralizeNeonPixels(b, W, H, NEON_HUE, NEON_RANGE, NEON_MINSAT)),
    extractOccluder(rawPhoto, quad),
    extractReflectionMask(rawPhoto, quad, W, H, REFLECTION_OPTS),
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
