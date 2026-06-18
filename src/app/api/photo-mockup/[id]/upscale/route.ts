import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

/**
 * Upscale em dois modos:
 *  - bicubic: resample lanczos3 LOCAL (grátis, sem créditos). Bom para suavizar
 *    pixelização antes do render.
 *  - ai: detalhe generativo via Visant prod (Gemini moodboard-upscale). Custa crédito.
 *    Wired em lib/visant.ts → upscaleImage().
 * Recebe/devolve base64 (data-URL) para servir foto e arte com o mesmo endpoint.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.base64 !== "string") {
    return NextResponse.json({ error: "base64 required" }, { status: 400 });
  }

  const ALLOWED = ["bicubic", "ai", "pruna", "google"] as const;
  const mode = (ALLOWED as readonly string[]).includes(body.mode) ? body.mode : "bicubic";
  const raw = body.base64.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(raw, "base64");

  try {
    if (mode === "pruna" || mode === "google") {
      const { replicateUpscale, hasReplicate } = await import("@/lib/replicate-upscale");
      if (!hasReplicate()) {
        return NextResponse.json({ error: "REPLICATE_API_TOKEN ausente no servidor" }, { status: 400 });
      }
      const factor = Math.max(2, Math.min(4, Number(body.factor) || 2));
      const r = await replicateUpscale({ model: mode, imageDataUrl: `data:image/png;base64,${raw}`, factor });
      const outBuf = Buffer.from(r.base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const m2 = await sharp(outBuf).metadata();
      return NextResponse.json({ base64: r.base64, width: m2.width, height: m2.height, mode });
    }

    if (mode === "bicubic") {
      const factor = Math.max(1, Math.min(4, Number(body.factor) || 2));
      const meta = await sharp(buf).metadata();
      const w = Math.round((meta.width ?? 0) * factor);
      if (!w) return NextResponse.json({ error: "imagem inválida" }, { status: 400 });
      const out = await sharp(buf).resize({ width: w, kernel: "lanczos3" }).png().toBuffer();
      const m2 = await sharp(out).metadata();
      return NextResponse.json({
        base64: `data:image/png;base64,${out.toString("base64")}`,
        width: m2.width,
        height: m2.height,
        mode,
      });
    }

    // mode === "ai"
    const { upscaleImage } = await import("@/lib/visant");
    const size: "1K" | "2K" | "4K" = ["1K", "2K", "4K"].includes(body.size) ? body.size : "2K";
    const result = await upscaleImage(`data:image/png;base64,${raw}`, size);
    return NextResponse.json({ ...result, mode });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "falha no upscale" }, { status: 500 });
  }
}
