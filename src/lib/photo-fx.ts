import sharp from "sharp";

export interface RenderFX {
  grain?: number;       // 0–100  film grain intensity
  warmth?: number;      // -100 cool → +100 warm
  saturation?: number;  // 0–200 (100 = neutral)
  brightness?: number;  // 50–150 (100 = neutral)
  contrast?: number;    // 50–150 (100 = neutral)
}

export const FX_DEFAULTS: RenderFX = {
  grain: 0,
  warmth: 0,
  saturation: 100,
  brightness: 100,
  contrast: 100,
};

export async function applyRenderFX(buf: Buffer, fx: RenderFX): Promise<Buffer> {
  const sat  = fx.saturation  ?? 100;
  const bri  = fx.brightness  ?? 100;
  const warm = fx.warmth      ?? 0;
  const grain = fx.grain      ?? 0;
  const con  = fx.contrast    ?? 100;

  const isNeutral = sat === 100 && bri === 100 && warm === 0 && grain === 0 && con === 100;
  if (isNeutral) return buf;

  let img = sharp(buf).ensureAlpha();

  // Saturation + brightness
  if (sat !== 100 || bri !== 100) {
    img = img.modulate({
      saturation: sat / 100,
      brightness: bri / 100,
    });
  }

  // Contrast around mid-gray: out = a*in + b, with a = contrast factor
  if (con !== 100) {
    const a = con / 100;
    const b = 128 * (1 - a);
    img = img.linear(a, b);
  }

  // Warmth: shift red/blue channels via recomb
  if (warm !== 0) {
    const t = warm / 100; // -1..1
    img = img.recomb([
      [1 + t * 0.18,  t * 0.04,  0            ],
      [0,             1,          0            ],
      [0,            -t * 0.04,  1 - t * 0.18 ],
    ]);
  }

  if (grain <= 0) return img.png().toBuffer();

  // Grain: per-pixel luminance-weighted noise
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data);
  const intensity = grain / 100 * 28;

  for (let i = 0; i < width * height; i++) {
    const base = i * channels;
    const n = (Math.random() - 0.5) * intensity;
    out[base]     = Math.max(0, Math.min(255, out[base]     + n));
    out[base + 1] = Math.max(0, Math.min(255, out[base + 1] + n));
    out[base + 2] = Math.max(0, Math.min(255, out[base + 2] + n));
  }

  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

// ── Reflexo (reflection tint) ─────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/**
 * "Reflexo" — tint the scene's reflection regions with the artwork's colours,
 * Photoshop "Color" blend style: keep the scene's luminance, take the art's
 * hue+saturation. The art is smeared (cover-resize + heavy blur) into a soft
 * colour field; applied only where `maskBuf` is set, scaled by `opacity`.
 */
