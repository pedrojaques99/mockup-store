/**
 * CV-based surface detection — finds the largest white/light low-saturation
 * region in a photo using HSL thresholding + row/column projection scanning.
 *
 * Designed for mockup surfaces: white cards, posters, walls, billboards.
 * No LLM, no native deps — pure sharp + JS pixel analysis.
 *
 * Key insight for masking: use the actual HSL-threshold pixels as the composite
 * mask (not a filled rectangle). This lets fingers occlude art naturally.
 */
import sharp from "sharp";
import type { QuadPoints } from "./photo-analyze";

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

export interface SurfaceDetectionResult {
  quad: QuadPoints;
  /** Row coverage fraction at each Y — useful for quality assessment. */
  rowCoverage: Float32Array;
  /** Average surface lightness inside the quad. */
  avgLightness: number;
  /** Confidence 0-1 based on how cleanly the surface separates from surroundings. */
  confidence: number;
}

export interface DetectionOptions {
  /** Minimum HSL lightness to qualify as surface. Default 0.68. */
  minLightness?: number;
  /** Maximum HSL saturation to qualify as surface. Default 0.18. */
  maxSaturation?: number;
  /** Minimum fraction of qualifying pixels in a row/col to count that row/col. Default 0.20. */
  minRowFraction?: number;
  /** Sample every N pixels (for speed). Default 3. */
  sampleStep?: number;
  /** Minimum qualifying rows as fraction of image height. Default 0.05. */
  minHeightFraction?: number;
}

/**
 * BFS connected-component filter: returns only the pixels belonging to the
 * largest 8-connected blob. Eliminates glow halos and reflected neon pixels
 * that contaminate extremal-point corner extraction.
 *
 * Runs on a downsampled grid (step=4) for speed, then maps back to original pts.
 */
function largestConnectedBlob(
  pts: Array<[number, number]>,
  width: number,
  height: number,
  step = 4,
): Array<[number, number]> {
  if (pts.length === 0) return pts;

  const gw = Math.ceil(width / step);
  const gh = Math.ceil(height / step);
  const grid = new Uint8Array(gw * gh);
  for (const [x, y] of pts) grid[(y / step | 0) * gw + (x / step | 0)] = 1;

  const visited = new Uint8Array(gw * gh);
  let bestBbox = { x0: 0, y0: 0, x1: 0, y1: 0, size: 0 };

  for (let gi = 0; gi < gw * gh; gi++) {
    if (!grid[gi] || visited[gi]) continue;

    const queue: number[] = [gi];
    visited[gi] = 1;
    let size = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0;

    while (queue.length > 0) {
      const idx = queue.pop()!;
      const cx = idx % gw, cy = idx / gw | 0;
      size++;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
          const ni = ny * gw + nx;
          if (!visited[ni] && grid[ni]) { visited[ni] = 1; queue.push(ni); }
        }
      }
    }

    if (size > bestBbox.size) bestBbox = { x0, y0, x1, y1, size };
  }

  // Expand bbox back to original pixel coords (+1 step margin on each side)
  const margin = step;
  const px0 = Math.max(0, bestBbox.x0 * step - margin);
  const py0 = Math.max(0, bestBbox.y0 * step - margin);
  const px1 = Math.min(width - 1,  (bestBbox.x1 + 1) * step + margin);
  const py1 = Math.min(height - 1, (bestBbox.y1 + 1) * step + margin);

  return pts.filter(([x, y]) => x >= px0 && x <= px1 && y >= py0 && y <= py1);
}

/**
 * Scans vivid pixels in a hue range (pink/magenta/purple by default) and returns
 * the dominant hue in degrees via saturation-weighted histogram peak.
 *
 * Use before findNeonQuad / neutralizeNeonPixels to auto-detect whatever shade
 * the LLM actually generated (fuchsia, hot-pink, violet-magenta, etc.).
 * Returns null if no concentrated vivid cluster found.
 */
