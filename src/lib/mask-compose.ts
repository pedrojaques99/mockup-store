"use client";

/**
 * Client-side mask compositing — the Photoshop model. A mask is an alpha-based
 * raster (white pixels, alpha = coverage; transparent = outside). Instruments
 * (pen / brush / wand / SAM) emit a patch; we ADD it (source-over) or SUBTRACT it
 * (destination-out) into the persistent per-target mask. No instrument replaces
 * the whole mask anymore.
 */

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
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