export async function applyReflection(
  baseBuf: Buffer, artBuf: Buffer, maskBuf: Buffer,
  width: number, height: number, opacity: number, blur: number,
): Promise<Buffer> {
  const op = Math.max(0, Math.min(1, opacity));
  if (op <= 0) return baseBuf;

  const [base, art, mask] = await Promise.all([
    sharp(baseBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(artBuf).resize(width, height, { fit: "cover" }).blur(Math.max(0.3, blur)).removeAlpha().raw().toBuffer(),
    sharp(maskBuf).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
  ]);

  const bd = base.data, bc = base.info.channels;
  const out = Buffer.from(bd);

  for (let i = 0; i < width * height; i++) {
    const m = mask[i * 4] / 255; // reflection coverage (R channel)
    if (m <= 0) continue;
    const a = m * op;
    const bi = i * bc, ai = i * 3;
    const [, , bl] = rgbToHsl(bd[bi], bd[bi + 1], bd[bi + 2]);
    const [ah, as] = rgbToHsl(art[ai], art[ai + 1], art[ai + 2]);
    const [r, g, b2] = hslToRgb(ah, as, bl); // art hue+sat, scene luminance
    out[bi]     = Math.round(bd[bi]     * (1 - a) + r  * a);
    out[bi + 1] = Math.round(bd[bi + 1] * (1 - a) + g  * a);
    out[bi + 2] = Math.round(bd[bi + 2] * (1 - a) + b2 * a);
  }

  return sharp(out, { raw: { width, height, channels: bc } }).png().toBuffer();
}

/**
 * Specular highlight preservation — screens the photo's bright reflections (window,
 * light source) back ON TOP of the art, clipped to the surface. Sells glossy
 * materials (glass, screen, plastic, metal) where the art shouldn't kill the gloss.
 * Highlights keep their real colour; strength ramps above `threshold` (0..255).
 */
export async function applySpecular(
  baseBuf: Buffer, rawPhotoBuf: Buffer, maskBuf: Buffer,
  width: number, height: number, opacity: number, threshold = 205,
): Promise<Buffer> {
  const op = Math.max(0, Math.min(1, opacity));
  if (op <= 0) return baseBuf;

  const [base, photo, mask] = await Promise.all([
    sharp(baseBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(rawPhotoBuf).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer(),
    sharp(maskBuf).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
  ]);
  const bd = base.data, bc = base.info.channels;
  const out = Buffer.from(bd);
  const range = Math.max(1, 255 - threshold);

  for (let i = 0; i < width * height; i++) {
    const m = mask[i * 4] / 255;
    if (m <= 0) continue;
    const pi = i * 3, bi = i * bc;
    const lum = 0.299 * photo[pi] + 0.587 * photo[pi + 1] + 0.114 * photo[pi + 2];
    if (lum <= threshold) continue;
    const f = Math.min(1, (lum - threshold) / range) * op * m;
    for (let c = 0; c < 3; c++) {
      const spec = photo[pi + c] * f;
      // screen blend: 255 - (255-base)(255-spec)/255
      out[bi + c] = 255 - ((255 - bd[bi + c]) * (255 - spec)) / 255;
    }
  }
  return sharp(out, { raw: { width, height, channels: bc } }).png().toBuffer();
}

/**
 * Light wrap — bleed the scene's ambient light onto a thin INNER band of the
 * art edge so the composite reads as lit by the environment, not pasted.
 * ring(i) = mask(i)·(1 − boxblur(mask))·amount → a soft inner-edge weight; the
 * heavily-blurred scene is screen-blended there. O(n) via integral-image blur.
 */
export async function applyLightWrap(
  png: Buffer,
  sceneFull: Buffer,
  maskFullAlpha: Buffer,
  width: number,
  height: number,
  amount: number,
  radius = 18,
): Promise<Buffer> {
  const { boxFilter } = await import("./guided-filter");
  const [pr, ambient, mr] = await Promise.all([
    sharp(png).ensureAlpha().raw().toBuffer(),
    sharp(sceneFull).blur(Math.max(2, radius)).ensureAlpha().raw().toBuffer(),
    sharp(maskFullAlpha).ensureAlpha().raw().toBuffer(),
  ]);
  const n = width * height;
  const maskNorm = new Float64Array(n);
  for (let i = 0; i < n; i++) maskNorm[i] = mr[i * 4 + 3] / 255;
  const mblur = boxFilter(maskNorm, width, height, radius);

  const out = Buffer.from(pr);
  for (let i = 0; i < n; i++) {
    const ring = maskNorm[i] * (1 - mblur[i]) * amount;
    if (ring <= 0.002) continue;
    const j = i * 4;
    for (let c = 0; c < 3; c++) {
      const a = pr[j + c], b = ambient[j + c];
      const screen = 255 - ((255 - a) * (255 - b)) / 255;
      out[j + c] = Math.round(a * (1 - ring) + screen * ring);
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Grain + color match — make the composited art belong to the scene by (1)
 * nudging its channel means toward the scene's average colour (temperature
 * match) and (2) overlaying monochrome grain at the scene's measured noise
 * level. Masked to the surface; `amount` 0..1 scales both. Kills the "pasted" look.
 */
export async function applyGrainColorMatch(
  png: Buffer,
  sceneFull: Buffer,
  maskFullAlpha: Buffer,
  width: number,
  height: number,
  amount: number,
): Promise<Buffer> {
  const [pr, sc, mr] = await Promise.all([
    sharp(png).ensureAlpha().raw().toBuffer(),
    sharp(sceneFull).ensureAlpha().raw().toBuffer(),
    sharp(maskFullAlpha).ensureAlpha().raw().toBuffer(),
  ]);
  const n = width * height;

  // Scene mean colour + grain sigma (sampled), and masked-art mean colour.
  let sR = 0, sG = 0, sB = 0, sc_n = 0, grain = 0, gN = 0;
  for (let i = 0; i < n; i += 7) {
    const j = i * 4;
    sR += sc[j]; sG += sc[j + 1]; sB += sc[j + 2]; sc_n++;
    if (i % 2 === 0 && i + 1 < n) {
      const l0 = 0.299 * sc[j] + 0.587 * sc[j + 1] + 0.114 * sc[j + 2];
      const k = (i + 1) * 4;
      const l1 = 0.299 * sc[k] + 0.587 * sc[k + 1] + 0.114 * sc[k + 2];
      grain += Math.abs(l0 - l1); gN++;
    }
  }
  sR /= sc_n; sG /= sc_n; sB /= sc_n;
  const sigma = Math.min(24, (grain / Math.max(1, gN)) * 0.9);

  let aR = 0, aG = 0, aB = 0, aN = 0;
  for (let i = 0; i < n; i++) {
    if (mr[i * 4 + 3] < 128) continue;
    const j = i * 4; aR += pr[j]; aG += pr[j + 1]; aB += pr[j + 2]; aN++;
  }
  if (aN === 0) return png;
  aR /= aN; aG /= aN; aB /= aN;

  const dR = (sR - aR) * amount * 0.45, dG = (sG - aG) * amount * 0.45, dB = (sB - aB) * amount * 0.45;
  const out = Buffer.from(pr);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let i = 0; i < n; i++) {
    const cov = mr[i * 4 + 3] / 255;
    if (cov <= 0.002) continue;
    const j = i * 4;
    const noise = (Math.random() - 0.5) * 2 * sigma * amount;
    out[j]     = clamp(pr[j]     + (dR + noise) * cov);
    out[j + 1] = clamp(pr[j + 1] + (dG + noise) * cov);
    out[j + 2] = clamp(pr[j + 2] + (dB + noise) * cov);
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Contact shadow — a soft cast shadow on the scene just below the surface edge,
 * grounding the mockup. shadow(i) = max(0, mask(x, y-offset) − mask(i)) → a band
 * below the surface; box-blurred and multiplied (darkened) onto the render.
 */
export async function applyContactShadow(
  png: Buffer,
  maskFullAlpha: Buffer,
  width: number,
  height: number,
  amount: number,
  offset?: number,
  blur?: number,
): Promise<Buffer> {
  const { boxFilter } = await import("./guided-filter");
  const [pr, mr] = await Promise.all([
    sharp(png).ensureAlpha().raw().toBuffer(),
    sharp(maskFullAlpha).ensureAlpha().raw().toBuffer(),
  ]);
  const n = width * height;
  const off = offset ?? Math.max(4, Math.round(height * 0.014));
  const br = blur ?? Math.max(4, Math.round(Math.max(width, height) * 0.012));

  const mask = new Float64Array(n);
  for (let i = 0; i < n; i++) mask[i] = mr[i * 4 + 3] / 255;
  const shadow = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const above = y - off >= 0 ? mask[(y - off) * width + x] : 0;
      const s = above - mask[i];
      if (s > 0) shadow[i] = s;
    }
  }
  const sb = boxFilter(shadow, width, height, br);

  const out = Buffer.from(pr);
  for (let i = 0; i < n; i++) {
    const d = Math.min(1, sb[i]) * amount;
    if (d <= 0.002) continue;
    const j = i * 4;
    out[j] = Math.round(pr[j] * (1 - d));
    out[j + 1] = Math.round(pr[j + 1] * (1 - d));
    out[j + 2] = Math.round(pr[j + 2] * (1 - d));
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
