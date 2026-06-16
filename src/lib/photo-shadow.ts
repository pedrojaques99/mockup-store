/**
 * Lighting extraction for photo mockups.
 *
 * Technique: duplicate photo → grayscale → two overlay layers:
 *   - Screen  @ 30%: adds ambient light where surface is bright
 *   - Multiply @ 20%: adds shadow where surface is dark
 * Both clipped to the surface quad (neutral outside: black for screen, white for multiply).
 *
 * This matches the standard Photoshop smart-object mockup technique and is far
 * simpler than per-channel normalization — no white-reference needed, no floor darkening.
 */
import sharp from "sharp";
import type { QuadPoints } from "./photo-analyze";
import { detectDominantVividHue } from "./photo-detect";

function rgbToHslShadow(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

/**
 * Expand each quad corner outward from the centroid by expandPx pixels.
 * Use before extractMask for neon sources to ensure the mask fully covers
 * any residual key-color pixels at the surface boundary.
 */
export function expandQuad(quad: QuadPoints, expandPx: number, maxW: number, maxH: number): QuadPoints {
  const cx = (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4;
  const cy = (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4;
  const expandPt = (p: { x: number; y: number }) => {
    const dx = p.x - cx, dy = p.y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: Math.max(0, Math.min(maxW - 1, Math.round(p.x + (dx / len) * expandPx))),
      y: Math.max(0, Math.min(maxH - 1, Math.round(p.y + (dy / len) * expandPx))),
    };
  };
  return { tl: expandPt(quad.tl), tr: expandPt(quad.tr), br: expandPt(quad.br), bl: expandPt(quad.bl) };
}

/**
 * Convert neon key-color pixels (hue-range match) to neutral grayscale in the photo.
 * Call before lighting extraction and rendering to remove the magenta/neon cast
 * so it doesn't bleed around art edges through the mask.
 * Returns a PNG buffer with neutralized pixels; all other pixels unchanged.
 */
export async function neutralizeNeonPixels(
  photoSource: string | Buffer,
  width: number,
  height: number,
  hueCenter?: number,  // auto-detect dominant vivid hue when undefined
  hueRange = 40,
  minSat = 0.35,
): Promise<Buffer> {
  // Auto-detect dominant vivid hue if not specified
  if (hueCenter === undefined) {
    const detected = await detectDominantVividHue(photoSource, width, height);
    hueCenter = detected ?? 300; // fallback to classic magenta if nothing detected
  }

  const { data } = await sharp(photoSource)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const hLo = ((hueCenter - hueRange + 360) % 360) / 360;
  const hHi = ((hueCenter + hueRange) % 360) / 360;
  const ch = 4;

  for (let i = 0; i < width * height; i++) {
    const idx = i * ch;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    const [h, s] = rgbToHslShadow(r, g, b);
    const hMatch = hLo <= hHi ? (h >= hLo && h <= hHi) : (h >= hLo || h <= hHi);
    if (hMatch && s >= minSat) {
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      data[idx] = data[idx + 1] = data[idx + 2] = gray;
    }
  }

  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// Winding-number point-in-polygon (handles CW and CCW quads).
function inQuad(px: number, py: number, q: QuadPoints): boolean {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let winding = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    if (a.y <= py) {
      if (b.y > py && (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x) > 0) winding++;
    } else {
      if (b.y <= py && (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x) < 0) winding--;
    }
  }
  return winding !== 0;
}

/**
 * Extract two grayscale lighting layers from a photo, clipped to the surface quad.
 *
 * Returns:
 *   screen   — grayscale inside quad, BLACK outside  (neutral for screen blend)
 *   multiply — grayscale inside quad, WHITE outside  (neutral for multiply blend)
 *
 * Usage in SceneDoc:
 *   { src: "light_screen",   blendMode: "screen",   opacity: 0.30 }
 *   { src: "light_multiply", blendMode: "multiply", opacity: 0.20 }
 *
 * @param surfaceMaskBuf  Optional bounding-box pixel mask. Where mask < 128, the
 *   pixel is NOT the surface (fingers, background within the card quad) → stays neutral.
 *   This prevents non-surface elements (dark clothing, skin) from darkening the art
 *   through the multiply layer when they fall inside the detected quad rectangle.
 * @param multiplyFloor  Minimum gray value for the multiply layer (default 0 = unclamped).
 *   Physical imperfections (tape marks, stains) have very low gray but are NOT real
 *   lighting information. Clamping to 180 limits max darkening to ~6% (360/255 × opacity)
 *   while still preserving genuine edge shadows and gradients (which are typically 190-255).
 */
export async function extractGrayscaleLayers(
  photoPath: string | Buffer,
  quad: QuadPoints,
  surfaceMaskBuf?: Buffer,
  multiplyFloor = 0,
  /** Pre-blur sigma applied to the photo before grayscale extraction. Use for
   *  textured surfaces (stone/marble) to smear out baked-in text/watermarks while
   *  preserving broad lighting gradients. Default 0 (no blur). */
  preBlur = 0,
): Promise<{ screen: Buffer; multiply: Buffer }> {
  let src = sharp(photoPath).ensureAlpha();
  if (preBlur > 0) src = src.blur(preBlur);
  const { data, info } = await src
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const outW = maxX - minX + 1;

  // Decode optional surface mask (bounding-box sized PNG from extractSurfaceMaskCV)
  let maskData: Buffer | null = null;
  let maskCh = 4;
  if (surfaceMaskBuf) {
    const dec = await sharp(surfaceMaskBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    maskData = dec.data as Buffer;
    maskCh = dec.info.channels;
  }

  // Collect surface-only grayscale for normalization (P95 white reference)
  const grays: number[] = [];
  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      if (!inQuad(x, y, quad)) continue;
      if (maskData) {
        const mi = ((y - minY) * outW + (x - minX)) * maskCh;
        if (maskData[mi] < 128) continue;
      }
      const src = (y * width + x) * channels;
      grays.push(Math.round(0.299 * data[src] + 0.587 * data[src + 1] + 0.114 * data[src + 2]));
    }
  }
  // P95 white reference — normalize so brightest surface = 255 (neutral for multiply)
  const sorted = Float32Array.from(grays).sort();
  const whiteRef = Math.max(1, sorted[Math.floor(sorted.length * 0.95)] ?? 255);

  // screen: black outside (screen with black = no effect)
  // multiply: white outside (multiply with white = no effect)
  const screenOut = Buffer.alloc(width * height * 4, 0);
  const multiOut  = Buffer.alloc(width * height * 4, 255);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!inQuad(x, y, quad)) continue;
      // Non-surface pixels → stay neutral (no lighting transfer for bg/fingers)
      if (maskData) {
        const mi = ((y - minY) * outW + (x - minX)) * maskCh;
        if (maskData[mi] < 128) continue;
      }
      const src = (y * width + x) * channels;
      const dst = (y * width + x) * 4;
      const raw = Math.round(0.299 * data[src] + 0.587 * data[src + 1] + 0.114 * data[src + 2]);
      const gray = Math.min(255, Math.round((raw / whiteRef) * 255));
      // Screen uses the full normalized gray (brighter = more light — correct for screen blend)
      screenOut[dst] = gray; screenOut[dst + 1] = gray; screenOut[dst + 2] = gray; screenOut[dst + 3] = 255;
      // Multiply floor: physical imperfections (stains, tape) have very low gray but are not
      // real shadows. Clamping prevents them from darkening art while keeping real gradients.
      const mGray = multiplyFloor > 0 ? Math.max(multiplyFloor, gray) : gray;
      multiOut[dst]  = mGray; multiOut[dst + 1] = mGray; multiOut[dst + 2] = mGray; multiOut[dst + 3]  = 255;
    }
  }

  // Blur smooths residual pointwise artifacts without affecting broad lighting gradients.
  // Sigma=3 ≈ 2px effective radius — safe for both small cards and large billboards.
  const [screen, multiply] = await Promise.all([
    sharp(screenOut, { raw: { width, height, channels: 4 } }).blur(3).png().toBuffer(),
    sharp(multiOut,  { raw: { width, height, channels: 4 } }).blur(3).png().toBuffer(),
  ]);

  return { screen, multiply };
}

