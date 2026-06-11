import { NextRequest, NextResponse } from "next/server";
import { walkDir } from "@/lib/fs-walk";
import { IMAGE_EXTS } from "@/lib/psd-constants";
import { existsSync } from "fs";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  const normalized = path.replace(/\\/g, "/");
  if (!existsSync(normalized)) {
    return NextResponse.json({ error: "Pasta não encontrada" }, { status: 404 });
  }

  const files = walkDir(normalized, new Set([...IMAGE_EXTS, ".psd"]));
  const psdCount = files.filter((f) => f.ext === ".psd").length;
  const refCount = files.filter((f) => IMAGE_EXTS.has(f.ext)).length;

  return NextResponse.json({ psdCount, refCount });
}
