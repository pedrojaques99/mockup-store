import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const TMP_DIR  = join(process.cwd(), ".tmp",  "photo-scenes");
const DATA_DIR = join(process.cwd(), "data", "photo-scenes");
const ALLOWED = new Set(["photo", "photo-clean", "shadow", "shadow-screen", "mask", "highlight", "render", "art", "settings"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ref: string }> }
) {
  const { id, ref } = await params;

  if (!id || !/^[a-f0-9]{16}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!ALLOWED.has(ref)) {
    return NextResponse.json({ error: "invalid ref" }, { status: 400 });
  }

  const dataScene = join(DATA_DIR, id);
  const dir = existsSync(dataScene) ? dataScene : join(TMP_DIR, id);

  // For 'photo', find with any extension; 'photo-clean' tries clean then raw
  let filePath: string | null = null;
  if (ref === "photo" || ref === "photo-clean") {
    const metaPath = join(dir, "meta.json");
    if (!existsSync(metaPath)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const { ext } = JSON.parse(await readFile(metaPath, "utf-8"));
    const cleanPath = join(dir, "photo-clean.png");
    filePath = (ref === "photo-clean" && existsSync(cleanPath)) ? cleanPath : join(dir, `photo.${ext}`);
  } else if (ref === "settings") {
    filePath = join(dir, "settings.json");
    if (!existsSync(filePath)) return NextResponse.json({}, { status: 200 });
    const json = await readFile(filePath, "utf-8");
    return new NextResponse(json, { headers: { "Content-Type": "application/json" } });
  } else {
    filePath = join(dir, `${ref}.png`);
  }

  if (!filePath || !existsSync(filePath)) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  const buf = await readFile(filePath);
  const ct = filePath.endsWith(".jpg") || filePath.endsWith(".jpeg") ? "image/jpeg"
    : filePath.endsWith(".webp") ? "image/webp"
    : "image/png";

  return new NextResponse(buf, {
    headers: { "Content-Type": ct, "Cache-Control": "private, max-age=300" },
  });
}
