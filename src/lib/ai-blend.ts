/**
 * AI Blend: refines geometric composite using FLUX Dev img2img (Replicate).
 *
 * Strategy (better than Recraft):
 *   1. Our geometric composite IS the init_image → design fidelity preserved
 *   2. Crop the face/surface area from composite
 *   3. FLUX Dev img2img on crop (prompt_strength 0.2–0.5 → 50–80% structure preserved)
 *   4. Paste refined crop back via mask (background stays original)
 *   5. Optional: multiply shadow layer at adjustable opacity (adds surface texture depth)
 *
 * Recraft generates from scratch (text → design can drift).
 * We generate from a geometrically-correct composite → no design drift.
 *
 * Requires: REPLICATE_API_TOKEN in env
 */
import sharp from "sharp";
import type { QuadPoints } from "./photo-analyze";

// ── Surface-type presets ──────────────────────────────────────────────────────

export interface AIBlendDefaults {
  enabled: boolean;
  strength: number;    // prompt_strength for FLUX (0.1–0.7)
  texture: boolean;
  textureOpacity: number;
}

const DEFAULTS: Record<string, AIBlendDefaults> = {
  fabric:    { enabled: true,  strength: 0.40, texture: true,  textureOpacity: 0.30 },
  tshirt:    { enabled: true,  strength: 0.40, texture: true,  textureOpacity: 0.30 },
  bag:       { enabled: true,  strength: 0.35, texture: true,  textureOpacity: 0.25 },
  wall:      { enabled: true,  strength: 0.30, texture: true,  textureOpacity: 0.20 },
  box:       { enabled: true,  strength: 0.25, texture: true,  textureOpacity: 0.20 },
  billboard: { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
  poster:    { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
  card:      { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
  paper:     { enabled: false, strength: 0.15, texture: false, textureOpacity: 0.15 },
  screen:    { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.00 },
  busstop:   { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
};

export function getAIBlendDefaults(surfaceType: string): AIBlendDefaults {
  return DEFAULTS[surfaceType] ?? { enabled: false, strength: 0.20, texture: false, textureOpacity: 0.15 };
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  fabric:    "t-shirt product photo, printed graphic on fabric, realistic textile wrinkles, professional photography, studio lighting",
  tshirt:    "t-shirt product photo, printed graphic on fabric, realistic textile wrinkles, professional photography, studio lighting",
  bag:       "tote bag product photo, printed design on fabric, natural texture, professional photography",
  wall:      "wall art installation, printed artwork on wall, realistic surface texture, gallery lighting",
  box:       "product packaging mockup, printed design on cardboard, realistic box texture, studio lighting",
  billboard: "outdoor billboard advertisement, printed poster, realistic outdoor lighting",
  poster:    "poster advertisement, printed design on paper, realistic paper texture, ambient lighting",
  card:      "business card product photo, printed design on paper, professional studio lighting",
  paper:     "paper product with printed design, realistic texture, studio lighting",
  screen:    "device screen mockup, realistic display, ambient reflection, professional photography",
  busstop:   "bus shelter advertisement panel, printed poster, realistic outdoor lighting",
};

export function getAIBlendPrompt(surfaceType: string): string {
  return PROMPTS[surfaceType] ?? "product mockup, printed design on surface, realistic texture, professional photography";
}

// ── Quality presets ───────────────────────────────────────────────────────────

export type AIBlendQuality = "fast" | "balanced" | "quality";

export const AI_QUALITY_PRESETS: Record<AIBlendQuality, {
  label: string;
  steps: number;
  maxPx: number;
  estimatedCost: string;
  estimatedTime: string;
}> = {
  fast:     { label: "Fast",     steps: 6,  maxPx: 512,  estimatedCost: "~$0.005", estimatedTime: "~8s"  },
  balanced: { label: "Balanced", steps: 12, maxPx: 768,  estimatedCost: "~$0.015", estimatedTime: "~20s" },
  quality:  { label: "Quality",  steps: 22, maxPx: 1024, estimatedCost: "~$0.045", estimatedTime: "~50s" },
};

// ── Replicate helpers ─────────────────────────────────────────────────────────

async function pollUntilDone(pollUrl: string, token: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    const p = await (await fetch(pollUrl, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (p.status === "succeeded") return p;
    if (p.status === "failed") throw new Error(`FLUX prediction failed: ${p.error ?? "unknown"}`);
  }
  throw new Error("FLUX prediction timeout");
}

/** Encode buffer to base64 data URI. */
function toDataUri(buf: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Download URL → Buffer. */
async function fetchBuf(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Call FLUX Dev img2img via Replicate.
 * Returns PNG Buffer of the refined image (at sw×sh dimensions — FLUX snaps to multiples of 16).
 */
async function callFluxDevImg2Img(
  cropDataUrl: string,
  prompt: string,
  promptStrength: number,
  sw: number,
  sh: number,
  token: string,
  steps: number,
  timeoutMs = 90000,
): Promise<Buffer> {
  let prediction: any;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          image: cropDataUrl,
          prompt,
          prompt_strength: promptStrength,
          num_inference_steps: steps,
          guidance: 3.5,
          width: sw,
          height: sh,
          output_format: "png",
          output_quality: 90,
          disable_safety_checker: true,
        },
      }),
    });

    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const wait = ((body.retry_after ?? 10) + 1) * 1000;
      console.warn(`    [ai-blend] rate limit — waiting ${Math.round(wait / 1000)}s`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`FLUX Dev: ${res.status} ${await res.text().catch(() => "")}`);
    prediction = await res.json();
    break;
  }

  if (!prediction) throw new Error("FLUX Dev: exhausted rate-limit retries");
  if (prediction.status !== "succeeded") prediction = await pollUntilDone(prediction.urls?.get, token, timeoutMs);

  const output = prediction.output;
  const outputUrl: string | null =
    typeof output === "string" ? output :
    Array.isArray(output) ? (output[0] ?? null) : null;
  if (!outputUrl) throw new Error("FLUX Dev: no output URL");

  return fetchBuf(outputUrl);
}

// ── Core: pixel-level mask blend + texture overlay ────────────────────────────

/**
 * Blend `refinedFull` into `composite` using `mask` (white = use refined).
 * All three must be W×H pixels.
 */
async function maskBlend(
  compositeBuf: Buffer,
  refinedBuf: Buffer,
  maskBuf: Buffer,
  W: number,
  H: number,
): Promise<Buffer> {
  const [orig, refined, mask] = await Promise.all([
    sharp(compositeBuf).ensureAlpha().resize(W, H, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true }),
    sharp(refinedBuf).ensureAlpha().resize(W, H, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true }),
    sharp(maskBuf).grayscale().resize(W, H, { fit: "fill", kernel: "nearest" }).raw().toBuffer({ resolveWithObject: true }),
  ]);

  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const m = mask.data[i] / 255;
    for (let c = 0; c < 4; c++) {
      out[i * 4 + c] = Math.round(orig.data[i * 4 + c] * (1 - m) + refined.data[i * 4 + c] * m);
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

/**
 * Multiply shadow over result at `opacity` — adds surface texture/depth.
 * shadow[i] ~= 1 at bright areas, < 1 at dark/shadow areas → darkens accordingly.
 */
async function applyTextureOverlay(
  resultBuf: Buffer,
  shadowBuf: Buffer,
  W: number,
  H: number,
  opacity: number,
): Promise<Buffer> {
  const [res, shad] = await Promise.all([
    sharp(resultBuf).ensureAlpha().resize(W, H, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true }),
    sharp(shadowBuf).grayscale().resize(W, H, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true }),
  ]);

  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const s = shad.data[i] / 255;
    const mult = 1 - opacity + opacity * s;
    out[i * 4 + 0] = Math.min(255, Math.round(res.data[i * 4 + 0] * mult));
    out[i * 4 + 1] = Math.min(255, Math.round(res.data[i * 4 + 1] * mult));
    out[i * 4 + 2] = Math.min(255, Math.round(res.data[i * 4 + 2] * mult));
    out[i * 4 + 3] = res.data[i * 4 + 3];
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AIBlendOptions {
  compositeBuf: Buffer;     // full-size geometric composite (PNG)
  maskBuf: Buffer;          // quad mask PNG (white = surface area)
  shadowBuf: Buffer;        // shadow/multiply map for texture overlay
  quad: QuadPoints;         // pixel coordinates
  W: number;
  H: number;
  surfaceType: string;
  prompt?: string;          // override auto-prompt
  strength: number;         // prompt_strength for FLUX (0.1–0.7)
  textureOpacity: number;   // 0 = no texture, 0.3 = moderate depth
  quality?: AIBlendQuality; // "fast" | "balanced" | "quality" (default: "balanced")
}

