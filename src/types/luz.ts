/**
 * SSoT do feature "Luz" — duas camadas de overlay (Sombra / Luz) aplicadas sobre
 * o canvas do photo-mockup, com contraste, opacidade, escala, posição, rotação e
 * blend mode. Valores normalizados (posição em fração 0..1, escala relativa à
 * largura do canvas) para o preview (CSS) e o export (renderScene) baterem 1:1.
 */

/** Blend modes suportados — nomes válidos tanto em CSS `mix-blend-mode`
 *  quanto em node-canvas `globalCompositeOperation` (mesmos identificadores). */
export type LuzBlend =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "darken"
  | "lighten";

export const LUZ_BLEND_OPTIONS: { value: LuzBlend; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "soft-light", label: "Soft" },
  { value: "hard-light", label: "Hard" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
];

export type LuzLayerId = "shadow" | "light";

export interface LuzPt { x: number; y: number }
/** Quad de perspectiva (4 cantos) em espaço normalizado 0..1 da CENA. Quando setado,
 *  substitui o posicionamento afim (position/scale/rotation). TL, TR, BR, BL. */
export interface LuzQuad { tl: LuzPt; tr: LuzPt; br: LuzPt; bl: LuzPt }

export interface LuzLayer {
  id: LuzLayerId;
  label: string;
  /** URL exibível no preview (via /api/local-image p/ galeria, ou objectURL p/ upload). */
  src: string | null;
  /** Caminho de disco (galeria) — usado no export server-side. null se upload. */
  srcPath: string | null;
  /** data-URL base64 (upload) — usado no export quando não há srcPath. */
  srcBase64: string | null;
  visible: boolean;
  opacity: number; // 0..1
  contrast: number; // 50..150 (%) — neutro 100
  scale: number; // 0.2..3 (relativo à largura do canvas)
  rotation: number; // -180..180 (graus)
  position: { x: number; y: number }; // 0..1 (centro do overlay no canvas)
  /** Recorte da textura em espaço próprio (pré-transform), normalizado 0..1.
   *  Full = {x:0,y:0,w:1,h:1} (sem recorte). */
  crop: { x: number; y: number; w: number; h: number };
  /** Warp de perspectiva (4 cantos, espaço da cena 0..1). null = posicionamento afim. */
  warpQuad: LuzQuad | null;
  blendMode: LuzBlend;
}

export const LUZ_CROP_FULL = { x: 0, y: 0, w: 1, h: 1 } as const;
/** true quando o recorte cobre a textura inteira (pode pular extract). */
export function isFullCrop(c?: { x: number; y: number; w: number; h: number } | null): boolean {
  return !c || (c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999);
}

export const LUZ_DEFAULTS: LuzLayer[] = [
  {
    id: "shadow",
    label: "Sombra",
    src: null,
    srcPath: null,
    srcBase64: null,
    visible: true,
    opacity: 0.6,
    contrast: 100,
    scale: 1,
    rotation: 0,
    position: { x: 0.5, y: 0.5 },
    crop: { x: 0, y: 0, w: 1, h: 1 },
    warpQuad: null,
    blendMode: "multiply",
  },
  {
    id: "light",
    label: "Luz",
    src: null,
    srcPath: null,
    srcBase64: null,
    visible: true,
    opacity: 0.5,
    contrast: 100,
    scale: 1,
    rotation: 0,
    position: { x: 0.5, y: 0.5 },
    crop: { x: 0, y: 0, w: 1, h: 1 },
    warpQuad: null,
    blendMode: "screen",
  },
];

/** Subset enviado ao render server-side (sem campos só de UI). */
export interface LuzRenderLayer {
  srcPath: string | null;
  srcBase64: string | null;
  opacity: number;
  contrast: number;
  scale: number;
  rotation: number;
  position: { x: number; y: number };
  crop: { x: number; y: number; w: number; h: number };
  warpQuad: LuzQuad | null;
  blendMode: LuzBlend;
}

export function toLuzRenderLayers(layers: LuzLayer[]): LuzRenderLayer[] {
  return layers
    .filter((l) => l.visible && (l.srcPath || l.srcBase64))
    .map((l) => ({
      srcPath: l.srcPath,
      srcBase64: l.srcBase64,
      opacity: l.opacity,
      contrast: l.contrast,
      scale: l.scale,
      rotation: l.rotation,
      position: l.position,
      crop: l.crop ?? { x: 0, y: 0, w: 1, h: 1 },
      warpQuad: l.warpQuad ?? null,
      blendMode: l.blendMode,
    }));
}
