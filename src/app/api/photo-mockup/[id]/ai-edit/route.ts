import { NextRequest, NextResponse } from "next/server";

/**
 * AI edit por máscara. Cascata de provedores, do mais barato ao mais caro:
 *   1) Replicate FLUX Fill (inpaint/outpaint por máscara) — barato, sem depender
 *      de deploy na visantlabs-os. Usado quando há máscara + REPLICATE_API_TOKEN.
 *   2) Visant inpaint (OpenAI images.edit) — se Replicate indisponível.
 *   3) change-object (prompt-only) — fallback final quando não há máscara/inpaint.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.imageBase64 !== "string") {
    return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
  }
  const mode: "replace" | "remove" | "retouch" = ["replace", "remove", "retouch"].includes(body.mode) ? body.mode : "replace";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const resolution: "1K" | "2K" | "4K" = ["1K", "2K", "4K"].includes(body.resolution) ? body.resolution : "2K";
  const maskBase64 = typeof body.maskBase64 === "string" ? body.maskBase64 : "";

  if (mode === "replace" && !prompt) {
    return NextResponse.json({ error: "prompt obrigatório para Substituir" }, { status: 400 });
  }

  // 1) Replicate FLUX Fill — barato, por máscara. Preferido quando disponível.
  if (maskBase64) {
    const { hasReplicate, fluxFillEdit } = await import("@/lib/replicate-edit");
    if (hasReplicate()) {
      try {
        const fillPrompt = prompt || (mode === "remove"
          ? "clean background, seamlessly filled, photorealistic"
          : "high quality, photorealistic, seamless");
        const r = await fluxFillEdit({ imageDataUrl: body.imageBase64, maskDataUrl: maskBase64, prompt: fillPrompt });
        return NextResponse.json({ base64: r.base64, via: "flux-fill" });
      } catch (e: any) {
        // FLUX falhou → tenta os provedores Visant abaixo (não derruba a request)
        console.warn("[ai-edit] FLUX Fill falhou, tentando Visant:", e?.message);
      }
    }
  }

  const { inpaintMask, changeObjectImage } = await import("@/lib/visant");

  try {
    if (!maskBase64) throw new Error("NO_MASK");
    const r = await inpaintMask({ imageDataUrl: body.imageBase64, maskBase64, prompt, mode, resolution });
    return NextResponse.json({ base64: r.base64, imageUrl: r.imageUrl, via: "inpaint" });
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    const recoverable = /\b404\b|\b501\b|NO_MASK|not found|cannot post/i.test(msg);
    if (recoverable && prompt) {
      try {
        const r = await changeObjectImage({ dataUrl: body.imageBase64, newObject: prompt, resolution });
        return NextResponse.json({ base64: r.base64, via: "change-object", fallback: true });
      } catch (e2: any) {
        return NextResponse.json({ error: e2?.message ?? "falha no change-object" }, { status: 500 });
      }
    }
    return NextResponse.json({ error: msg || "falha na edição IA" }, { status: 500 });
  }
}
