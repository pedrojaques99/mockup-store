export type FitMode = "cover" | "contain" | "stretch";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameConfig {
  mode: FitMode;
  /** Source-space crop (px) when mode === "cover". Absent = center crop. */
  cropPixels?: CropRect;
  /** CSS color for "contain" letterbox. null = transparent. */
  bg: string | null;
}

export const DEFAULT_FRAME: FrameConfig = { mode: "cover", bg: null };

/** Output dimensions: SO inner size capped at `cap` on the longest edge. */
export function exportSize(soW: number, soH: number, cap = 4096) {
  const scale = Math.min(1, cap / Math.max(soW, soH));
  return {
    width: Math.max(1, Math.round(soW * scale)),
    height: Math.max(1, Math.round(soH * scale)),
  };
}

/** Centered cover crop of the art for a frame ratio (source-space px). */
export function coverCrop(artW: number, artH: number, frameW: number, frameH: number): CropRect {
  const artRatio = artW / artH;
  const frameRatio = frameW / frameH;
  if (artRatio > frameRatio) {
    const width = artH * frameRatio;
    return { x: (artW - width) / 2, y: 0, width, height: artH };
  }
  const height = artW / frameRatio;
  return { x: 0, y: (artH - height) / 2, width: artW, height };
}

/** Centered contain placement of the art inside a frame (frame-space px). */
export function containRect(artW: number, artH: number, frameW: number, frameH: number): CropRect {
  const scale = Math.min(frameW / artW, frameH / artH);
  const width = artW * scale;
  const height = artH * scale;
  return { x: (frameW - width) / 2, y: (frameH - height) / 2, width, height };
}

/**
 * True when the source region is small enough relative to the SO inner size
 * that the upscale will be visible (> 1.5x).
 */
export function isLowRes(srcW: number, srcH: number, soW: number, soH: number, factor = 1.5): boolean {
  if (!srcW || !srcH) return false;
  return soW / srcW > factor || soH / srcH > factor;
}

/**
 * Renders the framed art to a PNG data URL at the SO aspect.
 * Browser-only (uses document.createElement).
 */
export function renderFramedArt(
  img: HTMLImageElement,
  config: FrameConfig,
  soW: number,
  soH: number
): string {
  const { width: outW, height: outH } = exportSize(soW, soH);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  // Fundo da arte — pintado em QUALQUER modo (vale pra PNG transparente/logo: as
  // áreas transparentes recebem essa cor em vez de deixar o placeholder rosa
  // aparecer). bg === null = transparente (aí o placeholder ainda aparece).
  if (config.bg) {
    ctx.fillStyle = config.bg;
    ctx.fillRect(0, 0, outW, outH);
  }

  if (config.mode === "stretch") {
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, outW, outH);
  } else if (config.mode === "contain") {
    const r = containRect(img.naturalWidth, img.naturalHeight, outW, outH);
    ctx.drawImage(img, r.x, r.y, r.width, r.height);
  } else {
    const crop =
      config.cropPixels ?? coverCrop(img.naturalWidth, img.naturalHeight, soW, soH);
    ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH);
  }

  return canvas.toDataURL("image/png");
}