/**
 * Quad mask cropped to the bounding box of the quad. The polygon edge is
 * anti-aliased via 4×4 supersampling (coverage AA) — no stair-stepping, even at
 * feather 0. Optional `featherPx` blur softens further.
 */
export async function extractMask(
  width: number,
  height: number,
  quad: QuadPoints,
  featherPx = 3
): Promise<Buffer> {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const outW = maxX - minX + 1;
  const outH = maxY - minY + 1;

  const out = Buffer.alloc(outW * outH * 4, 0);
  const SS = 4;                 // supersample grid per axis → 16 samples/pixel
  const inv = 1 / SS;
  const norm = 255 / (SS * SS);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) {
        const py = y + (sy + 0.5) * inv - 0.5;
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) * inv - 0.5;
          if (inQuad(px, py, quad)) cov++;
        }
      }
      if (cov === 0) continue;
      const a = Math.round(cov * norm);
      const i = ((y - minY) * outW + (x - minX)) * 4;
      out[i] = a; out[i + 1] = a; out[i + 2] = a; out[i + 3] = a;
    }
  }

  const raw = sharp(out, { raw: { width: outW, height: outH, channels: 4 } });
  if (featherPx > 0) return raw.blur(featherPx).png().toBuffer();
  return raw.png().toBuffer();
}

