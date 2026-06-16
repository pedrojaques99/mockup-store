/**
 * POST /api/photo-mockup/[id]/publish
 * Saves the finished render to the mockup library (community_presets).
 *
 * Body: { name: string, renderBase64: string, tags?: string[] }
 * - Copies .tmp/photo-scenes/{id} → data/photo-scenes/{id} (permanent)
 * - Saves preview PNG to public/photo-previews/{id}.png
 * - Inserts community_presets document (type:"photo")
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir, copyFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getDb } from "@/lib/db";

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

  // 2. Save render PNG as grid thumbnail only
  await mkdir(PREV_DIR, { recursive: true });
  const renderBuf = Buffer.from(renderBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const saves: Promise<void>[] = [
    writeFile(join(PREV_DIR, `${id}.png`), renderBuf),
  ];
  if (settings && typeof settings === "object") {
    saves.push(writeFile(join(dataDir, "settings.json"), JSON.stringify(settings, null, 2)));
  }
  await Promise.all(saves);

  // 3. Upsert community_presets document
  const db  = await getDb();
  const col = db.collection("community_presets");

  const now = new Date().toISOString();
  const extraTags = Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === "string") : [];
  const doc = {
    id,
    name: name.trim(),
    studio: "Photo Scene",
    description: `${surfaceType} photo mockup`,
    referenceImageUrl: `/photo-previews/${id}.png`,
    category: "reference",
    isAdminCurated: true,
    type: "photo",
    photoSceneId: id,
    tags: [surfaceType, "photo", "photo-pipeline", ...extraTags],
    dimensions: { mockup_type: [surfaceType] },
    prompt: "",
    createdAt: now,
    updatedAt: now,
  };

  await col.updateOne({ id }, { $set: doc }, { upsert: true });

  return NextResponse.json({ id, previewUrl: `/photo-previews/${id}.png` });
}