export async function detectDominantVividHue(
  imagePath: string | Buffer,
  width: number,
  height: number,
  hueMin = 220,   // degrees: start of search range
  hueMax = 360,   // degrees: end of search range (220-360 = purple→pink→red-pink)
  minSat = 0.40,  // min HSL saturation to count
  step   = 4,     // pixel sampling step (speed vs accuracy)
): Promise<number | null> {
  const raw = await sharp(imagePath as any).raw().toBuffer();
  const ch  = 3;

  // Saturation-weighted histogram with 1°-degree bins
  const bins = new Float64Array(360);
  const hLoN = hueMin / 360;
  const hHiN = hueMax / 360;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * ch;
      const [h, s] = rgbToHsl(raw[i], raw[i + 1], raw[i + 2]);
      const inRange = hLoN <= hHiN
        ? h >= hLoN && h <= hHiN
        : h >= hLoN || h <= hHiN;
      if (inRange && s >= minSat) bins[Math.round(h * 359)] += s;
    }
  }

  // Smooth bins with ±5° window to bridge aliasing gaps
  const smoothed = new Float64Array(360);
  for (let i = 0; i < 360; i++) {
    for (let d = -5; d <= 5; d++) smoothed[i] += bins[(i + d + 360) % 360];
  }

  // Find peak within the search range
  let maxVal = 0, peakDeg = -1;
  const lo = Math.round(hueMin), hi = Math.round(hueMax);
  for (let i = lo; i <= hi; i++) {
    const deg = i % 360;
    if (smoothed[deg] > maxVal) { maxVal = smoothed[deg]; peakDeg = deg; }
  }

  // Require meaningful signal — at least a handful of vivid pixels at this step size
  return maxVal > 2 ? peakDeg : null;
}

/**
 * Detects a neon-colored surface and returns its exact quad corners via
 * convex-hull corner extraction.
 *
 * hueCenter defaults to auto-detect (detectDominantVividHue in H=220-360° range)
 * so it works with any LLM-generated shade: magenta, hot-pink, fuchsia, violet-pink.
 *
 * Use when generating blank mockup images with a neon key color instead of white:
 *   - Auto-detects dominant vivid hue → no hardcoded 300° needed
 *   - Connected-component filter removes glow halos and reflected neon pixels
 *   - Exact corner extraction gives perspective-accurate trapezoid quad
 *
 * Returns null if fewer than minPixels neon pixels found.
 */
export async function findNeonQuad(
  imagePath: string,
  width: number,
  height: number,
  hueCenter?: number,  // auto-detect dominant vivid hue when undefined
  hueRange  = 40,      // ±degrees around detected/provided hueCenter
  minSat    = 0.45,
  minPixels = 500,
): Promise<QuadPoints | null> {
  // Auto-detect dominant vivid hue if not specified
  if (hueCenter === undefined) {
    const detected = await detectDominantVividHue(imagePath, width, height);
    if (detected === null) return null;
    hueCenter = detected;
    console.log(`    🎨 Auto-detected vivid hue: ${hueCenter}° (H=${Math.round(hueCenter - hueRange)}-${Math.round(hueCenter + hueRange)}°)`);
  }

  const raw = await sharp(imagePath).raw().toBuffer();
  const ch  = 3; // sharp outputs RGB
  const pts: Array<[number, number]> = [];

  const hLo = ((hueCenter - hueRange + 360) % 360) / 360;
  const hHi = ((hueCenter + hueRange      ) % 360) / 360;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * ch;
      const [h, s] = rgbToHsl(raw[i], raw[i + 1], raw[i + 2]);
      const hMatch = hLo <= hHi
        ? h >= hLo && h <= hHi
        : h >= hLo || h <= hHi; // wraps around 0/1
      if (hMatch && s >= minSat) pts.push([x, y]);
    }
  }

  if (pts.length < minPixels) return null;

  // Keep only the largest contiguous neon blob — eliminates glow/reflections
  const filtered = largestConnectedBlob(pts, width, height);
  if (filtered.length < minPixels) return null;

  // Extract the 4 "corner" points from the convex hull extremes:
  //   TL = min(x+y),  TR = max(x-y),  BR = max(x+y),  BL = min(x-y)
  // This correctly handles tilted rectangles / trapezoids.
  let tl = filtered[0], tr = filtered[0], br = filtered[0], bl = filtered[0];
  for (const [x, y] of filtered) {
    if (x + y < tl[0] + tl[1]) tl = [x, y];
    if (x - y > tr[0] - tr[1]) tr = [x, y];
    if (x + y > br[0] + br[1]) br = [x, y];
    if (x - y < bl[0] - bl[1]) bl = [x, y];
  }

  return {
    tl: { x: tl[0], y: tl[1] },
    tr: { x: tr[0], y: tr[1] },
    br: { x: br[0], y: br[1] },
    bl: { x: bl[0], y: bl[1] },
  };
}

