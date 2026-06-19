/**
 * depth — estimação de mapa de profundidade da cena. Dois caminhos:
 *
 *   1. **DepthAnything-V2** via Replicate (`adirik/depth-anything-v2`) — quando há
 *      `REPLICATE_API_TOKEN`. Modelo SOTA pra mono-depth, gratuito-ish (~$0.003).
 *
 *   2. **Fallback luminance** — gradiente de luminância suavizado. Não é depth
 *      real, mas captura "concavidades" macro (sombras=longe, highlights=perto).
 *      Mantém o sistema funcionando offline e dá um sinal usável pra superfícies
 *      texturizadas (camiseta dobrada, papel amassado).
 *
 * Output em ambos: PNG single-channel (gray 0–255, branco=perto / preto=longe).
 */
import sharp from "sharp";
import { readFile } from "fs/promises";

export interface DepthMap { png: Buffer; w: number; h: number; provider: "depth-anything-v2" | "luminance" }

// chenxwh/depth-anything-v2 — version verificada via API Replicate em 2026-06.
const DEPTH_ANYTHING_VERSION = "b239ea33cff32bb7abb5db39ffe9a09c14cbc2894331d1ef66fe096eed88ebd4";

async function toDataUrl(input: string | Buffer): Promise<string> {
  const buf = typeof input === "string" ? await readFile(input) : input;
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function pollPrediction(getUrl: string, token: string, timeoutMs: number): Promise<{ output: unknown }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json() as { status?: string; output?: unknown };
    if (j.status === "succeeded") return j as { output: unknown };
    if (j.status === "failed" || j.status === "canceled") throw new Error(`depth poll ${j.status}`);
  }
  throw new Error("depth poll timeout");
}

async function tryReplicate(input: string | Buffer, W: number, H: number): Promise<DepthMap | null> {
  const token = process.env.REPLICATE_API_TOKEN; if (!token) return null;
  try {
    const dataUrl = await toDataUrl(input);
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // schema real: { image, model_size } — "Small" é o mais rápido (~1s GPU).
      body: JSON.stringify({ version: DEPTH_ANYTHING_VERSION, input: { image: dataUrl, model_size: "Small" } }),
    });
    if (!res.ok) return null;
    let pred = await res.json() as { status: string; output?: string; urls?: { get: string } };
    if (pred.status !== "succeeded") {
      const got = pred.urls?.get; if (!got) return null;
      pred = await pollPrediction(got, token, 45000) as never;
    }
    const url = typeof pred.output === "string" ? pred.output : Array.isArray(pred.output) ? pred.output[0] : null;
    if (!url) return null;
    const imgBuf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const png = await sharp(imgBuf).resize(W, H, { fit: "fill" }).grayscale().png().toBuffer();
    return { png, w: W, h: H, provider: "depth-anything-v2" };
  } catch { return null; }
}

/** Fallback heurístico — luminance blur. "Depth" só estrutural, não absoluta. */
async function luminanceDepth(input: string | Buffer, W: number, H: number): Promise<DepthMap> {
  const png = await sharp(input).resize(W, H, { fit: "fill" }).grayscale().blur(8).png().toBuffer();
  return { png, w: W, h: H, provider: "luminance" };
}

/** Estima depth da cena (ou de um recorte). */
export async function estimateDepth(input: string | Buffer, W: number, H: number): Promise<DepthMap> {
  const r = await tryReplicate(input, W, H);
  if (r) return r;
  return luminanceDepth(input, W, H);
}
