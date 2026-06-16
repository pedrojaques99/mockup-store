/**
 * Sam2Client — main-thread wrapper around the SAM2 worker.
 * Sequential RPC (encode once, decode per click), with a progress callback.
 */
import { canvasToFloat32Array, resizeCanvas, SAM_SIZE } from "./imageutils";
import type { SamPoint } from "./SAM2";

export type Sam2Stage = "download" | "session";
export interface DecodedMask { mask: Float32Array; width: number; height: number }

export class Sam2Client {
  private worker: Worker;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private _ready = false;
  device: string | null = null;
  onProgress?: (stage: Sam2Stage) => void;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data;
      if (type === "progress") { this.onProgress?.(e.data.stage); return; }
      if (type === "error") { this.rejectAll(e.data.error); return; }
      if (type === "ready") { this.device = e.data.device; this._ready = true; this.settle("init", e.data); return; }
      if (type === "encoded") { this.settle("encode", e.data); return; }
      if (type === "decoded") {
        this.settle("decode", { mask: e.data.mask, width: e.data.width, height: e.data.height });
        return;
      }
    };
  }

  get ready() { return this._ready; }

  private settle(key: string, value: any) {
    const p = this.pending.get(key);
    if (p) { this.pending.delete(key); p.resolve(value); }
  }
  private rejectAll(error: string) {
    for (const [, p] of this.pending) p.reject(new Error(error));
    this.pending.clear();
  }
  private call<T>(key: string, msg: any, transfer?: Transferable[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set(key, { resolve, reject });
      this.worker.postMessage(msg, transfer ?? []);
    });
  }

  init(): Promise<{ device: string }> {
    return this.call("init", { type: "init" });
  }

  /** Encode a scene image (any HTMLImageElement/canvas). Resizes to 1024² internally. */
  async encode(source: HTMLImageElement | HTMLCanvasElement): Promise<void> {
    const w = (source as HTMLImageElement).naturalWidth || source.width;
    const h = (source as HTMLImageElement).naturalHeight || source.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(source as CanvasImageSource, 0, 0, w, h);
    const { float32Array, shape } = canvasToFloat32Array(resizeCanvas(c, SAM_SIZE, SAM_SIZE));
    await this.call("encode", { type: "encode", float32Array, shape }, [float32Array.buffer]);
  }

  /** points in original-image pixel coords; scaled to 1024-space here. */
  decode(points: SamPoint[], imgW: number, imgH: number): Promise<DecodedMask> {
    const scaled = points.map((p) => ({ x: (p.x / imgW) * SAM_SIZE, y: (p.y / imgH) * SAM_SIZE, label: p.label }));
    return this.call("decode", { type: "decode", points: scaled });
  }

  dispose() { this.worker.terminate(); this.pending.clear(); }
}
