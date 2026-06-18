/**
 * GPT-4o Vision — detects the flat surface in a photo and returns pixel-precise
 * quad corners. Uses NORMALIZED coordinates (0.0-1.0) to avoid GPT-4o internal
 * scaling confusion. Falls back to Gemini if OPENAI_API_KEY is not set.
 */
import OpenAI from "openai";
import { readFile } from "fs/promises";

export interface QuadPoints {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
}

export interface SurfaceAnalysis {
  quad: QuadPoints;
  surfaceType: string;
  material: string;
  hasOcclusion: boolean;
  occlusionDesc: string;
  lightingDir: string;
  confidence: number;
  imageWidth: number;
  imageHeight: number;
}

function makePrompt(w: number, h: number, attempt: number, lastFeedback = ""): string {
  const focus =
    attempt === 1
      ? "Focus on the most prominent blank or lightly-textured rectangular surface suitable for placing a design (card, poster, billboard, wall panel, screen)."
      : attempt === 2
        ? "Look for ANY flat rectangular surface even if hands/objects partially overlap the edges. Include the FULL surface area including portions behind fingers or people."
        : "Find the single best flat surface for a design mockup. Pick the dominant planar element and estimate its full extent including occluded edges.";

  const cardHint = `
CRITICAL for business cards held in hand:
- Business cards in landscape fill a LARGE portion of frame — expect tl.x < 0.25 and tr.x > 0.75
- The card's LEFT edge is where the person's LEFT thumb starts, RIGHT edge where RIGHT hand ends
- Include the FULL card surface — extrapolate the four card corners even where fingers overlap
- Do NOT return the tiny visible strip; return the COMPLETE card rectangle from corner to corner
- Expected aspect ratio: width ~1.75× height (landscape standard card)`;

  const fb = lastFeedback ? `\nPrevious attempt issue: ${lastFeedback}\n` : "";

  return `You are a computer vision expert extracting surface coordinates for a design mockup pipeline.

${focus}
${cardHint}
${fb}
PERSPECTIVE — CRITICAL: Identify the ACTUAL pixel corners of the surface, not an axis-aligned bounding box.
- If the surface is tilted, leaning, or viewed at an angle, the four corners form a TRAPEZOID or PARALLELOGRAM — NOT a rectangle.
- Example: a poster leaning against a wall has its bottom corners further apart than top corners.
- Example: a billboard at an angle has left edge shorter/longer than right edge.
- WRONG: returning tl.x=bl.x and tr.x=br.x (that is just a bounding box).
- RIGHT: each corner independently tracks the actual surface edge at that corner.

Return coordinates as NORMALIZED values between 0.0 and 1.0:
- x values: 0.0 = left edge, 1.0 = right edge of image
- y values: 0.0 = top edge, 1.0 = bottom edge of image

Return ONLY valid JSON, no markdown, no extra text:
{
  "tl": {"x": <0.0-1.0>, "y": <0.0-1.0>},
  "tr": {"x": <0.0-1.0>, "y": <0.0-1.0>},
  "br": {"x": <0.0-1.0>, "y": <0.0-1.0>},
  "bl": {"x": <0.0-1.0>, "y": <0.0-1.0>},
  "surfaceType": "<card|poster|billboard|wall|screen|paper|fabric|other>",
  "material": "<matte|glossy|rough|paper|fabric>",
  "hasOcclusion": <true|false>,
  "occlusionDesc": "<e.g. 'fingers holding card', 'person walking in front', or ''>",
  "lightingDir": "<top-left|top-right|top|ambient|side-left|side-right>",
  "confidence": <0.0 to 1.0>
}

All x/y values MUST be between 0.0 and 1.0. Corner order: tl=top-left, tr=top-right, br=bottom-right, bl=bottom-left (clockwise).`;
}

function validateQuad(q: QuadPoints, w: number, h: number, surfaceType = ""): string | null {
  const pts = [q.tl, q.tr, q.br, q.bl];
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return "non-finite coordinates";
    if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) return `point (${p.x},${p.y}) out of bounds`;
  }
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  const absArea = Math.abs(area) / 2;
  const minArea = w * h * 0.003;
  if (absArea < minArea) return `area ${Math.round(absArea)}px² too small (min ${Math.round(minArea)}px²) — surface may be too small or coordinates wrong`;

  // Card-specific: must be landscape (wider than tall) and span significant portion of image
  if (surfaceType === "card") {
    const detW = Math.max(q.tr.x, q.br.x) - Math.min(q.tl.x, q.bl.x);
    const detH = Math.max(q.bl.y, q.br.y) - Math.min(q.tl.y, q.tr.y);
    if (detW / detH < 1.3) return `card aspect ratio ${(detW/detH).toFixed(2)} is wrong — a landscape business card should be ~1.75:1 (wider than tall). Return the FULL card width.`;
    if (detW < w * 0.35) return `card width ${detW}px is only ${(detW/w*100).toFixed(0)}% of image — too narrow. The full card should span at least 40% of the image width.`;
  }

  return null;
}

function clampQuad(q: QuadPoints, w: number, h: number): QuadPoints {
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(w, Math.round(p.x))),
    y: Math.max(0, Math.min(h, Math.round(p.y))),
  });
  return { tl: clamp(q.tl), tr: clamp(q.tr), br: clamp(q.br), bl: clamp(q.bl) };
}

/** Denormalize 0-1 coordinates to pixel coordinates. */
function denormalize(raw: any, w: number, h: number): QuadPoints {
  const toPixel = (p: { x: number; y: number }) => {
    // Handle both normalized (0-1) and already-pixel coordinates
    const xNorm = p.x <= 1.0 ? p.x : p.x / w;
    const yNorm = p.y <= 1.0 ? p.y : p.y / h;
    return {
      x: Math.round(xNorm * w),
      y: Math.round(yNorm * h),
    };
  };
  return {
    tl: toPixel(raw.tl),
    tr: toPixel(raw.tr),
    br: toPixel(raw.br),
    bl: toPixel(raw.bl),
  };
}

