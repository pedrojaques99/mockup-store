/**
 * Builds a SceneDoc from a photo surface analysis.
 * Lighting: grayscale photo duplicated twice — Screen 30% (luz) + Multiply 20% (sombra).
 * Both clipped to the surface quad. Mask: solid polygon fill.
 */
import type { SurfaceAnalysis } from "./photo-analyze";
import type { SceneDoc } from "@visant/psd-engine";

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export interface SceneOptions {
  /** Override screen (light) opacity. Default 0.30 */
  screenOpacity?: number;
  /** Override multiply (shadow) opacity. Default 0.20 */
  multiplyOpacity?: number;
  /** Color cast overlay opacity (screen blend). Default 0.10. Set 0 to disable. */
  castOpacity?: number;
  /** Calibrado: amplitude do displacement (sobrescreve o default por surfaceType). */
  dispScale?: number;
  /** Calibrado: camada de material procedural (asset "material") + blend. */
  material?: { blend: string; opacity?: number };
}

export function buildPhotoSceneDoc(
  analysis: SurfaceAnalysis,
  opts: SceneOptions = {}
): SceneDoc {
  const { quad, imageWidth, imageHeight, surfaceType } = analysis;

  const topW = dist(quad.tl, quad.tr);
  const botW = dist(quad.bl, quad.br);
  const leftH = dist(quad.tl, quad.bl);
  const rightH = dist(quad.tr, quad.br);
  const innerW = Math.max(1, Math.round((topW + botW) / 2));
  const innerH = Math.max(1, Math.round((leftH + rightH) / 2));

  const screenOpacity   = opts.screenOpacity   ?? 0.30;
  const multiplyOpacity = opts.multiplyOpacity  ?? 0.20;
  const castOpacity     = opts.castOpacity      ?? 0.10;

  const layers: SceneDoc["layers"] = [
    {
      role: "base",
      src: "photo",
      blendMode: "source-over",
      opacity: 1,
      left: 0,
      top: 0,
    },
    // Grayscale photo @ Screen 30% — adds ambient light to art surface
    {
      role: "over",
      src: "light_screen",
      blendMode: "screen",
      opacity: screenOpacity,
      left: 0,
      top: 0,
    },
    // Grayscale photo @ Multiply 20% — adds shadows/occlusion to art surface
    {
      role: "over",
      src: "light_multiply",
      blendMode: "multiply",
      opacity: multiplyOpacity,
      left: 0,
      top: 0,
    },
    // Scene color cast @ Screen 10% — tints art with the scene's ambient light color.
    // Warm golden hour → warm tint on art. Cool office → slight blue. Black outside = neutral.
    ...(castOpacity > 0 ? [{
      role: "over" as const,
      src: "color_cast",
      blendMode: "screen",
      opacity: castOpacity,
      left: 0,
      top: 0,
    }] : []),
    // Material procedural calibrado (asset "material") — tecido/metal/vidro/gasto/sombra.
    // Transparente fora do quad → afeta só a superfície. Blend vindo da calibração.
    ...(opts.material ? [{
      role: "over" as const,
      src: "material",
      blendMode: opts.material.blend as SceneDoc["layers"][number]["blendMode"],
      opacity: opts.material.opacity ?? 0.85,
      left: 0,
      top: 0,
    }] : []),
  ];

  // Displacement scale: calibrado tem prioridade; senão default por surfaceType.
  const DISP_SCALE: Record<string, number> = {
    fabric: 12, tshirt: 12, bag: 10, wall: 8, paper: 6, card: 0, billboard: 0, poster: 0,
  };
  const dispScale = opts.dispScale ?? (DISP_SCALE[surfaceType] ?? 6);

  return {
    version: 1,
    width: imageWidth,
    height: imageHeight,
    faces: [
      {
        key: "surface",
        name: surfaceType,
        quad: [
          quad.tl.x, quad.tl.y,
          quad.tr.x, quad.tr.y,
          quad.br.x, quad.br.y,
          quad.bl.x, quad.bl.y,
        ],
        innerW,
        innerH,
        maskRef: "mask",
        ...(dispScale > 0 ? { dispRef: "displacement", dispScale } : {}),
      },
    ],
    layers,
    warnings: [],
  };
}

/** For backward compat with API routes that call getShadowParams */
export function getShadowParams(_surfaceType: string): { contrastBoost: number } {
  return { contrastBoost: 0 };
}
