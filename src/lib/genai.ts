/**
 * genai — adapter Replicate pra três operações generativas:
 *
 *   • inpaintMask  — Flux Fill / SDXL Inpaint (preenche região mascarada).
 *   • variation    — ControlNet (depth/canny) gera N variantes mantendo composição.
 *   • upscaleSUPIR — SUPIR (modelo SOTA pra restauração + upscale).
 *
 * Cada função retorna `null` se não houver `REPLICATE_API_TOKEN` ou o provider
 * falhar — caller pode degradar (já há rotas tradicionais p/ upscale).
 */
import { readFile } from "fs/promises";

// Versions reais (verificadas via API Replicate em 2026-06).
const FLUX_FILL_VERSION = "a053f84125613d83e65328a289e14eb6639e10725c243e8fb0c24128e5573f4c";  // black-forest-labs/flux-fill-dev
const CONTROLNET_VERSION = "06d6fae3b75ab68a28cd2900afa6033166910dd09fd9751047043a5bbb4c184b"; // lucataco/sdxl-controlnet
const SUPIR_VERSION = "1302b550b4f7681da87ed0e405016d443fe1fafd64dabce6673401855a5039b5";       // cjwbw/supir
const REAL_ESRGAN_VERSION = "b3ef194191d13140337468c916c2c5b96dd0cb06dffc032a022a31807f6a5ea8"; // nightmareai/real-esrgan — fallback rápido p/ upscale

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
    if (j.status === "failed" || j.status === "canceled") throw new Error(`replicate ${j.status}`);
  }
  throw new Error("replicate timeout");
}

async function runReplicate<T>(version: string, input: Record<string, unknown>, mapOutput: (o: unknown) => T | null, timeoutMs = 120000): Promise<T | null> {
  const token = process.env.REPLICATE_API_TOKEN; if (!token) return null;
  try {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version, input }),
    });
    if (!res.ok) return null;
    let pred = await res.json() as { status: string; output?: unknown; urls?: { get: string } };
    if (pred.status !== "succeeded") {
      const got = pred.urls?.get; if (!got) return null;
      pred = await pollPrediction(got, token, timeoutMs) as never;
    }
    return mapOutput(pred.output);
  } catch { return null; }
}

async function fetchBuf(url: string): Promise<Buffer> {
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

export interface GenResult { png: Buffer; provider: string }

/** Preenche a área branca da `mask` com algo que combine com `image` + `prompt`.
 *  Schema real do Flux Fill: { image, mask, prompt, guidance, num_outputs, ... }. */
export async function inpaintMask(
  image: string | Buffer, mask: string | Buffer, prompt: string,
): Promise<GenResult | null> {
  const [imgUrl, maskUrl] = await Promise.all([toDataUrl(image), toDataUrl(mask)]);
  const url = await runReplicate<string>(FLUX_FILL_VERSION, {
    image: imgUrl, mask: maskUrl, prompt, guidance: 30, num_outputs: 1, megapixels: "1",
  }, (o) => typeof o === "string" ? o : Array.isArray(o) ? (o[0] as string) : null);
  if (!url) return null;
  return { png: await fetchBuf(url), provider: "flux-fill" };
}

/** Gera N variantes mantendo composição da imagem original via SDXL ControlNet.
 *  Schema real (lucataco/sdxl-controlnet): { image, prompt, condition_scale, num_inference_steps, ... }
 *  ⚠ Esse modelo retorna 1 imagem por call — fazemos N requests paralelas com seeds. */
export async function variation(
  image: string | Buffer, prompt: string, n = 3,
): Promise<GenResult[] | null> {
  const imgUrl = await toDataUrl(image);
  const reqs = Array.from({ length: Math.max(1, Math.min(4, n)) }, (_, i) =>
    runReplicate<string>(CONTROLNET_VERSION, {
      image: imgUrl, prompt, condition_scale: 0.85, num_inference_steps: 30, seed: 1000 + i,
    }, (o) => typeof o === "string" ? o : Array.isArray(o) ? (o[0] as string) : null),
  );
  const urls = (await Promise.all(reqs)).filter((u): u is string => !!u);
  if (!urls.length) return null;
  const bufs = await Promise.all(urls.map(fetchBuf));
  return bufs.map((png) => ({ png, provider: "controlnet" }));
}

/** Upscale fotorrealista via SUPIR (schema real: { image, upscale, s_cfg, ... }).
 *  Falha → tenta Real-ESRGAN (mais barato/rápido) como fallback automático. */
export async function upscaleSUPIR(
  image: string | Buffer, scale = 2,
): Promise<GenResult | null> {
  const imgUrl = await toDataUrl(image);
  const url = await runReplicate<string>(SUPIR_VERSION, {
    image: imgUrl, upscale: scale, s_cfg: 7.5, s_churn: 5, s_noise: 1.003, min_size: 1024,
    a_prompt: "high quality, detailed, sharp focus",
  }, (o) => typeof o === "string" ? o : Array.isArray(o) ? (o[0] as string) : null);
  if (url) return { png: await fetchBuf(url), provider: "supir" };
  // fallback: Real-ESRGAN (verified, ~5× mais rápido, sem face enhance)
  const url2 = await runReplicate<string>(REAL_ESRGAN_VERSION, {
    image: imgUrl, scale, face_enhance: false,
  }, (o) => typeof o === "string" ? o : Array.isArray(o) ? (o[0] as string) : null);
  if (!url2) return null;
  return { png: await fetchBuf(url2), provider: "real-esrgan" };
}
