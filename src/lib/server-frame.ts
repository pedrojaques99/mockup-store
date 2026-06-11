// Enquadramento server-side da arte no aspect do smart object — porta do
// art-frame.ts para o servidor usando sharp (já dependência do render).
// Usado pela API do agente, que não tem o framer client-side.

import sharp from "sharp";
import { exportSize, type FitMode } from "@/lib/art-frame";

export interface ServerFrameOptions {
  mode: FitMode;
  /** Cor de fundo pro modo contain (hex tipo "#ffffff"). null/undefined = transparente. */
  bg?: string | null;
  /** Margem proporcional em volta da arte no contain (0.12 = 12% por lado). */
  padding?: number;
}

function hexToRgba(hex: string | null | undefined) {
  if (!hex) return { r: 0, g: 0, b: 0, alpha: 0 };
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0, alpha: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

/**
 * Enquadra a arte (qualquer formato que o sharp leia, SVG incluso) nas
 * dimensões internas do smart object. Retorna PNG.
 */
export async function frameArt(
  art: Buffer,
  soWidth: number,
  soHeight: number,
  opts: ServerFrameOptions
): Promise<Buffer> {
  const { width: outW, height: outH } = exportSize(soWidth, soHeight);
  const background = hexToRgba(opts.bg);

  if (opts.mode === "stretch") {
    return sharp(art).resize(outW, outH, { fit: "fill" }).png().toBuffer();
  }

  if (opts.mode === "contain") {
    const pad = Math.min(Math.max(opts.padding ?? 0, 0), 0.4);
    const innerW = Math.max(1, Math.round(outW * (1 - 2 * pad)));
    const innerH = Math.max(1, Math.round(outH * (1 - 2 * pad)));
    const inner = await sharp(art)
      .resize(innerW, innerH, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
    const meta = await sharp(inner).metadata();
    const left = Math.round((outW - (meta.width || innerW)) / 2);
    const top = Math.round((outH - (meta.height || innerH)) / 2);
    return sharp({
      create: { width: outW, height: outH, channels: 4, background },
    })
      .composite([{ input: inner, left, top }])
      .png()
      .toBuffer();
  }

  // cover (default): crop central no aspect do SO
  return sharp(art)
    .resize(outW, outH, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
}
