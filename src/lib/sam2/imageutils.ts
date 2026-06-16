/**
 * Canvas ↔ ORT.Tensor helpers for SAM2. Ported from geronimi73/next-sam (MIT).
 */
import type { Tensor } from "onnxruntime-web/all";

export const SAM_SIZE = 1024;

/** Resize any canvas to w×h (stretch). */
export function resizeCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
  return c;
}

/** RGB canvas → { float32Array, shape:[1,3,W,H] } normalized 0..1 (alpha dropped). */
export function canvasToFloat32Array(canvas: HTMLCanvasElement): { float32Array: Float32Array; shape: number[] } {
  const { width, height } = canvas;
  const data = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  const shape = [1, 3, width, height];
  const r: number[] = [], g: number[] = [], b: number[] = [];
  for (let i = 0; i < data.length; i += 4) { r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2]); }
  const planar = r.concat(g).concat(b);
  const out = new Float32Array(shape[1] * shape[2] * shape[3]);
  for (let i = 0; i < planar.length; i++) out[i] = planar[i] / 255.0;
  return { float32Array: out, shape };
}

/** Slice mask index `idx` out of a [B, M, W, H] tensor → Float32Array (W*H). */
export function sliceTensor(tensor: Tensor, idx: number): Float32Array {
  const [, , width, height] = tensor.dims as number[];
  const stride = width * height;
  const start = stride * idx;
  return (tensor.data as Float32Array).slice(start, start + stride);
}

/** Mask logits Float32Array → RGBA ImageData where >0 becomes `color` at `alpha`. */
export function maskToImageData(
  mask: Float32Array, width: number, height: number,
  color: [number, number, number] = [0x32, 0xcd, 0x32], alpha = 150,
): ImageData {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const on = mask[i] > 0;
    const t = i * 4;
    out[t] = on ? color[0] : 0;
    out[t + 1] = on ? color[1] : 0;
    out[t + 2] = on ? color[2] : 0;
    out[t + 3] = on ? alpha : 0;
  }
  return new ImageData(out, width, height);
}

/**
 * Mask logits → shape canvas: inside = white & opaque, outside = transparent.
 * Works both as a luminance mask (R channel) and an alpha mask (dest-in) server-side.
 */
export function maskToAlphaCanvas(mask: Float32Array, width: number, height: number): HTMLCanvasElement {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const on = mask[i] > 0;
    const t = i * 4;
    out[t] = out[t + 1] = out[t + 2] = on ? 255 : 0;
    out[t + 3] = on ? 255 : 0;
  }
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  c.getContext("2d")!.putImageData(new ImageData(out, width, height), 0, 0);
  return c;
}
