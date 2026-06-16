/**
 * SAM-based surface segmentation via Replicate.
 *
 * Models:
 *   "grounded" — schananas/grounded_sam  (GroundingDINO + SAM, text + negative, $0.003/call)
 *   "lang"     — tmappdev/lang-segment-anything (Lang-SAM, text-only, $0.0014/call, faster)
 *
 * Both can return:
 *   A) extractMaskSAM(...)      — RGBA mask PNG for destination-in composite
 *   B) detectQuadSAM(...)       — quad (bounding box of mask) + RGBA mask
 *
 * Requires: REPLICATE_API_TOKEN in .env.local
 */
import { readFile } from "fs/promises";
import sharp from "sharp";
import type { QuadPoints } from "./photo-analyze";

// ── Prompts ──────────────────────────────────────────────────────────────────

/** Grounded SAM: text + negative prompts */
const GROUNDED_PROMPTS: Record<string, { pos: string; neg: string }> = {
  card:      { pos: "business card, white card",                   neg: "hands, fingers, person, background, table" },
  paper:     { pos: "business card, paper card",                   neg: "hands, fingers, person, background" },
  billboard: { pos: "billboard panel, advertising board",          neg: "pole, frame, person, sky, building, road" },
  poster:    { pos: "poster, advertising poster, paper sign",      neg: "wall, graffiti, frame, person, background" },
  busstop:   { pos: "bus shelter panel, bus stop advertisement",   neg: "person, road, sky, pole, building" },
  wall:      { pos: "wall surface, blank wall, mural surface",     neg: "windows, door, person, sky, ground, furniture" },
  screen:    { pos: "screen, display, monitor",                    neg: "frame, bezel, person" },
  fabric:    { pos: "blank t-shirt front, shirt chest area",       neg: "person face, hands, background, pants, shoes" },
  tshirt:    { pos: "blank t-shirt front, shirt print area",       neg: "person face, hands, background, pants" },
  bag:       { pos: "tote bag, shopping bag, bag surface",         neg: "handles, person, background, table" },
  box:       { pos: "cardboard box, shipping box surface",         neg: "person, background, table, hands" },
  other:     { pos: "flat surface, blank panel",                   neg: "person, background, frame" },
};

/** Lang-SAM: text-only prompts (no negative supported) */
const LANG_PROMPTS: Record<string, string> = {
  card:      "business card white card",
  paper:     "business card paper card",
  billboard: "billboard panel advertising board blank panel",
  poster:    "poster advertising poster white paper sign",
  busstop:   "bus shelter advertisement panel bus stop sign",
  wall:      "blank wall mural surface flat wall",
  screen:    "screen display monitor",
  fabric:    "blank t-shirt front shirt chest",
  tshirt:    "blank t-shirt front shirt print area chest",
  bag:       "tote bag shopping bag",
  box:       "cardboard box shipping box package",
  other:     "flat surface blank panel",
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Encode image file as base64 data URI. */
async function toDataUrl(photoPath: string): Promise<string> {
  const buf = await readFile(photoPath);
  const ext = photoPath.split(".").pop()?.toLowerCase() ?? "png";
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** Download a URL → Buffer. */
async function fetchBuf(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SAM download failed: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Poll Replicate prediction URL until succeeded/failed/timeout. */
async function pollUntilDone(pollUrl: string, token: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    const p = await (await fetch(pollUrl, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (p.status === "succeeded") return p;
    if (p.status === "failed") throw new Error(`SAM prediction failed: ${p.error ?? "unknown"}`);
  }
  throw new Error("SAM prediction timeout");
}

/** Convert raw 1-channel grayscale buffer (WxH) to bounding-box QuadPoints. */
function rawGrayToQuad(data: Buffer, W: number, H: number): QuadPoints | null {
  let minX = W, minY = H, maxX = 0, maxY = 0, found = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < 128) continue;
    found = true;
    const x = i % W, y = Math.floor(i / W);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!found) return null;
  return {
    tl: { x: minX, y: minY },
    tr: { x: maxX, y: minY },
    br: { x: maxX, y: maxY },
    bl: { x: minX, y: maxY },
  };
}

/** Convert any mask PNG buffer → grayscale Buffer (1 ch, W×H). */
async function maskToGray(maskBuf: Buffer, W: number, H: number): Promise<Buffer> {
  const { data } = await sharp(maskBuf)
    .resize(W, H, { fit: "fill", kernel: "lanczos3" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/** Convert grayscale Buffer → RGBA PNG (all 4 channels = grayscale, for destination-in). */
async function grayToRGBAPng(gray: Buffer, W: number, H: number): Promise<Buffer> {
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = gray[i];
    rgba[i * 4 + 0] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = v;
  }
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).blur(1).png().toBuffer();
}

// ── Core model callers ────────────────────────────────────────────────────────

const GROUNDED_SAM_VERSION = "ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c";
// Output: single URI string (PNG with colored overlay — we derive mask by thresholding)
const LANG_SAM_VERSION = "891411c38a6ed2d44c004b7b9e44217df7a5b07848f29ddefd2e28bc7cbf93bc";

/** Call Grounded SAM. Returns gray PNG (1ch, W×H). */
async function callGroundedSAMGray(
  dataUrl: string,
  surfaceType: string,
  W: number,
  H: number,
  token: string,
  adjustmentFactor = -5,
  timeoutMs = 45000,
): Promise<Buffer> {
  const prompts = GROUNDED_PROMPTS[surfaceType] ?? GROUNDED_PROMPTS.other;

  let prediction: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: GROUNDED_SAM_VERSION,
        input: {
          image: dataUrl,
          mask_prompt: prompts.pos,
          negative_mask_prompt: prompts.neg,
          adjustment_factor: adjustmentFactor,
        },
      }),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const wait = ((body.retry_after ?? 10) + 1) * 1000;
      console.warn(`    [grounded-sam] rate limit — wait ${Math.round(wait / 1000)}s`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Grounded SAM: ${res.status} ${await res.text().catch(() => "")}`);
    prediction = await res.json();
    break;
  }
  if (!prediction) throw new Error("Grounded SAM: exhausted retries");
  if (prediction.status !== "succeeded") prediction = await pollUntilDone(prediction.urls?.get, token, timeoutMs);

  // output[2] = mask.jpg (clean B&W), fallback to output[0]
  const output: string[] = Array.isArray(prediction.output) ? prediction.output : [];
  const maskUrl = output[2] ?? output[0];
  if (!maskUrl) throw new Error("Grounded SAM: no mask in output");

  return maskToGray(await fetchBuf(maskUrl), W, H);
}

/** Call Lang-SAM (tmappdev/lang-segment-anything). Returns gray PNG (1ch, W×H).
 *  Output: binary mask PNG (white=surface, black=background) — use directly.
 */
async function callLangSAMGray(
  dataUrl: string,
  textPrompt: string,
  W: number,
  H: number,
  token: string,
  timeoutMs = 30000,
): Promise<Buffer> {
  // Use version-based endpoint (model-level /predictions returns 404 for community models)
  let prediction: any;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: LANG_SAM_VERSION,
        input: { image: dataUrl, text_prompt: textPrompt },
      }),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const wait = ((body.retry_after ?? 10) + 1) * 1000;
      console.warn(`    [lang-sam] rate limit — wait ${Math.round(wait / 1000)}s (attempt ${attempt}/5)`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Lang-SAM: ${res.status} ${await res.text().catch(() => "")}`);
    prediction = await res.json();
    break;
  }
  if (!prediction) throw new Error("Lang-SAM: exhausted rate-limit retries");
  if (prediction.status !== "succeeded") prediction = await pollUntilDone(prediction.urls?.get, token, timeoutMs);

  // Output is a single URI to a binary mask PNG (white=surface, black=bg)
  const output = prediction.output;
  const maskUrl: string | null =
    typeof output === "string" ? output :
    Array.isArray(output) ? (output[0] ?? null) : null;
  if (!maskUrl) throw new Error("Lang-SAM: no output URL");

  return maskToGray(await fetchBuf(maskUrl), W, H);
}

