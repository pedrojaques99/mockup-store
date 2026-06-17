/**
 * Guided filter (He et al. 2010) — edge-aware mask refinement.
 *
 * Refines a coarse alpha mask `p` so its edges snap to the real edges in a guide
 * image `I` (the scene luminance), producing a soft alpha ramp that follows the
 * surface boundary — the core of Photoshop's "Refine Edge" matte, instead of a
 * uniform blur. O(n) via integral-image box filters.
 */

/** Box filter (mean over a (2r+1)² window) via an integral image. O(w*h). */
export function boxFilter(src: Float64Array, w: number, h: number, r: number): Float64Array {
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += src[y * w + x];
      integ[(y + 1) * (w + 1) + (x + 1)] = integ[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      const s =
        integ[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integ[y0 * (w + 1) + (x1 + 1)] -
        integ[(y1 + 1) * (w + 1) + x0] +
        integ[y0 * (w + 1) + x0];
      out[y * w + x] = s / area;
    }
  }
  return out;
}

/**
 * @param alpha   coarse mask, 0..255 (Uint8), length w*h
 * @param guide   scene RGBA (Uint8ClampedArray), length w*h*4
 * @param radius  filter window radius (px). Larger = softer/wider matte.
 * @param eps     regularization (0..1). Smaller = sharper, edge-snappier.
 * @returns refined alpha, 0..255 (Uint8)
 */
export function refineAlphaGuided(
  alpha: Uint8Array,
  guide: Uint8ClampedArray,
  w: number,
  h: number,
  radius = 6,
  eps = 1e-3,
): Uint8Array {
  const n = w * h;
  const I = new Float64Array(n);   // guide luminance 0..1
  const p = new Float64Array(n);   // input alpha 0..1
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    I[i] = (0.299 * guide[j] + 0.587 * guide[j + 1] + 0.114 * guide[j + 2]) / 255;
    p[i] = alpha[i] / 255;
  }

  const meanI = boxFilter(I, w, h, radius);
  const meanP = boxFilter(p, w, h, radius);
  const II = new Float64Array(n), IP = new Float64Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * p[i]; }
  const corrI = boxFilter(II, w, h, radius);
  const corrIP = boxFilter(IP, w, h, radius);

  const a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i];
    const covIP = corrIP[i] - meanI[i] * meanP[i];
    a[i] = covIP / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxFilter(a, w, h, radius);
  const meanB = boxFilter(b, w, h, radius);

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const q = meanA[i] * I[i] + meanB[i];
    out[i] = q <= 0 ? 0 : q >= 1 ? 255 : Math.round(q * 255);
  }
  return out;
}