export async function detectWhiteSurface(
  imagePath: string,
  width: number,
  height: number,
  opts: DetectionOptions = {}
): Promise<SurfaceDetectionResult | null> {
  const {
    minLightness = 0.68,
    maxSaturation = 0.18,
    minRowFraction = 0.20,
    sampleStep = 3,
    minHeightFraction = 0.05,
  } = opts;

  const { data } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ch = 4; // RGBA channels

  // Per-row: fraction of pixels that qualify as "white surface"
  const rowCoverage = new Float32Array(height);
  // Per-row: min and max X of qualifying pixels
  const rowMinX = new Int32Array(height).fill(width);
  const rowMaxX = new Int32Array(height).fill(-1);

  let lightnessSum = 0, lightnessCount = 0;

  for (let y = 0; y < height; y += sampleStep) {
    let qualified = 0, total = 0;
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * ch;
      const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      total++;
      if (l >= minLightness && s <= maxSaturation) {
        qualified++;
        if (x < rowMinX[y]) rowMinX[y] = x;
        if (x > rowMaxX[y]) rowMaxX[y] = x;
        lightnessSum += l;
        lightnessCount++;
      }
    }
    rowCoverage[y] = total > 0 ? qualified / total : 0;
  }

  // Interpolate non-sampled rows
  for (let y = 0; y < height; y++) {
    if (y % sampleStep !== 0) {
      const yBase = Math.floor(y / sampleStep) * sampleStep;
      rowCoverage[y] = rowCoverage[yBase];
      rowMinX[y] = rowMinX[yBase];
      rowMaxX[y] = rowMaxX[yBase];
    }
  }

  // Find Y range where row coverage exceeds threshold
  let topY = -1, bottomY = -1;
  for (let y = 0; y < height; y++) {
    if (rowCoverage[y] >= minRowFraction) {
      if (topY === -1) topY = y;
      bottomY = y;
    }
  }

  if (topY === -1 || (bottomY - topY) < height * minHeightFraction) {
    return null; // No significant surface found
  }

  // Within the Y range, find the global X extent
  let minX = width, maxX = 0;
  for (let y = topY; y <= bottomY; y++) {
    if (rowCoverage[y] >= minRowFraction && rowMaxX[y] >= 0) {
      if (rowMinX[y] < minX) minX = rowMinX[y];
      if (rowMaxX[y] > maxX) maxX = rowMaxX[y];
    }
  }

  if (maxX <= minX) return null;

  // Use a slightly tighter X range based on the P5/P95 of row extents (robust to outliers)
  const leftExtents: number[] = [], rightExtents: number[] = [];
  for (let y = topY; y <= bottomY; y++) {
    if (rowCoverage[y] >= minRowFraction && rowMaxX[y] >= 0) {
      leftExtents.push(rowMinX[y]);
      rightExtents.push(rowMaxX[y]);
    }
  }
  leftExtents.sort((a, b) => a - b);
  rightExtents.sort((a, b) => a - b);

  const p05 = (arr: number[]) => arr[Math.floor(arr.length * 0.05)] ?? arr[0];
  const p95 = (arr: number[]) => arr[Math.floor(arr.length * 0.95)] ?? arr[arr.length - 1];

  // Use p05/p95 to exclude outlier-driven extremes, but keep the full extent visible
  // We take p10 on left (trim 10% narrowest rows) and p90 on right
  const robustMinX = p05(leftExtents);
  const robustMaxX = p95(rightExtents);

  const quad: QuadPoints = {
    tl: { x: robustMinX, y: topY },
    tr: { x: robustMaxX, y: topY },
    br: { x: robustMaxX, y: bottomY },
    bl: { x: robustMinX, y: bottomY },
  };

  // Confidence: ratio of qualifying pixels in the detected region
  const avgL = lightnessCount > 0 ? lightnessSum / lightnessCount : 0;
  const regionArea = (robustMaxX - robustMinX) * (bottomY - topY);
  const imageArea = width * height;
  const confidence = Math.min(1, (regionArea / imageArea) * 5); // 0-1 scale

  return { quad, rowCoverage, avgLightness: avgL, confidence };
}

/**
 * Auto-detect surface and return SurfaceAnalysis-compatible result.
 * Uses heuristics to infer surfaceType from detected dimensions.
 */
