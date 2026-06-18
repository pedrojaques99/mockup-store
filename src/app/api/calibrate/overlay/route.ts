import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { detectDominantVividHue } from "@/lib/photo-detect";
import { isKeyColor } from "@/lib/key-color-core";
import { NEW_MOCKUPS_DIR } from "@/lib/quad-store";

function safeName(name: string | null): string | null {
  if (!name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

/**
 * PNG transparente que tinge EXATAMENTE os pixels que o detector considera key color
 * (mesmo predicado `isKeyColor`). É o feedback visual de "pixel-perfect": o que você
 * vê tingido é o que o quad tenta cobrir.
 */
export async function GET(req: NextRequest) {
  const safe = safeName(req.nextUrl.searchParams.get("name"));
  if (!safe) return NextResponse.json({ error: "nome inválido" }, { status: 400 });

  const full = join(NEW_MOCKUPS_DIR, safe);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });

  const m = await sharp(full).metadata();
  const width = m.width ?? 0, height = m.height ?? 0;

  const hue = await detectDominantVividHue(full, width, height);
  const hueOn = hue !== null;
  const hLo = hueOn ? ((hue! - 40 + 360) % 360) / 360 : NaN;
  const hHi = hueOn ? ((hue! + 40) % 360) / 360 : NaN;

  const { data, info } = await sharp(full).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const out = Buffer.alloc(width * height * 4); // RGBA transparente

  for (let p = 0, o = 0; p < width * height; p++, o += 4) {
    const i = p * ch;
    if (isKeyColor(data[i], data[i + 1], data[i + 2], hLo, hHi, 0.45)) {
      out[o] = 0; out[o + 1] = 255; out[o + 2] = 120; out[o + 3] = 150; // verde semitransparente
    }
  }

  const png = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
