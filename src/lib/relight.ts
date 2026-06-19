/**
 * relight — inverse rendering. Recebe a ARTE (subject) + um PROMPT descrevendo
 * a iluminação alvo (derivado da cena ou fornecido), retorna a arte relit.
 *
 * Provider: `zsxkib/ic-light` (Replicate). Schema real:
 *   { prompt, light_source, image?, width, height, cfg, steps, seed, ... }
 *
 * IC-Light é text-guided — vc passa um prompt tipo "soft warm light from the left,
 * outdoor afternoon". Se o caller quiser inferir o prompt da cena, MLLM (já
 * implementado em `ai-vision`) pode descrever a luz e passar aqui.
 *
 * Fallback (sem token): null + UI mostra "configure REPLICATE_API_TOKEN".
 */
import sharp from "sharp";
import { readFile } from "fs/promises";

// zsxkib/ic-light — version verificada via API Replicate.
const IC_LIGHT_VERSION = "d41bcb10d8c159868f4cfbd7c6a2ca01484f7d39e4613419d5952c61562f1ba7";

async function toDataUrl(input: string | Buffer): Promise<string> {
  const buf = typeof input === "string" ? await readFile(input) : input;
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function pollPrediction(getUrl: string, token: string, timeoutMs: number): Promise<{ output: unknown }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json() as { status?: string; output?: unknown };
    if (j.status === "succeeded") return j as { output: unknown };
    if (j.status === "failed" || j.status === "canceled") throw new Error(`relight ${j.status}`);
  }
  throw new Error("relight timeout");
}

export interface RelightResult { png: Buffer; provider: "ic-light" }

export async function relight(
  artInput: string | Buffer,
  _sceneInput: string | Buffer,           // mantido p/ API compat; IC-Light é text-guided
  opts: { prompt?: string; lightSource?: string; width?: number; height?: number } = {},
): Promise<RelightResult | null> {
  const token = process.env.REPLICATE_API_TOKEN; if (!token) return null;
  try {
    const artBuf = typeof artInput === "string" ? await readFile(artInput) : artInput;
    const m = await sharp(artBuf).metadata();
    const W = opts.width ?? Math.min(1024, m.width ?? 1024);
    const H = opts.height ?? Math.min(1024, m.height ?? 1024);
    const artUrl = await toDataUrl(artBuf);
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        version: IC_LIGHT_VERSION,
        input: {
          image: artUrl,
          prompt: opts.prompt ?? "natural cinematic lighting, soft shadows, photoreal",
          light_source: opts.lightSource ?? "Left Light",
          width: W, height: H,
          cfg: 2, steps: 25, highres_scale: 1.0,
        },
      }),
    });
    if (!res.ok) return null;
    let pred = await res.json() as { status: string; output?: unknown; urls?: { get: string } };
    if (pred.status !== "succeeded") {
      const got = pred.urls?.get; if (!got) return null;
      pred = await pollPrediction(got, token, 90000) as never;
    }
    const url = typeof pred.output === "string" ? pred.output : Array.isArray(pred.output) ? pred.output[0] : null;
    if (!url) return null;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    return { png: buf, provider: "ic-light" };
  } catch { return null; }
}