/**
 * Detect where the magenta surface *reflected* into the scene (wet floor, glass):
 * low-saturation pixels in the magenta hue band, OUTSIDE the surface quad.
 * Returns a full-image white-on-transparent mask (soft) — the reflection map for the
 * "reflexo" render effect. Hue-banded so reds/oranges (warm light, signs) are ignored.
 */
export async function extractReflectionMask(
  photoPath: string | Buffer,
  quad: QuadPoints,
  width: number,
  height: number,
  opts: { hueCenter?: number; hueRange?: number; satLo?: number; satHi?: number } = {},
): Promise<Buffer> {
  const { hueCenter = 300, hueRange = 55, satLo = 0.04, satHi = 0.6 } = opts;
  const { data } = await sharp(photoPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(width * height * 4, 0);
  const lo = (hueCenter - hueRange + 360) % 360;
  const hi = (hueCenter + hueRange) % 360;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inQuad(x, y, quad)) continue; // reflections live outside the surface
      const i = (y * width + x) * 4;
      const [h, s] = rgbToHslShadow(data[i], data[i + 1], data[i + 2]);
      const hue = h * 360;
      const inBand = lo <= hi ? hue >= lo && hue <= hi : hue >= lo || hue <= hi;
      if (inBand && s >= satLo && s <= satHi) {
        out[i] = out[i + 1] = out[i + 2] = 255; out[i + 3] = 255;
      }
    }
  }
  // Soft-blur + small dilation so the reflection field is continuous, not speckled.
  return sharp(out, { raw: { width, height, channels: 4 } }).blur(6).png().toBuffer();
}

/**
 * Compute average lightness and variance for pixels inside the quad.
 * Used to detect pure-white blank surfaces before wasting a render.
 * avgLightness > 0.93 + variance < 0.005 = flat blank (no lighting info) → skip.
 */
export async function computeQuadSurfaceStats(
  photoPath: string | Buffer,
  width: number,
  height: number,
  quad: QuadPoints,
): Promise<{ avgLightness: number; variance: number }> {
  const { data } = await sharp(photoPath).raw().toBuffer({ resolveWithObject: true });
  const ch = 3;
  const grays: number[] = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (!inQuad(x, y, quad)) continue;
      const i = (y * width + x) * ch;
      grays.push((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255);
    }
  }
  if (grays.length === 0) return { avgLightness: 0, variance: 0 };
  const avg = grays.reduce((a, b) => a + b, 0) / grays.length;
  const variance = grays.reduce((a, b) => a + (b - avg) ** 2, 0) / grays.length;
  return { avgLightness: avg, variance };
}

