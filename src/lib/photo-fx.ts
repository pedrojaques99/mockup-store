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
