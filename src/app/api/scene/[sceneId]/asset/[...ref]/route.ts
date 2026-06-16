import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const SCENES_DIR = join(process.cwd(), ".tmp", "scenes");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sceneId: string; ref: string[] }> }
) {
  const { sceneId, ref } = await params;

  if (!sceneId || !/^[a-f0-9]{12}$/.test(sceneId)) {
    return NextResponse.json({ error: "invalid sceneId" }, { status: 400 });
  }

  const refName = ref.join("/");
  if (!refName || refName.includes("..")) {
    return NextResponse.json({ error: "invalid ref" }, { status: 400 });
  }

  const assetPath = join(SCENES_DIR, sceneId, `${refName}.png`);
  if (!existsSync(assetPath)) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const buf = await readFile(assetPath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
