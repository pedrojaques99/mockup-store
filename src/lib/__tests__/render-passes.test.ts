import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { neutralizeNeonPixels } from "../photo-shadow";
import { applyLightWrap, toPixels, fromPixels } from "../photo-fx";

/** Build a small RGBA test image from a per-pixel paint fn → PNG buffer. */
async function makeImg(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = paint(x, y); const i = (y * w + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
async function pixels(png: Buffer): Promise<Uint8ClampedArray> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return new Uint8ClampedArray(data);
}
const chroma = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);

describe("neutralizeNeonPixels — despill regression (the 'scene went grayscale' bug)", () => {
  const W = 20, H = 8;

  it("neutralizes magenta but KEEPS the rest of the scene in colour", async () => {
    // left half magenta #FF1493, right half a real scene colour (saturated teal)
    const png = await makeImg(W, H, (x) => (x < 10 ? [255, 20, 147] : [0, 175, 175]));
    const px = await pixels(await neutralizeNeonPixels(png, W, H, 300, 50, 0.18));
    const at = (x: number, y: number) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]] as const; };
    expect(chroma(...at(3, 4))).toBeLessThan(20);    // magenta → desaturated
    const [, tg] = at(16, 4);
    expect(tg).toBeGreaterThan(120);                  // teal still bright
    expect(chroma(...at(16, 4))).toBeGreaterThan(80); // teal STILL colourful (not grayscaled)
  });

  it("leaves near-neutral low-saturation pixels untouched (guards minSat ≥ 0.15)", async () => {
    // slightly blue-purple, saturation ≈ 0.07 — must NOT be desaturated
    const png = await makeImg(8, 4, () => [140, 135, 150]);
    const px = await pixels(await neutralizeNeonPixels(png, 8, 4, 300, 50, 0.18));
    expect([px[0], px[1], px[2]]).toEqual([140, 135, 150]);
  });
});

describe("applyLightWrap — masked, non-destructive", () => {
  it("does not touch pixels outside the mask (amount 0 → identity-ish)", async () => {
    const W = 16, H = 8;
    const render = await makeImg(W, H, () => [100, 100, 100]);
    const scene = await makeImg(W, H, () => [200, 50, 50]);
    const maskFull = await makeImg(W, H, () => [0, 0, 0]); // all-black alpha-ish → no ring
    const out = await applyLightWrap(await toPixels(render), scene, await toPixels(maskFull), W, H, 0, 8);
    const px = await pixels(await fromPixels(out));
    expect([px[0], px[1], px[2]]).toEqual([100, 100, 100]); // unchanged where mask is empty
  });
});
