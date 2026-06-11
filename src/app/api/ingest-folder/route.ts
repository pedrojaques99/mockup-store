import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { addRuntimeDir } from "@/lib/psd-index";
import { walkDir } from "@/lib/fs-walk";
import { scanPsd, IMAGE_EXTS } from "@/lib/psd-scan";
import { existsSync } from "fs";

const ALL_EXTS = new Set([...IMAGE_EXTS, ".psd"]);

function makeRefDoc(fields: {
  name: string;
  studio: string;
  referenceImageUrl: string;
  sourcePath: string;
  psdFileName?: string;
  psdPath?: string;
  seq: number;
  prefix: string;
}) {
  return {
    id: `local-${Date.now()}-${fields.prefix}-${fields.seq}`,
    name: fields.name,
    studio: fields.studio,
    description: "",
    referenceImageUrl: fields.referenceImageUrl,
    dimensions: {},
    tags: [fields.studio],
    category: "reference",
    isAdminCurated: true,
    source: "local-ingest",
    sourcePath: fields.sourcePath,
    psdFileName: fields.psdFileName,
    psdPath: fields.psdPath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  const { folderPath } = await req.json();
  if (!folderPath || typeof folderPath !== "string") {
    return NextResponse.json({ error: "folderPath required" }, { status: 400 });
  }

  const normalizedPath = folderPath.replace(/\\/g, "/");
  if (!existsSync(normalizedPath)) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const files = walkDir(normalizedPath, ALL_EXTS);
  const images = files.filter((f) => IMAGE_EXTS.has(f.ext));
  const psds = files.filter((f) => f.ext === ".psd");
  const folderName = normalizedPath.split("/").filter(Boolean).pop() || "Unknown";

  const db = await getDb();
  const col = db.collection("community_presets");
  const psdMetaCol = db.collection("psd_metadata");

  if (psds.length > 0) addRuntimeDir(normalizedPath);

  const psdNames = new Set(psds.map((p) => p.name.toLowerCase()));
  let created = 0;
  let skipped = 0;

  for (const img of images) {
    const existing = await col.findOne({ name: img.name, category: "reference", source: "local-ingest" });
    if (existing) { skipped++; continue; }

    const matchedPsd = psdNames.has(img.name.toLowerCase())
      ? psds.find((p) => p.name.toLowerCase() === img.name.toLowerCase())
      : null;

    await col.insertOne(makeRefDoc({
      name: img.name,
      studio: folderName,
      referenceImageUrl: `/api/local-image?path=${encodeURIComponent(img.path)}`,
      sourcePath: normalizedPath,
      psdFileName: matchedPsd?.name,
      psdPath: matchedPsd?.path,
      seq: created,
      prefix: "img",
    }));
    created++;
  }

  let psdOnly = 0;
  for (const psd of psds) {
    if (images.some((img) => img.name.toLowerCase() === psd.name.toLowerCase())) continue;

    const existing = await col.findOne({ name: psd.name, category: "reference", source: "local-ingest" });
    if (existing) continue;

    await col.insertOne(makeRefDoc({
      name: psd.name,
      studio: folderName,
      referenceImageUrl: "",
      sourcePath: normalizedPath,
      psdFileName: psd.name,
      psdPath: psd.path,
      seq: psdOnly,
      prefix: "psd",
    }));
    psdOnly++;
  }

  let scanned = 0;
  for (const psd of psds) {
    const existing = await psdMetaCol.findOne({ fileName: psd.name });
    if (existing) continue;

    const meta = scanPsd(psd.path);
    if (!meta) continue;

    await psdMetaCol.updateOne(
      { fileName: meta.fileName },
      { $set: meta },
      { upsert: true },
    );
    scanned++;
  }

  return NextResponse.json({
    folder: normalizedPath,
    images: images.length,
    psds: psds.length,
    referencesCreated: created,
    referencesSkipped: skipped,
    psdOnlyCreated: psdOnly,
    psdMetadataScanned: scanned,
  });
}
