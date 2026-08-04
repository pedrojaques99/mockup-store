"use client";

/**
 * Client-side mask compositing — the Photoshop model. A mask is an alpha-based
 * raster (white pixels, alpha = coverage; transparent = outside). Instruments
 * (pen / brush / wand / SAM) emit a patch; we ADD it (source-over) or SUBTRACT it
 * (destination-out) into the persistent per-target mask. No instrument replaces
 * the whole mask anymore.
 */

export function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    // `onerror = rej` rejeitava com o **Event** cru, e o overlay do Next imprime
    // `String(event)` → "[object Event]": um erro que não diz o que falhou nem
    // onde. A URL é a única pista que importa quando uma máscara não carrega.
    img.onerror = () => rej(new Error(`Não carregou a imagem da máscara: ${url}`));
    img.src = url;
  });
}

/**
 * Resolução máxima (maior lado) com que uma máscara é rasterizada/armazenada.
 * O render-server faz `resize(W,H,fit:fill)` + blur em toda máscara recebida, então
 * full-res no cliente é desperdício — capar aqui corta memória (undo/IndexedDB) e
 * bytes de upload ~4× a 4K, sem diferença visual (a seleção é suave e ainda é borrada).
 */
export const MASK_MAX_EDGE = 2048;

/** Dimensões da máscara capadas a `max` no maior lado, preservando o aspect. Nunca amplia. */
export function capMaskDims(w: number, h: number, max = MASK_MAX_EDGE): [number, number] {
  if (!w || !h) return [w, h];
  const longest = Math.max(w, h);
  if (longest <= max) return [w, h];
  const s = max / longest;
  return [Math.round(w * s), Math.round(h * s)];
}

/** Reamostra um data-URL de máscara para `w×h` (cap). Devolve PNG data-URL. */
export async function resampleMask(url: string, w: number, h: number): Promise<string> {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  cv.getContext("2d")!.drawImage(await loadImg(url), 0, 0, w, h);
  return cv.toDataURL("image/png");
}

/** Composite `patchUrl` into `baseUrl` with add/subtract. Returns a PNG data URL. */
export async function compositeMask(
  baseUrl: string | null,
  patchUrl: string,
  mode: "add" | "sub",
  w: number,
  h: number,
): Promise<string> {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d")!;
  if (baseUrl) ctx.drawImage(await loadImg(baseUrl), 0, 0, w, h);
  ctx.globalCompositeOperation = mode === "add" ? "source-over" : "destination-out";
  ctx.drawImage(await loadImg(patchUrl), 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  return cv.toDataURL("image/png");
}

/** Invert the alpha of a mask (covered ↔ uncovered). Returns a PNG data URL. */
export async function invertMask(url: string, w: number, h: number): Promise<string> {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d")!;
  // Start fully covered (white, opaque), then punch out the current mask.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(await loadImg(url), 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  return cv.toDataURL("image/png");
}