function parseJson(raw: string): any {
  const cleaned = raw.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in response");
  return JSON.parse(match[0]);
}

/**
 * Post-process quad for known issues:
 * - Wall surfaces at image edge: trim right to avoid watermarks/borders
 */
function postProcessQuad(quad: QuadPoints, surfaceType: string, w: number, h: number): QuadPoints {
  const q = { ...quad };

  // For walls detected at full image width, trim 14% from right edge (watermarks, borders, trees)
  if (surfaceType === "wall" || surfaceType === "billboard") {
    const rightPct = Math.max(q.tr.x, q.br.x) / w;
    if (rightPct > 0.88) {
      const trim = Math.round(w * 0.14);
      q.tr = { ...q.tr, x: Math.max(q.tr.x - trim, Math.round(w * 0.65)) };
      q.br = { ...q.br, x: Math.max(q.br.x - trim, Math.round(w * 0.65)) };
    }
  }

  return q;
}

async function analyzeWithOpenAI(
  buf: Buffer,
  ext: string,
  w: number,
  h: number,
  maxRetries: number
): Promise<SurfaceAnalysis> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const mediaType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  const base64 = buf.toString("base64");
  const dataUrl = `data:${mediaType};base64,${base64}`;

  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
              { type: "text", text: makePrompt(w, h, attempt, lastError) },
            ],
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? "";
      const data = parseJson(raw);

      // Denormalize coordinates (0-1 → pixels)
      const rawQuad = denormalize({ tl: data.tl, tr: data.tr, br: data.br, bl: data.bl }, w, h);
      const quad = clampQuad(rawQuad, w, h);

      const surfaceType = data.surfaceType ?? "other";
      const err = validateQuad(quad, w, h, surfaceType);
      if (err) {
        lastError = `${err}`;
        console.warn(`[photo-analyze] attempt ${attempt}: ${err}`);
        continue;
      }

      const finalQuad = postProcessQuad(quad, surfaceType, w, h);

      return {
        quad: finalQuad,
        surfaceType,
        material: data.material ?? "matte",
        hasOcclusion: !!data.hasOcclusion,
        occlusionDesc: data.occlusionDesc ?? "",
        lightingDir: data.lightingDir ?? "ambient",
        confidence: Math.max(0, Math.min(1, data.confidence ?? 0.8)),
        imageWidth: w,
        imageHeight: h,
      };
    } catch (err: any) {
      lastError = `${err?.message ?? err}`;
      console.error(`[photo-analyze] GPT-4o attempt ${attempt}: ${lastError}`);
      if (attempt === maxRetries) break;
    }
  }

  throw new Error(`GPT-4o detection failed after ${maxRetries} attempts. Last: ${lastError}`);
}

async function analyzeWithGemini(
  buf: Buffer,
  ext: string,
  w: number,
  h: number,
  maxRetries: number
): Promise<SurfaceAnalysis> {
  const mediaType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  const base64 = buf.toString("base64");

  let lastError = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { inline_data: { mime_type: mediaType, data: base64 } },
                  { text: makePrompt(w, h, attempt, lastError) },
                ],
              },
            ],
            generationConfig: { maxOutputTokens: 512, temperature: 0.1 },
          }),
        }
      );

      const json = await res.json();
      const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const data = parseJson(raw);

      const rawQuad = denormalize({ tl: data.tl, tr: data.tr, br: data.br, bl: data.bl }, w, h);
      const quad = clampQuad(rawQuad, w, h);

      const surfaceType = data.surfaceType ?? "other";
      const err = validateQuad(quad, w, h, surfaceType);
      if (err) {
        lastError = `${err}`;
        console.warn(`[photo-analyze] Gemini attempt ${attempt}: ${err}`);
        continue;
      }

      const finalQuad = postProcessQuad(quad, surfaceType, w, h);

      return {
        quad: finalQuad,
        surfaceType: data.surfaceType ?? "other",
        material: data.material ?? "matte",
        hasOcclusion: !!data.hasOcclusion,
        occlusionDesc: data.occlusionDesc ?? "",
        lightingDir: data.lightingDir ?? "ambient",
        confidence: Math.max(0, Math.min(1, data.confidence ?? 0.8)),
        imageWidth: w,
        imageHeight: h,
      };
    } catch (err: any) {
      lastError = `${err?.message ?? err}`;
      console.error(`[photo-analyze] Gemini attempt ${attempt}: ${lastError}`);
      if (attempt === maxRetries) break;
    }
  }

  throw new Error(`Gemini detection failed after ${maxRetries} attempts. Last: ${lastError}`);
}

export async function analyzePhoto(
  photoPath: string,
  imageWidth: number,
  imageHeight: number,
  maxRetries = 3
): Promise<SurfaceAnalysis> {
  const buf = await readFile(photoPath);
  const ext = photoPath.split(".").pop()?.toLowerCase() ?? "png";

  if (process.env.OPENAI_API_KEY) {
    console.log("[photo-analyze] Using GPT-4o Vision (normalized coords)");
    return analyzeWithOpenAI(buf, ext, imageWidth, imageHeight, maxRetries);
  }

  if (process.env.GEMINI_API_KEY) {
    console.log("[photo-analyze] Using Gemini 2.0 Flash Vision");
    return analyzeWithGemini(buf, ext, imageWidth, imageHeight, maxRetries);
  }

  throw new Error(
    "No vision LLM key available. Set OPENAI_API_KEY or GEMINI_API_KEY in .env.local"
  );
}
