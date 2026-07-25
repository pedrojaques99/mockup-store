/**
 * POST /api/photo-mockup/[id]/publish
 * Saves the finished render to the mockup library (community_presets).
 *
 * Body: { name: string, renderBase64: string, tags?: string[] }
 * - Copies .tmp/photo-scenes/{id} → data/photo-scenes/{id} (permanent)
 * - Saves preview WebP (thumbnail, ~640px) to public/photo-previews/{id}.webp
 * - Inserts community_presets document (type:"photo")
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir, copyFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { getDb } from "@/lib/db";
import { logFeedback, relearn, hashImage } from "@/lib/engine-feedback";
import { invalidateCatalog } from "@/lib/search-index";
import { PREVIEW_MAX_WIDTH, PREVIEW_WEBP_QUALITY } from "@/lib/agent-mockup";

const TMP_DIR  = join(process.cwd(), ".tmp", "photo-scenes");
const DATA_DIR = join(process.cwd(), "data", "photo-scenes");
const PREV_DIR = join(process.cwd(), "public", "photo-previews");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || !/^[a-f0-9]{16}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const body = await req.json();
  const { name, renderBase64, settings, tags } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!renderBase64 || typeof renderBase64 !== "string") {
    return NextResponse.json({ error: "renderBase64 required" }, { status: 400 });
  }

  // Find scene — prefer already-saved permanent location
  const tmpDir  = join(TMP_DIR, id);
  const dataDir = join(DATA_DIR, id);
  const sceneDir = existsSync(dataDir) ? dataDir : existsSync(tmpDir) ? tmpDir : null;

  if (!sceneDir) {
    return NextResponse.json({ error: "Scene not found. Process the photo first." }, { status: 404 });
  }

  const analysisPath = join(sceneDir, "analysis.json");
  if (!existsSync(analysisPath)) {
    return NextResponse.json({ error: "analysis.json missing — run process step first." }, { status: 400 });
  }

  const analysis = JSON.parse(await readFile(analysisPath, "utf-8"));
  const { surfaceType = "surface" } = analysis;

  // 1. Copy to permanent data/photo-scenes/{id} (skip if already there)
  if (sceneDir === tmpDir) {
    await mkdir(dataDir, { recursive: true });
    const files = await readdir(tmpDir);
    await Promise.all(files.map(f => copyFile(join(tmpDir, f), join(dataDir, f))));
  }

  // 2. Save render as grid thumbnail only — NUNCA o PNG cru do render (full-res).
  // Achado do audit de performance: public/photo-previews/ tinha 130 arquivos somando
  // ~507 MB (média 3,9 MB, pico 17,5 MB) pra um card de grid que a home pede 60 por
  // página. sharp() já é dependência do projeto — reduz pra ~640px de largura e grava
  // WebP q80 (o card nunca precisou do full-res).
  await mkdir(PREV_DIR, { recursive: true });
  const renderBuf = Buffer.from(renderBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const previewBuf = await sharp(renderBuf)
    .resize({ width: PREVIEW_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: PREVIEW_WEBP_QUALITY })
    .toBuffer();
  const saves: Promise<void>[] = [
    writeFile(join(PREV_DIR, `${id}.webp`), previewBuf),
  ];
  // MERGE, nunca overwrite: `studio`/`tags` do settings.json são escritos por fora
  // (`photo-agent tag`) e a UI não os manda de volta. Sobrescrever o arquivo apagava o
  // estúdio da cena no disco — e ela sumia do filtro por estúdio do grid, sem volta.
  const settingsPath = join(dataDir, "settings.json");
  let prevSettings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try { prevSettings = JSON.parse(await readFile(settingsPath, "utf-8")); } catch { /* corrompido — recomeça */ }
  }
  if (settings && typeof settings === "object") {
    saves.push(writeFile(settingsPath, JSON.stringify({ ...prevSettings, ...settings }, null, 2)));
  }
  await Promise.all(saves);

  // 3. Upsert community_presets document
  const db  = await getDb();
  const col = db.collection("community_presets");

  const now = new Date().toISOString();
  const extraTags = Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === "string") : [];
  // `settings.json` é o SSoT de studio/tags da cena (quem escreve: `photo-agent tag`).
  // Publicar NUNCA pode chapar isso — senão o filtro por estúdio do grid perde a cena.
  const merged = { ...prevSettings, ...(settings ?? {}) } as Record<string, unknown>;
  const sceneStudio =
    (typeof merged.studio === "string" && merged.studio.trim()) ||
    (typeof body.studio === "string" && body.studio.trim()) ||
    "Photo Scene";
  const settingsTags = Array.isArray(merged.tags)
    ? (merged.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const doc = {
    id,
    name: name.trim(),
    studio: sceneStudio,
    description: `${surfaceType} photo mockup`,
    referenceImageUrl: `/photo-previews/${id}.webp`,
    category: "reference",
    isAdminCurated: true,
    type: "photo",
    photoSceneId: id,
    tags: [...new Set([surfaceType, "photo", "photo-pipeline", ...extraTags, ...settingsTags])],
    dimensions: { mockup_type: [surfaceType] },
    prompt: "",
    createdAt: now,
    updatedAt: now,
  };

  await col.updateOne({ id }, { $set: doc }, { upsert: true });

  // O catálogo da busca é cacheado — sem isto a cena recém-publicada demora o TTL pra
  // aparecer no grid (e com o estúdio velho).
  invalidateCatalog();

  // Retro-alimentação do engine: (auto = analysis.quad) × (final = settings.quad corrigido
  // pelo humano). Todo publish vira ground-truth pro detector aprender. Best-effort.
  try {
    const autoQuad = analysis.quad;
    const finalQuad = settings?.quad ?? autoQuad;
    if (autoQuad && finalQuad) {
      let sceneHash = "";
      try {
        const metaRaw = JSON.parse(await readFile(join(sceneDir, "meta.json"), "utf-8"));
        sceneHash = await hashImage(join(sceneDir, `photo.${metaRaw.ext || "png"}`));
      } catch { /* hash best-effort */ }
      const tenant = (req.headers.get("x-tenant") || (typeof body.tenant === "string" ? body.tenant : "")).trim() || undefined;
      await logFeedback({
        tenant, sceneHash, name: id, source: "photo-mockup", outcome: "publish",
        surfaceType, auto: autoQuad, final: finalQuad,
        disp: { scale: settings?.dispScale, blur: settings?.preBlur },
        material: settings?.surfaceMaterial ? {
          kind: settings.surfaceMaterial,
          intensity: settings.surfaceMaterialIntensity,
          angle: settings.surfaceMaterialAngle,
          scale: settings.surfaceMaterialScale,
        } : undefined,
        // SELF-LEARNING LOOP — substrato confirmado pelo humano (override ou aceite
        // do detectado) vai pro engine-profile.substrateCounts e boosta o ranking
        // da PRÓXIMA cena (tanto no /calibrate quanto aqui no photo-mockup analyze).
        // Contribui pro _global E pro tenant (se header `x-tenant` enviado).
        substrate: typeof settings?.substrate === "string" ? settings.substrate : undefined,
      });
      relearn().catch(() => {});
      if (tenant) relearn(tenant).catch(() => {});
    }
  } catch { /* feedback nunca bloqueia o publish */ }

  return NextResponse.json({ id, previewUrl: `/photo-previews/${id}.webp` });
}
