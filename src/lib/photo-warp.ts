/**
 * Synthetic displacement maps for curved-surface warps (cylinder + edge bend).
 * Fed to the psd-engine's existing `dispRef`/`dispScale` path — no engine changes.
 * Encoding (Photoshop-style, matches compose.ts): R = horizontal, G = vertical,
 * neutral = 128, displacement = ((channel-128)/128) * dispScale (px).
 */
import sharp from "sharp";

export interface WarpOptions {
  /** Horizontal cylinder amount 0..1 (label wrap around a vertical axis). */
  cylinder?: number;
  /** Per-edge bow, fraction of the surface size (−0.3..0.3). + = bow outward. */
  bendTop?: number;
  bendBottom?: number;
  bendLeft?: number;
  bendRight?: number;
}

const MAP = 256; // map resolution (engine stretches to fit the face)

export function hasWarp(o: WarpOptions): boolean {
  return !!((o.cylinder ?? 0) || o.bendTop || o.bendBottom || o.bendLeft || o.bendRight);
}

/**
 * Surface-relief displacement from the photo itself (wrinkles, folds, texture).
 * High-passes the surface luminance (removes lighting, keeps relief) → per-texel px
 * offset, applied diagonally (PS garment-displace style). Makes art drape over the
 * real surface. Returns a MAP×MAP Float32Array (px) or null.
 */
export async function buildTextureRelief(
  photoCropBuf: Buffer, amount: number, faceW: number,
): Promise<Float32Array | null> {
  if (amount <= 0) return null;
  const base = sharp(photoCropBuf).resize(MAP, MAP, { fit: "fill" }).greyscale().toColourspace("b-w");
  const [g, blur] = await Promise.all([
    base.clone().raw().toBuffer(),
    base.clone().blur(MAP / 12).raw().toBuffer(),
  ]);
  const amp = amount * faceW * 0.05; // px amplitude, scaled to surface size
  const relief = new Float32Array(MAP * MAP);
  for (let i = 0; i < relief.length; i++) relief[i] = ((g[i] - blur[i]) / 255) * amp;
  return relief;
}

/**
 * Returns { buffer, scale } — a PNG displacement map and the dispScale (px) to set
 * on the face. Combines curvature (cylinder/bend) with optional surface relief.
 * Returns null when there's nothing to displace.
 */
export async function buildWarpDisplacement(
  faceW: number, faceH: number, o: WarpOptions, relief?: Float32Array | null,
): Promise<{ buffer: Buffer; scale: number } | null> {
  if (!hasWarp(o) && !relief) return null;

  const cyl = Math.max(0, Math.min(1, o.cylinder ?? 0));
  const bt = o.bendTop ?? 0, bb = o.bendBottom ?? 0, bl = o.bendLeft ?? 0, br = o.bendRight ?? 0;

  // First pass: compute displacement (in px of the face) per map texel, track max.
  const dxPx = new Float32Array(MAP * MAP);
  const dyPx = new Float32Array(MAP * MAP);
  let maxAbs = 1e-3;

  for (let py = 0; py < MAP; py++) {
    const v = py / (MAP - 1);
    const shapeV = Math.sin(Math.PI * v); // 0 at top/bottom, 1 at middle
    for (let px = 0; px < MAP; px++) {
      const u = px / (MAP - 1);
      const shapeU = Math.sin(Math.PI * u); // 0 at left/right, 1 at middle

      // Horizontal cylinder: sample toward the foreshortened edges (asin mapping).
      let dxN = 0;
      if (cyl > 0) {
        const uSrc = 0.5 + Math.asin(Math.max(-1, Math.min(1, 2 * u - 1))) / Math.PI;
        dxN += cyl * (uSrc - u);
      }
      // Edge bend: bowed edges push the interior; strongest at the bowed mid, fading across.
      let dyN = 0;
      dyN += bt * shapeU * (1 - v);   // top edge bow → vertical shift, fades to bottom
      dyN += bb * shapeU * v;         // bottom edge bow
      dxN += bl * shapeV * (1 - u);   // left edge bow → horizontal shift, fades to right
      dxN += br * shapeV * u;         // right edge bow

      let ddx = dxN * faceW;
      let ddy = dyN * faceH;
      // Surface relief — diagonal drape (same px on both axes), PS displace-filter style.
      if (relief) { const r = relief[py * MAP + px]; ddx += r; ddy += r; }
      dxPx[py * MAP + px] = ddx;
      dyPx[py * MAP + px] = ddy;
      const m = Math.max(Math.abs(ddx), Math.abs(ddy));
      if (m > maxAbs) maxAbs = m;
    }
  }

  // Second pass: encode normalized to the scale.
  const scale = Math.ceil(maxAbs);
  const data = Buffer.alloc(MAP * MAP * 4);
  for (let i = 0; i < MAP * MAP; i++) {
    const r = 128 + Math.round((dxPx[i] / scale) * 128);
    const g = 128 + Math.round((dyPx[i] / scale) * 128);
    const o4 = i * 4;
    data[o4] = Math.max(0, Math.min(255, r));
    data[o4 + 1] = Math.max(0, Math.min(255, g));
    data[o4 + 2] = 128;
    data[o4 + 3] = 255;
  }

  const buffer = await sharp(data, { raw: { width: MAP, height: MAP, channels: 4 } }).png().toBuffer();
  return { buffer, scale };
}

/**
 * Displace a mask by the same map+scale the engine applies to the art face, so the
 * mask boundary bends identically (perfect bend — no clip/gap). Mirrors compose.ts:
 * out(x,y) = mask(x+dx, y+dy), dx=((R-128)/128)*scale, dy=((G-128)/128)*scale, edge-clamped.
 */
export async function displaceMask(
  maskBuf: Buffer, dispMapBuf: Buffer, scale: number, outW: number, outH: number,
): Promise<Buffer> {
  const [m, d] = await Promise.all([
    sharp(maskBuf).resize(outW, outH, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
    sharp(dispMapBuf).resize(outW, outH, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
  ]);
  const out = Buffer.alloc(outW * outH * 4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const i = (y * outW + x) * 4;
      const dx = ((d[i] - 128) / 128) * scale;
      const dy = ((d[i + 1] - 128) / 128) * scale;
      const sx = Math.max(0, Math.min(outW - 1, Math.round(x + dx)));
      const sy = Math.max(0, Math.min(outH - 1, Math.round(y + dy)));
      const si = (sy * outW + sx) * 4;
      out[i] = m[si]; out[i + 1] = m[si + 1]; out[i + 2] = m[si + 2]; out[i + 3] = m[si + 3];
    }
  }
  return sharp(out, { raw: { width: outW, height: outH, channels: 4 } }).png().toBuffer();
}
