/**
 * POST /api/calibrate/batch { artBase64, scenes: string[], dir?, preview? }
 *
 * Renderiza UMA arte em N cenas calibradas. Pra cada cena carrega QuadEntry do
 * golden e renderiza usando o mesmo pipeline do `/api/calibrate/render`. Retorna
 * `{ results: [{ name, dataUrl, ms, error? }] }`. Cliente faz ZIP no browser.
 *
 * Concorrência limitada (4 paralelas) pra não estourar memória + cache do engine.
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { resolveDir, getQuad } from "@/lib/quad-store";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

interface ItemResult { name: string; dataUrl?: string; ms?: number; error?: string }

async function renderOne(name: string, dir: string, body: { artBase64: string; preview?: boolean }, baseUrl: string): Promise<ItemResult> {
  const t0 = Date.now();
  const safe = safeName(name); if (!safe) return { name, error: "nome inválido" };
  const full = join(dir, safe); if (!existsSync(full)) return { name, error: "cena não encontrada" };
  const entry = await getQuad(safe, dir); if (!entry?.quad) return { name, error: "sem calibração — calibre primeiro no /calibrate" };
  try {
    const r = await fetch(`${baseUrl}/api/calibrate/render`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: safe, dir,
        quad: entry.quad, surfaceType: entry.surfaceType,
        dispScale: entry.dispScale, dispBlur: entry.dispBlur,
        material: entry.material, materialIntensity: entry.materialIntensity,
        materialAngle: entry.materialAngle, materialScale: entry.materialScale,
        mesh: entry.mesh, preview: !!body.preview,
        artBase64: body.artBase64,
      }),
    });
    if (!r.ok) return { name, error: `render ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    return { name, dataUrl: `data:image/png;base64,${buf.toString("base64")}`, ms: Date.now() - t0 };
  } catch (e: unknown) {
    return { name, error: e instanceof Error ? e.message : "render falhou" };
  }
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const body = await req.json();
  if (!body.artBase64) return NextResponse.json({ error: "artBase64 required" }, { status: 400 });
  const scenes: string[] = Array.isArray(body.scenes) ? body.scenes.slice(0, 100) : [];
  if (!scenes.length) return NextResponse.json({ error: "scenes[] required" }, { status: 400 });
  const dir = resolveDir(body.dir);
  // Reduz arte ANTES de mandar pra cada render (corta CPU/banda em lote grande)
  let art = body.artBase64;
  try {
    const b64 = String(art).replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    const meta = await sharp(buf).metadata();
    if (meta.width && Math.max(meta.width, meta.height ?? 1) > 2048) {
      const out = await sharp(buf).resize({ width: 2048, kernel: "lanczos3" }).png().toBuffer();
      art = `data:image/png;base64,${out.toString("base64")}`;
    }
  } catch { /* mantém original */ }

  const baseUrl = new URL(req.url).origin;
  const CONC = 4;
  const results: ItemResult[] = [];
  let i = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < CONC; w++) {
    workers.push((async () => {
      while (i < scenes.length) {
        const idx = i++; const name = scenes[idx];
        results[idx] = await renderOne(name, dir, { artBase64: art, preview: body.preview }, baseUrl);
      }
    })());
  }
  await Promise.all(workers);
  return NextResponse.json({ results, ms: Date.now() - t0 }, {
    headers: { "Server-Timing": `batch;dur=${Date.now() - t0}` },
  });
}