export async function autoDetectSurface(
  imagePath: string,
  width: number,
  height: number,
  opts: DetectionOptions = {}
): Promise<{
  quad: QuadPoints;
  surfaceType: string;
  material: string;
  hasOcclusion: boolean;
  occlusionDesc: string;
  lightingDir: string;
  confidence: number;
  avgLightness: number;
  imageWidth: number;
  imageHeight: number;
} | null> {
  const result = await detectWhiteSurface(imagePath, width, height, opts);
  if (!result) return null;

  const { quad, confidence, avgLightness } = result;
  const detW = quad.tr.x - quad.tl.x;
  const detH = quad.bl.y - quad.tl.y;
  const aspect = detW / detH;
  const areaPct = (detW * detH) / (width * height);

  // Infer surface type from geometry
  let surfaceType = "other";
  if (aspect >= 2.5 && detH < height * 0.35) {
    surfaceType = "card"; // Landscape card: very wide, not too tall
  } else if (areaPct > 0.30 && detW > width * 0.6) {
    surfaceType = "wall"; // Large area spanning most of width
  } else if (aspect >= 1.2 && aspect <= 3.0 && areaPct > 0.05) {
    surfaceType = "poster"; // Medium-sized landscape rectangle
  }

  const material = avgLightness > 0.85 ? "matte" : "matte";

  return {
    quad,
    surfaceType,
    material,
    hasOcclusion: false,
    occlusionDesc: "",
    lightingDir: "ambient",
    confidence: Math.round(confidence * 100) / 100,
    avgLightness,
    imageWidth: width,
    imageHeight: height,
  };
}

/**
 * Pixel-level surface mask — the actual HSL-qualifying pixels, not a filled rect.
 *
 * Why this is better than a filled-rectangle mask:
 * - For cards held in hand: fingers naturally occlude the art (they're excluded from mask)
 * - For walls with objects in front: objects stay visible over the art
 * - The quad is still used for perspective-warp, but the MASK shows the true surface
 *
 * Optionally dilates the mask to fill small gaps (e.g., thin finger shadows over card).
 * Pass dilateR=0 for pure threshold (no gap filling).
 */
