/**
 * SAM2 (Segment Anything 2) client-side inference.
 * Ported from geronimi73/next-sam (MIT) and adapted to TS.
 * Encoder runs once per image; decoder runs per click (positive/negative points).
 * Models stream from HuggingFace CDN and cache in the browser's OPFS — no repo/HD bloat.
 */
import * as ort from "onnxruntime-web/all";

const ENCODER_URL =
  "https://huggingface.co/g-ronimo/sam2-tiny/resolve/main/sam2_hiera_tiny_encoder.with_runtime_opt.ort";
const DECODER_URL =
  "https://huggingface.co/g-ronimo/sam2-tiny/resolve/main/sam2_hiera_tiny_decoder_pr1.onnx";

export interface SamPoint { x: number; y: number; label: 0 | 1 } // 1 = include (true), 0 = exclude (false)

type Encoded = {
  high_res_feats_0: ort.Tensor;
  high_res_feats_1: ort.Tensor;
  image_embed: ort.Tensor;
};

export class SAM2 {
  private bufferEncoder: ArrayBuffer | null = null;
  private bufferDecoder: ArrayBuffer | null = null;
  private sessionEncoder: [ort.InferenceSession, string] | null = null;
  private sessionDecoder: [ort.InferenceSession, string] | null = null;
  private imageEncoded: Encoded | null = null;

  get device(): string | null {
    return this.sessionEncoder?.[1] ?? null;
  }
  get hasImage(): boolean {
    return this.imageEncoded != null;
  }

  async downloadModels() {
    this.bufferEncoder = await this.downloadModel(ENCODER_URL);
    this.bufferDecoder = await this.downloadModel(DECODER_URL);
  }

  private async downloadModel(url: string): Promise<ArrayBuffer | null> {
    const filename = url.split("/").pop()!;
    // OPFS cache — survives reloads, clearable, not on the project disk
    const root = await navigator.storage.getDirectory();
    const cached = await root.getFileHandle(filename).catch(() => null);
    if (cached) {
      const file = await cached.getFile();
      if (file.size > 0) return await file.arrayBuffer();
    }

    let buffer: ArrayBuffer | null = null;
    try {
      buffer = await fetch(url, { mode: "cors" }).then((r) => r.arrayBuffer());
    } catch (e) {
      console.error("SAM2 download failed:", url, e);
      return null;
    }
    if (!buffer) return null;

    try {
      const handle = await root.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      await writable.write(buffer);
      await writable.close();
    } catch (e) {
      console.error("SAM2 cache write failed:", filename, e);
    }
    return buffer;
  }

  async createSessions(): Promise<{ success: boolean; device: string | null }> {
    const ok = (await this.getEncoderSession()) && (await this.getDecoderSession());
    return { success: !!ok, device: ok ? this.device : null };
  }

  /** WebGPU first, CPU/WASM fallback. Loop per-EP to dodge multi-init crashes. */
  private async getORTSession(model: ArrayBuffer): Promise<[ort.InferenceSession, string] | null> {
    for (const ep of ["webgpu", "cpu"] as const) {
      try {
        const session = await ort.InferenceSession.create(model, { executionProviders: [ep] });
        return [session, ep];
      } catch (e) {
        console.warn(`SAM2: EP ${ep} unavailable`, e);
      }
    }
    return null;
  }

  private async getEncoderSession() {
    if (!this.sessionEncoder && this.bufferEncoder)
      this.sessionEncoder = await this.getORTSession(this.bufferEncoder);
    return this.sessionEncoder;
  }
  private async getDecoderSession() {
    if (!this.sessionDecoder && this.bufferDecoder)
      this.sessionDecoder = await this.getORTSession(this.bufferDecoder);
    return this.sessionDecoder;
  }

  /** inputTensor: float32 [1,3,1024,1024], RGB normalized 0..1 */
  async encodeImage(inputTensor: ort.Tensor) {
    const s = await this.getEncoderSession();
    if (!s) throw new Error("SAM2 encoder session unavailable");
    const [session] = s;
    const results = await session.run({ image: inputTensor });
    this.imageEncoded = {
      high_res_feats_0: results[session.outputNames[0]],
      high_res_feats_1: results[session.outputNames[1]],
      image_embed: results[session.outputNames[2]],
    };
  }

  /** points in 1024-space. Returns the raw decoder outputs (masks tensor [1,M,H,W]). */
  async decode(points: SamPoint[]) {
    const s = await this.getDecoderSession();
    if (!s) throw new Error("SAM2 decoder session unavailable");
    if (!this.imageEncoded) throw new Error("SAM2: encode an image first");
    const [session] = s;

    const flatPoints = points.flatMap((p) => [p.x, p.y]);
    const flatLabels = points.map((p) => p.label);

    const inputs: Record<string, ort.Tensor> = {
      image_embed: this.imageEncoded.image_embed,
      high_res_feats_0: this.imageEncoded.high_res_feats_0,
      high_res_feats_1: this.imageEncoded.high_res_feats_1,
      point_coords: new ort.Tensor("float32", Float32Array.from(flatPoints), [1, points.length, 2]),
      point_labels: new ort.Tensor("float32", Float32Array.from(flatLabels), [1, points.length]),
      mask_input: new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]),
      has_mask_input: new ort.Tensor("float32", [0], [1]),
    };
    return session.run(inputs);
  }

  reset() {
    this.imageEncoded = null;
  }
}
