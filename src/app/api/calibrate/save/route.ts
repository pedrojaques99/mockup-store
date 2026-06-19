import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";
import { quadIoU, type QuadCorners } from "@/lib/key-color-core";
import { upsertQuad, resolveDir, type QuadEntry } from "@/lib/quad-store";
import { logFeedback, relearn, hashImage } from "@/lib/engine-feedback";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

function validQuad(q: any): q is QuadCorners {
  return q && ["tl", "tr", "br", "bl"].every(
    (k) => q[k] && typeof q[k].x === "number" && typeof q[k].y === "number",
  );
}

/** Salva o quad corrigido no golden, gravando auto+manual+IoU para a camada de inteligência. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const safe = safeName(body.name);
  if (!safe) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  if (!validQuad(body.quad)) return NextResponse.json({ error: "quad inválido" }, { status: 400 });

  const dir = resolveDir(body.dir);
  const full = join(dir, safe);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });

  const m = await sharp(full).metadata();
  const auto: QuadCorners | undefined = validQuad(body.auto) ? body.auto : undefined;
  const num = (v: unknown) => (typeof v === "number" && !Number.isNaN(v) ? v : undefined);

  const entry: QuadEntry = {
    quad: body.quad,
    auto,
    method: typeof body.method === "string" ? body.method : "key-color",
    surfaceType: typeof body.surfaceType === "string" ? body.surfaceType : "billboard",
    hue: num(body.hue),
    source: "manual",
    confidence: num(body.confidence),
    iou: auto ? quadIoU(auto, body.quad) : undefined,
    detectorVersion: num(body.detectorVersion),
    dispScale: num(body.dispScale),
    dispBlur: num(body.dispBlur),
    material: typeof body.material === "string" ? body.material : undefined,
    materialIntensity: num(body.materialIntensity),
    materialAngle: num(body.materialAngle),
    materialScale: num(body.materialScale),
    mesh: body.mesh && typeof body.mesh === "object" && Array.isArray(body.mesh.points) ? body.mesh : undefined,
    substrate: typeof body.substrate === "string" ? body.substrate : undefined,
    imageWidth: m.width ?? 0,
    imageHeight: m.height ?? 0,
    savedAt: Date.now(),
  };

  // Máscara da superfície — PNG sidecar `<name>.mask.png` (escopo da cena),
  // referenciado em `surfaceMaskRel`. SSoT compartilhado com o photo-mockup editor.
  if (typeof body.surfaceMaskBase64 === "string" && body.surfaceMaskBase64.length > 32) {
    try {
      const b64 = body.surfaceMaskBase64.replace(/^data:image\/\w+;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      const maskName = `${safe.replace(/\.[^.]+$/, "")}.mask.png`;
      await writeFile(join(dir, maskName), buf);
      entry.surfaceMaskRel = maskName;
    } catch { /* mask inválida — ignora, segue salvando o resto */ }
  } else if (typeof body.surfaceMaskRel === "string") {
    entry.surfaceMaskRel = body.surfaceMaskRel; // preserva existente
  }

  const saved = await upsertQuad(safe, entry, dir);

  // Retro-alimentação: registra o par (auto, final) e reaprende o profile (best-effort).
  // **Engine pai SSoT**: contribui pro `_global` E pro tenant (se enviado via header
  // `x-tenant` ou body.tenant) → quem usa o produto melhora a engine geral E a sua.
  if (auto) {
    const tenant = (req.headers.get("x-tenant") || (typeof body.tenant === "string" ? body.tenant : "")).trim() || undefined;
    const sceneHash = await hashImage(full).catch(() => "");
    await logFeedback({
      tenant, sceneHash, name: safe, source: "calibrate", outcome: "save",
      surfaceType: entry.surfaceType, method: entry.method, detectorVersion: entry.detectorVersion,
      auto, final: entry.quad, iou: entry.iou,
      disp: { scale: entry.dispScale, blur: entry.dispBlur },
      material: { kind: entry.material, intensity: entry.materialIntensity, angle: entry.materialAngle, scale: entry.materialScale },
      substrate: typeof body.substrate === "string" ? body.substrate : undefined,
    });
    // Reagrega global SEMPRE; tenant em paralelo se houver.
    relearn().catch(() => {});
    if (tenant) relearn(tenant).catch(() => {});
  }
  return NextResponse.json({ saved });
}