export async function extractSurfaceMaskCV(
  imagePath: string,
  width: number,
  height: number,
  quad: QuadPoints,
  opts: DetectionOptions = {},
  featherPx = 3,
  dilateR = 0,
  /** Fill enclosed holes ≤ this area (px²) after BFS. 0 = disabled.
   *  Fills interior spots/fixtures while skipping large objects (people, cars). */
  fillHolesMaxArea = 0,
  /** Minimum hole area (px²) to fill. Holes smaller than this are skipped.
   *  Use to avoid filling motion-blur fragments (e.g. person = 470 blobs ≤ 500px²)
   *  while still filling real fixture spots (e.g. 4680px²). Default 0 = no minimum. */
  fillHolesMinArea = 0
): Promise<Buffer> {
  const {
    minLightness = 0.68,
    maxSaturation = 0.18,
    sampleStep = 1,
  } = opts;

  const { data } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ch = 4;

  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const outW = maxX - minX + 1;
  const outH = maxY - minY + 1;

  // Build binary mask in bounding-box local coordinates
  const raw = Buffer.alloc(outW * outH, 0);

  for (let y = minY; y <= maxY; y += sampleStep) {
    for (let x = minX; x <= maxX; x += sampleStep) {
      const i = (y * width + x) * ch;
      const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (l >= minLightness && s <= maxSaturation) {
        // Fill sampleStep×sampleStep block
        for (let dy = 0; dy < sampleStep && y + dy <= maxY; dy++) {
          for (let dx = 0; dx < sampleStep && x + dx <= maxX; dx++) {
            raw[(y - minY + dy) * outW + (x - minX + dx)] = 255;
          }
        }
      }
    }
  }

  // Largest-region filter: keep only the biggest contiguous white blob.
  // This removes stray white pixels (ceiling lights, reflections) that would
  // bleed art onto unintended areas. Simple 4-connected flood-fill BFS.
  const visited = new Uint8Array(outW * outH);
  let bestStart = -1, bestSize = 0;
  const stack: number[] = [];
  for (let i = 0; i < outW * outH; i++) {
    if (raw[i] === 255 && !visited[i]) {
      stack.length = 0;
      stack.push(i);
      visited[i] = 1;
      let size = 0;
      while (stack.length > 0) {
        const idx = stack.pop()!;
        size++;
        const x = idx % outW, y = (idx - x) / outW;
        const neighbors = [
          y > 0 ? idx - outW : -1,
          y < outH - 1 ? idx + outW : -1,
          x > 0 ? idx - 1 : -1,
          x < outW - 1 ? idx + 1 : -1,
        ];
        for (const n of neighbors) {
          if (n >= 0 && raw[n] === 255 && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
        }
      }
      if (size > bestSize) { bestSize = size; bestStart = i; }
    }
  }
  // Zero out everything except the largest region
  if (bestStart >= 0) {
    const keep = new Uint8Array(outW * outH);
    stack.length = 0;
    stack.push(bestStart);
    keep[bestStart] = 1;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % outW, y = (idx - x) / outW;
      const neighbors = [
        y > 0 ? idx - outW : -1,
        y < outH - 1 ? idx + outW : -1,
        x > 0 ? idx - 1 : -1,
        x < outW - 1 ? idx + 1 : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && raw[n] === 255 && !keep[n]) { keep[n] = 1; stack.push(n); }
      }
    }
    for (let i = 0; i < outW * outH; i++) {
      if (!keep[i]) raw[i] = 0;
    }
  }

  // Fill enclosed holes ≤ fillHolesMaxArea px²: BFS from all 4 edges marks background.
  // Then find enclosed black regions. Fill only those smaller than the threshold.
  // This closes interior fixture spots while leaving large objects (people) intact.
  if (fillHolesMaxArea > 0) {
    const bg = new Uint8Array(outW * outH);
    const bgStack: number[] = [];
    for (let x = 0; x < outW; x++) {
      if (raw[x] === 0 && !bg[x]) { bg[x] = 1; bgStack.push(x); }
      const bot = (outH - 1) * outW + x;
      if (raw[bot] === 0 && !bg[bot]) { bg[bot] = 1; bgStack.push(bot); }
    }
    for (let y = 1; y < outH - 1; y++) {
      const l = y * outW, r = y * outW + outW - 1;
      if (raw[l] === 0 && !bg[l]) { bg[l] = 1; bgStack.push(l); }
      if (raw[r] === 0 && !bg[r]) { bg[r] = 1; bgStack.push(r); }
    }
    while (bgStack.length > 0) {
      const idx = bgStack.pop()!;
      const x = idx % outW, y = (idx - x) / outW;
      const nbrs = [
        y > 0 ? idx - outW : -1,
        y < outH - 1 ? idx + outW : -1,
        x > 0 ? idx - 1 : -1,
        x < outW - 1 ? idx + 1 : -1,
      ];
      for (const n of nbrs) {
        if (n >= 0 && raw[n] === 0 && !bg[n]) { bg[n] = 1; bgStack.push(n); }
      }
    }
    // Find enclosed (non-background) black blobs, fill only if area ≤ threshold
    const holeVisited = new Uint8Array(outW * outH);
    for (let seed = 0; seed < outW * outH; seed++) {
      if (raw[seed] !== 0 || bg[seed] || holeVisited[seed]) continue;
      const region: number[] = [];
      const hs: number[] = [seed];
      holeVisited[seed] = 1;
      while (hs.length > 0) {
        const idx = hs.pop()!;
        region.push(idx);
        const x = idx % outW, y = (idx - x) / outW;
        const nbrs = [
          y > 0 ? idx - outW : -1,
          y < outH - 1 ? idx + outW : -1,
          x > 0 ? idx - 1 : -1,
          x < outW - 1 ? idx + 1 : -1,
        ];
        for (const n of nbrs) {
          if (n >= 0 && raw[n] === 0 && !bg[n] && !holeVisited[n]) {
            holeVisited[n] = 1; hs.push(n);
          }
        }
      }
      if (region.length <= fillHolesMaxArea && (fillHolesMinArea === 0 || region.length >= fillHolesMinArea)) {
        for (const idx of region) raw[idx] = 255;
      }
    }
  }

  // Encode mask value in ALL four channels (RGB + alpha).
  // - applyMaskToFace (renderScene) uses destination-in → reads ALPHA channel
  // - extractGrayscaleLayers checks pixel inclusion → reads R channel (maskData[mi])
  // Both consumers work correctly when mask value is in all channels.
  const dilateBlur = dilateR > 0 ? dilateR : 0;
  const rgba = Buffer.alloc(outW * outH * 4, 0);
  for (let i = 0; i < outW * outH; i++) {
    rgba[i * 4] = raw[i];     // R = mask value (for pixel-access code)
    rgba[i * 4 + 1] = raw[i]; // G
    rgba[i * 4 + 2] = raw[i]; // B
    rgba[i * 4 + 3] = raw[i]; // A = mask value (for destination-in composite)
  }

  let sharpImg = sharp(rgba, { raw: { width: outW, height: outH, channels: 4 } });

  if (dilateBlur > 0) {
    // Blur then re-threshold at 30% to simulate morphological dilation
    const blurred = await sharpImg.blur(dilateBlur).raw().toBuffer();
    for (let i = 0; i < outW * outH; i++) {
      const v = blurred[i * 4]; // R channel after blur
      const m = v > 76 ? 255 : 0;
      blurred[i * 4] = m;
      blurred[i * 4 + 1] = m;
      blurred[i * 4 + 2] = m;
      blurred[i * 4 + 3] = m; // alpha = same as RGB
    }
    sharpImg = sharp(blurred, { raw: { width: outW, height: outH, channels: 4 } });
  }

  if (featherPx > 0) {
    return sharpImg.blur(featherPx).png().toBuffer();
  }
  return sharpImg.png().toBuffer();
}