/**
 * Paint the detected quad polygon with flat neon magenta (#FF00FF).
 * Converts any detected white/blank surface into a neon surface so it flows
 * through the unified neon CV path (zero LLM, perspective-accurate corners).
 * Returns a full-image PNG buffer with the quad area replaced by magenta.
 */
export async function paintQuadMagenta(
  photoPath: string | Buffer,
  width: number,
  height: number,
  quad: QuadPoints,
): Promise<Buffer> {
  const { data } = await sharp(photoPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  const ch = 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inQuad(x, y, quad)) continue;
      const i = (y * width + x) * ch;
      out[i] = 255; out[i + 1] = 0; out[i + 2] = 255; out[i + 3] = 255;
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Extract a grayscale displacement / depth proxy from the photo inside the quad.
 * Bright pixels = raised/lit surface, dark = recessed/shadowed.
 * Pre-blur smooths fine texture noise so only macro surface geometry survives.
 * Output: full-image PNG, black outside the quad, normalized 0-255 inside.
 * Feed as displacement map input to the PSD engine to warp art to match contours.
 */
export async function extractDisplacementMap(
  photoPath: string | Buffer,
  width: number,
  height: number,
  quad: QuadPoints,
  preBlur = 8,
): Promise<Buffer> {
  let src = sharp(photoPath);
  if (preBlur > 0) src = src.blur(preBlur);
  const { data } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = 4;
  const out = Buffer.alloc(width * height * 4, 0);

  const grays: number[] = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (!inQuad(x, y, quad)) continue;
      const i = (y * width + x) * ch;
      grays.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
  }
  if (grays.length === 0) return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();

  const sorted = Float32Array.from(grays).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = Math.max(lo + 1, sorted[Math.floor(sorted.length * 0.98)]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inQuad(x, y, quad)) continue;
      const s = (y * width + x) * ch;
      const d = (y * width + x) * 4;
      const raw = 0.299 * data[s] + 0.587 * data[s + 1] + 0.114 * data[s + 2];
      const g = Math.min(255, Math.max(0, Math.round(((raw - lo) / (hi - lo)) * 255)));
      out[d] = out[d + 1] = out[d + 2] = g; out[d + 3] = 255;
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Extract the scene's color cast from midtone pixels inside the quad.
 * Returns a full-image PNG: quad area = avg scene color (RGB), black outside.
 *
 * Use as a "screen" overlay at 10-12% opacity so the art absorbs the
 * scene's ambient light color (warm golden hour, cool office fluorescent, etc.).
 * Black outside the quad is neutral for screen blend → no effect on the background.
 *
 * Only midtones (lum 40-200) are sampled: highlights are washed-out (no color info)
 * and shadows are too dark. Midtones carry the scene's actual light color.
 */
export async function extractColorCastLayer(
  photoPath: string | Buffer,
  width: number,
  height: number,
  quad: QuadPoints,
  sampleStep = 6,
): Promise<Buffer> {
  const { data } = await sharp(photoPath).raw().toBuffer({ resolveWithObject: true });
  const ch = 3;

  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      if (!inQuad(x, y, quad)) continue;
      const i = (y * width + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 40 || lum > 200) continue;  // skip highlights + deep shadows
      sumR += r; sumG += g; sumB += b; n++;
    }
  }

  // Fallback to neutral gray if too few midtone pixels
  const cr = n > 10 ? Math.round(sumR / n) : 128;
  const cg = n > 10 ? Math.round(sumG / n) : 128;
  const cb = n > 10 ? Math.round(sumB / n) : 128;

  // Full-image buffer: quad area = cast color (opaque), outside = black (neutral for screen)
  const out = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inQuad(x, y, quad)) continue;
      const i = (y * width + x) * 4;
      out[i] = cr; out[i + 1] = cg; out[i + 2] = cb; out[i + 3] = 255;
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Extract foreground occluder mask: pixels inside the quad that are NOT neon-magenta.
 * These are objects (plants, people, furniture) that were in front of the surface.
 * Returns a full W×H RGBA image — non-magenta in-quad pixels are opaque, rest transparent.
 * Composite this on top of the final render to restore depth.
 */
