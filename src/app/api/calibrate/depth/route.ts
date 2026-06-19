/**
 * POST /api/calibrate/depth { name, dir? }
 *
 * Devolve o **depth map** da cena (PNG gray, branco=perto). Cliente carrega no
 * canvas, amostra nos nós da malha via `meshFromDepth` e gera mesh 3D-aware.
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { resolveDir } from "@/lib/quad-store";
import { estimateDepth } from "@/lib/depth";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const name = safeName(body.name);
  if (!name) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  const dir = resolveDir(body.dir);
  const full = join(dir, name);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });

  try {
    const meta = await sharp(full).metadata();
    const W = Math.min(meta.width ?? 1024, 1024);
    const H = Math.round((meta.height ?? 1024) * (W / (meta.width || 1024)));
    const depth = await estimateDepth(full, W, H);
    return new NextResponse(new Uint8Array(depth.png), {
      headers: {
        "Content-Type": "image/png", "Cache-Control": "no-store",
        "X-Depth-Provider": depth.provider, "X-Depth-W": String(W), "X-Depth-H": String(H),
        "Server-Timing": `depth;dur=${Date.now() - t0}`,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "depth failed" }, { status: 500 });
  }
}
