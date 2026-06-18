/**
 * Upscale via Replicate — dois modelos como alternativa ao bicubic (local) e ao
 * Gemini (Visant). Mesmo padrão de POST+poll do replicate-edit.ts.
 *
 *  · prunaai/p-image-upscale — "o upscaler mais rápido" (<1s), até 128 MP.
 *      input: { image, upscale_mode:"factor", factor, output_format }
 *  · google/upscaler — x2/x4.
 *      input: { image, upscale_factor:"x2"|"x4", compression_quality }
 *
 * Requer REPLICATE_API_TOKEN no ambiente.
 */

export type ReplicateUpscaleModel = "pruna" | "google";
const MODEL_PATH: Record<ReplicateUpscaleModel, string> = {
  pruna: "prunaai/p-image-upscale",
  google: "google/upscaler",
};

export function hasReplicate(): boolean {
  return !!process.env.REPLICATE_API_TOKEN;
}

async function pollUntilDone(pollUrl: string, token: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await (await fetch(pollUrl, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (p.status === "succeeded") return p;
    if (p.status === "failed" || p.status === "canceled") throw new Error(`upscale: ${p.error ?? p.status}`);
  }
  throw new Error("upscale: timeout");
}

/** @returns data-URL PNG do resultado. */
export async function replicateUpscale(p: {
  model: ReplicateUpscaleModel;
  imageDataUrl: string;
  factor: number; // 2 ou 4
  timeoutMs?: number;
}): Promise<{ base64: string }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");

  const f = p.factor >= 4 ? 4 : 2;
  const input = p.model === "google"
    ? { image: p.imageDataUrl, upscale_factor: f === 4 ? "x4" : "x2", compression_quality: 95 }
    : { image: p.imageDataUrl, upscale_mode: "factor", factor: f, output_format: "png" };

  const url = `https://api.replicate.com/v1/models/${MODEL_PATH[p.model]}/predictions`;
  let prediction: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({} as any));
      await new Promise((r) => setTimeout(r, (((body as any).retry_after ?? 8) + 1) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`upscale ${p.model}: ${res.status} ${await res.text().catch(() => "")}`);
    prediction = await res.json();
    break;
  }
  if (!prediction) throw new Error(`upscale ${p.model}: rate-limit esgotado`);
  if (prediction.status !== "succeeded") {
    prediction = await pollUntilDone(prediction.urls?.get, token, p.timeoutMs ?? 120000);
  }

  const out = prediction.output;
  const outUrl: string | null = typeof out === "string" ? out : Array.isArray(out) ? out[0] ?? null : null;
  if (!outUrl) throw new Error(`upscale ${p.model}: sem output`);

  const buf = Buffer.from(await (await fetch(outUrl)).arrayBuffer());
  // Sniff do formato real (google devolve JPEG; pruna PNG) pra rotular o data-URL certo.
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg"
    : buf[0] === 0x89 && buf[1] === 0x50 ? "image/png"
    : buf.slice(8, 12).toString() === "WEBP" ? "image/webp"
    : "image/png";
  return { base64: `data:${mime};base64,${buf.toString("base64")}` };
}