export async function extractOccluder(photoPath: string, quad: QuadPoints): Promise<Buffer | null> {
  const { data, info } = await sharp(photoPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const ch = 4;

  function isMagenta(r: number, g: number, b: number): boolean {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === 0 || max - min < 60) return false;
    const hue = max === r ? ((g - b) / (max - min) * 60 + 360) % 360
              : max === g ? (b - r) / (max - min) * 60 + 120
              : (r - g) / (max - min) * 60 + 240;
    return hue >= 275 && hue <= 345 && (max - min) / max > 0.45 && max > 100;
  }

  const out = Buffer.alloc(width * height * ch, 0);
  let hasOccluder = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inQuad(x, y, quad)) continue;
      const i = (y * width + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (!isMagenta(r, g, b)) {
        out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
        hasOccluder = true;
      }
    }
  }

  if (!hasOccluder) return null;
  return sharp(out, { raw: { width, height, channels: ch } }).png().toBuffer();
}

/**
 * Replace neon-magenta pixels with the ambient background color sampled from
 * the image border. Runs two dilation passes after the core scan to catch
 * antialiased fringe pixels at the quad edge.
 */
export async function cleanMagentaMarker(photoPath: string): Promise<Buffer> {
  const { data, info } = await sharp(photoPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const ch = 4;

  // Core magenta: H ≈ 265–355°, loosened thresholds to catch dark/antialiased variants
  function isMagenta(r: number, g: number, b: number): boolean {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === 0 || max - min < 40) return false;
    const hue = max === r ? ((g - b) / (max - min) * 60 + 360) % 360
               : max === g ? (b - r) / (max - min) * 60 + 120
               : (r - g) / (max - min) * 60 + 240;
    const sat = (max - min) / max;
    return hue >= 265 && hue <= 355 && sat > 0.30 && max > 70;
  }

  // Soft fringe: partially blended magenta at antialiased edges (r+b > g, pink bias)
  function isFringe(r: number, g: number, b: number): boolean {
    if (Math.max(r, g, b) < 60) return false;
    return r > g + 15 && b > g + 8 && r > 70;
  }

  // Sample background from outermost 30px border (skip magenta pixels)
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  const border = 30;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= border && x < width - border && y >= border && y < height - border) continue;
      const i = (y * width + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isMagenta(r, g, b)) continue;
      sumR += r; sumG += g; sumB += b; count++;
    }
  }
  const bgR = count > 0 ? Math.round(sumR / count) : 220;
  const bgG = count > 0 ? Math.round(sumG / count) : 220;
  const bgB = count > 0 ? Math.round(sumB / count) : 220;

  const out = Buffer.from(data);
  const cleaned = new Uint8Array(width * height);

  // Pass 1: replace core magenta pixels
  for (let i = 0; i < width * height; i++) {
    const base = i * ch;
    if (isMagenta(out[base], out[base + 1], out[base + 2])) {
      out[base] = bgR; out[base + 1] = bgG; out[base + 2] = bgB;
      cleaned[i] = 1;
    }
  }

  // Passes 2–3: dilate cleaned region by 1px each pass, targeting fringe pixels only
  for (let pass = 0; pass < 2; pass++) {
    const prev = Uint8Array.from(cleaned);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (cleaned[idx]) continue;
        const hasNeighbor = prev[idx - 1] || prev[idx + 1] || prev[idx - width] || prev[idx + width];
        if (!hasNeighbor) continue;
        const base = idx * ch;
        if (isMagenta(out[base], out[base + 1], out[base + 2]) || isFringe(out[base], out[base + 1], out[base + 2])) {
          out[base] = bgR; out[base + 1] = bgG; out[base + 2] = bgB;
          cleaned[idx] = 1;
        }
      }
    }
  }

  return sharp(out, { raw: { width, height, channels: ch } }).png().toBuffer();
}

// Keep old exports for backward compat with API routes
export { extractGrayscaleLayers as extractShadowMap };
export async function extractHighlightMap(): Promise<Buffer> {
  return Buffer.alloc(0);
}