// ── Public API ────────────────────────────────────────────────────────────────

export type SAMModel = "lang" | "grounded";

export interface SAMDetectResult {
  quad: QuadPoints;
  maskBuf: Buffer;  // RGBA PNG for destination-in composite
}

/**
 * Detect surface quad + mask via SAM.
 *
 * @param photoPath   Path to the input image
 * @param textPrompt  Text description of the surface (e.g. "blank t-shirt front").
 *                    If undefined, uses built-in prompts keyed by surfaceType.
 * @param surfaceType Surface type key for built-in prompts and Grounded SAM
 * @param W, H        Image dimensions
 * @param model       "lang" (default, faster/cheaper) | "grounded" (more precise)
 * @returns { quad, maskBuf } or null on failure / no token
 */
export async function detectQuadSAM(
  photoPath: string,
  textPrompt: string | undefined,
  surfaceType: string,
  W: number,
  H: number,
  model: SAMModel = "lang",
): Promise<SAMDetectResult | null> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return null;

  try {
    const dataUrl = await toDataUrl(photoPath);
    const prompt = textPrompt ?? (model === "lang" ? LANG_PROMPTS[surfaceType] : undefined) ?? surfaceType;

    const gray = model === "lang"
      ? await callLangSAMGray(dataUrl, prompt, W, H, token)
      : await callGroundedSAMGray(dataUrl, surfaceType, W, H, token);

    const quad = rawGrayToQuad(gray, W, H);
    if (!quad) { console.warn(`    [SAM/${model}] empty mask — no surface found`); return null; }

    const maskBuf = await grayToRGBAPng(gray, W, H);
    return { quad, maskBuf };
  } catch (e: any) {
    console.warn(`    [SAM/${model}] ${e.message}`);
    return null;
  }
}

/**
 * Convert any mask PNG buffer to a QuadPoints bounding box.
 * Useful for post-processing masks from other sources.
 */
export async function maskBufToQuad(maskBuf: Buffer, W: number, H: number): Promise<QuadPoints | null> {
  const gray = await maskToGray(maskBuf, W, H);
  return rawGrayToQuad(gray, W, H);
}

/**
 * Extract pixel-perfect surface mask via Grounded SAM (existing API, unchanged).
 * Used in Phase 2 of pipeline for mask refinement after quad is known.
 *
 * Returns RGBA PNG (full photo size) where:
 *   white + alpha=255 → art renders here
 *   black + alpha=0   → art hidden
 *
 * Returns null if REPLICATE_API_TOKEN is not set.
 */
export async function extractMaskSAM(
  photoPath: string,
  _quad: QuadPoints,  // kept for API compat — not used internally
  W: number,
  H: number,
  surfaceType: string,
  opts: { adjustmentFactor?: number; timeoutMs?: number } = {},
): Promise<Buffer | null> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return null;

  try {
    const { adjustmentFactor = -5, timeoutMs = 30000 } = opts;
    const dataUrl = await toDataUrl(photoPath);
    const gray = await callGroundedSAMGray(dataUrl, surfaceType, W, H, token, adjustmentFactor, timeoutMs);
    return grayToRGBAPng(gray, W, H);
  } catch (e: any) {
    throw e; // let caller handle (they do try/catch + fallback)
  }
}