/**
 * Main AI blend function. Returns a refined PNG buffer.
 * Uses FLUX Dev img2img: crop face → refine → paste back via mask → texture overlay.
 */
export async function aiBlendSurface(options: AIBlendOptions): Promise<Buffer> {
  const {
    compositeBuf, maskBuf, shadowBuf, quad, W, H,
    surfaceType, strength, textureOpacity,
  } = options;
  const prompt = options.prompt ?? getAIBlendPrompt(surfaceType);
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");

  const preset = AI_QUALITY_PRESETS[options.quality ?? "balanced"];

  // 1. Compute face bounding box from quad
  const fx = Math.max(0, Math.min(quad.tl.x, quad.bl.x));
  const fy = Math.max(0, Math.min(quad.tl.y, quad.tr.y));
  const fxMax = Math.min(W, Math.max(quad.tr.x, quad.br.x));
  const fyMax = Math.min(H, Math.max(quad.bl.y, quad.br.y));
  const fw = fxMax - fx;
  const fh = fyMax - fy;

  if (fw < 32 || fh < 32) throw new Error("Face area too small for AI blend");

  // 2. Crop face from composite
  const cropBuf = await sharp(compositeBuf)
    .extract({ left: fx, top: fy, width: fw, height: fh })
    .png()
    .toBuffer();

  // 3. Snap to 16px multiples, cap at preset maxPx (FLUX Dev requirement)
  const maxPx = preset.maxPx;
  const scale = Math.min(1, maxPx / Math.max(fw, fh));
  const sw = Math.max(16, Math.round(fw * scale / 16) * 16);
  const sh = Math.max(16, Math.round(fh * scale / 16) * 16);

  const cropResized = await sharp(cropBuf).resize(sw, sh, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  const cropDataUrl = toDataUri(cropResized);

  // 4. FLUX Dev img2img
  console.log(`    [ai-blend] FLUX Dev img2img ${sw}×${sh} strength=${strength} surface=${surfaceType}`);
  const refinedBuf = await callFluxDevImg2Img(cropDataUrl, prompt, strength, sw, sh, token, preset.steps);

  // 5. Resize refined back to original face dimensions
  const refinedOrigSize = await sharp(refinedBuf)
    .resize(fw, fh, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();

  // 6. Place refined face into a full-size canvas at (fx, fy)
  const refinedFull = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: refinedOrigSize, left: fx, top: fy }])
    .png()
    .toBuffer();

  // 7. Expand bbox mask to full W×H canvas before blending
  // mask.png is bbox-sized (outW×outH) — must be positioned at (maskLeft, maskTop) not stretched
  const maskXs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const maskYs = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const maskLeft = Math.max(0, Math.floor(Math.min(...maskXs)));
  const maskTop  = Math.max(0, Math.floor(Math.min(...maskYs)));
  const fullMaskBuf = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } },
  })
    .composite([{ input: maskBuf, left: maskLeft, top: maskTop }])
    .png()
    .toBuffer();

  let result = await maskBlend(compositeBuf, refinedFull, fullMaskBuf, W, H);

  // 8. Optional texture overlay (re-apply surface depth)
  if (textureOpacity > 0.01) {
    result = await applyTextureOverlay(result, shadowBuf, W, H, textureOpacity);
  }

  return result;
}
