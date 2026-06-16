import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";

const BASE_DIR = join(process.cwd(), ".tmp", "photo-scenes");

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ error: "photo file required" }, { status: 400 });
  }

  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, WebP supported" }, { status: 400 });
  }

  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const dir = join(BASE_DIR, id);
  await mkdir(dir, { recursive: true });

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
  const photoPath = join(dir, `photo.${ext}`);
  await writeFile(photoPath, buf);

  const meta = await sharp(buf).metadata();
  const { width = 0, height = 0 } = meta;

  // Store dimensions for downstream steps
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({ ext, width, height, originalName: file.name })
  );

  return NextResponse.json({ id, width, height, ext });
}
