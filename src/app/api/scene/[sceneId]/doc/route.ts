import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const SCENES_DIR = join(process.cwd(), ".tmp", "scenes");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sceneId: string }> }
) {
  const { sceneId } = await params;

  if (!sceneId || !/^[a-f0-9]{12}$/.test(sceneId)) {
    return NextResponse.json({ error: "invalid sceneId" }, { status: 400 });
  }

  const docPath = join(SCENES_DIR, sceneId, "scene.json");
  if (!existsSync(docPath)) {
    return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  }

  const raw = await readFile(docPath, "utf-8");
  return NextResponse.json(JSON.parse(raw), {
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}