/**
 * Card mask via foreground subtraction.
 *
 * Starts with a filled white rectangle (entire card quad), then punches holes
 * where pixels are clearly NOT the card surface (dark clothing, skin/fingers).
 * This lets fingers appear over the composited art — far more realistic than
 * either a filled rect (fingers hidden) or additive pixel mask (too sparse).
 *
 * Why not additive mask for cards: the hand covers ~80% of the card area, so
 * the additive HSL approach finds only the top 20% of card pixels. Dilation
 * of 270px would be needed to fill the rest — impractical.
 *
 * @param nonCardL  max lightness to classify as "non-card" (dark bg). Default 0.42
 * @param nonCardS  min saturation to classify as "non-card" (skin). Default 0.22
 * @param dilateR   blur radius for eroding the punched holes (smooths finger edges). Default 8
 */
export async function extractCardMaskCV(
  imagePath: string,
  width: number,
  height: number,
  quad: QuadPoints,
  featherPx = 3,
  nonCardL = 0.42,
  nonCardS = 0.22,
  dilateR = 8
): Promise<Buffer> {
  const { data } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ch = 4;

  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const outW = maxX - minX + 1;
  const outH = maxY - minY + 1;

  // Start all-white (filled card quad)
  const raw = Buffer.alloc(outW * outH, 255);

  // Punch holes where pixel is clearly non-card: dark OR saturated/skin
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = (y * width + x) * ch;
      const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const isNonCard = l < nonCardL || (s > nonCardS && l < 0.78);
      if (isNonCard) {
        raw[(y - minY) * outW + (x - minX)] = 0;
      }
    }
  }

  // Expand the holes slightly via erosion (blur + low threshold) to avoid
  // sharp finger-edge halos. Then feather the outer card edge.
  // Alpha = mask value (same as RGB) so destination-in in renderScene works correctly.
  const rgba = Buffer.alloc(outW * outH * 4, 0);
  for (let i = 0; i < outW * outH; i++) {
    rgba[i * 4] = raw[i];
    rgba[i * 4 + 1] = raw[i];
    rgba[i * 4 + 2] = raw[i];
    rgba[i * 4 + 3] = raw[i]; // alpha = mask value
  }

  // Blur then re-threshold at 50% → keeps card area solid, erodes finger holes outward
  const blurred = await sharp(rgba, { raw: { width: outW, height: outH, channels: 4 } })
    .blur(dilateR)
    .raw()
    .toBuffer();
  for (let i = 0; i < outW * outH; i++) {
    const v = blurred[i * 4];
    const m = v > 128 ? 255 : 0;
    blurred[i * 4] = m;
    blurred[i * 4 + 1] = m;
    blurred[i * 4 + 2] = m;
    blurred[i * 4 + 3] = m; // alpha = mask value
  }

  const result = sharp(blurred, { raw: { width: outW, height: outH, channels: 4 } });
  if (featherPx > 0) {
    return result.blur(featherPx).png().toBuffer();
  }
  return result.png().toBuffer();
}
