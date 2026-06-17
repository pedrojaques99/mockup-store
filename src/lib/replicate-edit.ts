/**
 * Edição/inpaint/outpaint via Replicate FLUX Fill Dev — muito mais barato que o
 * gpt-image da OpenAI. Reusa o mesmo padrão de poll do ai-blend.ts.
 *
 * Convenção de máscara do FLUX Fill: BRANCO = área a gerar (fill), PRETO = manter.
 * Bate com as máscaras do editor (white = seleção/borda nova).
 *
 * Requer REPLICATE_API_TOKEN no ambiente.
 */

const MODEL_URL = "https://api.replicate.com/v1/models/black-forest-labs/flux-fill-dev/predictions";

async function pollUntilDone(pollUrl: string, token: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const p = await (await fetch(pollUrl, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (p.status === "succeeded") return p;
    if (p.status === "failed" || p.status === "canceled") throw new Error(`FLUX Fill: ${p.error ?? p.status}`);
  }
  throw new Error("FLUX Fill: timeout");
}

export function hasReplicate(): boolean {
  return !!process.env.REPLICATE_API_TOKEN;
}

/**
 * Inpaint/outpaint por máscara via FLUX Fill Dev.
 * @returns data-URL PNG do resultado.
 */
export async function fluxFillEdit(p: {
  imageDataUrl: string;
  maskDataUrl: string;
  prompt: string;
  steps?: number;
  timeoutMs?: number;
}): Promise<{ base64: string }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");

  let prediction: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(MODEL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          image: p.imageDataUrl,
          mask: p.maskDataUrl,
          prompt: p.prompt || "",
          num_inference_steps: p.steps ?? 28,
          guidance: 30,
          output_format: "png",
          output_quality: 90,
          disable_safety_checker: true,
        },
      }),
    });

    if (res.status === 429) {
      const body = await res.json().catch(() => ({} as any));
      await new Promise((r) => setTimeout(r, (((body as any).retry_after ?? 10) + 1) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`FLUX Fill: ${res.status} ${await res.text().catch(() => "")}`);
    prediction = await res.json();
    break;
  }

  if (!prediction) throw new Error("FLUX Fill: rate-limit esgotado");
  if (prediction.status !== "succeeded") {
    prediction = await pollUntilDone(prediction.urls?.get, token, p.timeoutMs ?? 120000);
  }

  const out = prediction.output;
  const url: string | null = typeof out === "string" ? out : Array.isArray(out) ? out[0] ?? null : null;
  if (!url) throw new Error("FLUX Fill: sem output");

  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  return { base64: `data:image/png;base64,${buf.toString("base64")}` };
}
