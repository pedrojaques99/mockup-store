import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { analyzePhoto } from "@/lib/photo-analyze";

const TMP_DIR  = join(process.cwd(), ".tmp",  "photo-scenes");
const DATA_DIR = join(process.cwd(), "data", "photo-scenes");

export async function POST(req: NextRequest) {
  const { id, force } = await req.json();

  if (!id || typeof id !== "string" || !/^[a-f0-9]{16}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "No vision LLM key — set OPENAI_API_KEY or GEMINI_API_KEY in .env.local" }, { status: 500 });
  }

  // Prefer permanent data dir (published scenes) over temp
  const dataScene = join(DATA_DIR, id);
  const dir = existsSync(dataScene) ? dataScene : join(TMP_DIR, id);

  const metaPath     = join(dir, "meta.json");
  const analysisPath = join(dir, "analysis.json");

  if (!existsSync(metaPath)) {
    return NextResponse.json({ error: "Photo not found. Upload first." }, { status: 404 });
  }

  // Return cached analysis unless force=true
  if (!force && existsSync(analysisPath)) {
    const cached = JSON.parse(await readFile(analysisPath, "utf-8"));
    return NextResponse.json({ ...cached, cached: true });
  }

  const { ext, width, height } = JSON.parse(await readFile(metaPath, "utf-8"));
  const photoPath = join(dir, `photo.${ext}`);

  try {
    const analysis = await analyzePhoto(photoPath, width, height);
    const payload = { ...analysis, id };
    await writeFile(analysisPath, JSON.stringify(payload, null, 2));
    return NextResponse.json({ ...payload, cached: false });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
