import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { SceneDoc, AssetMap, ArtMap } from "@visant/psd-engine";

const SCENES_DIR = join(process.cwd(), ".tmp", "scenes");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sceneId: string }> }
) {
  const { sceneId } = await params;

  if (!sceneId || !/^[a-f0-9]{12}$/.test(sceneId)) {
    return NextResponse.json({ error: "invalid sceneId" }, { status: 400 });
  }

  const sceneDir = join(SCENES_DIR, sceneId);
  const docPath = join(sceneDir, "scene.json");
  if (!existsSync(docPath)) {
    return NextResponse.json({ error: "Scene not found. Run extract first." }, { status: 404 });
  }

  const body = await req.json();
  const { artBase64, faceKey } = body as { artBase64: string; faceKey?: string };

  if (!artBase64 || typeof artBase64 !== "string") {
    return NextResponse.json({ error: "artBase64 required" }, { status: 400 });
  }

  const { doc }: { doc: SceneDoc } = JSON.parse(readFileSync(docPath, "utf-8"));

  const { createNodeAdapter, renderScene } = await import("@visant/psd-engine");
  const { createCanvas, loadImage, toBuffer } = await createNodeAdapter();

  // Load assets
  const assets: AssetMap = {};
  for (const layer of doc.layers) {
    const p = join(sceneDir, `${layer.src}.png`);
    if (existsSync(p)) assets[layer.src] = await loadImage(await readFile(p));
  }
  for (const face of doc.faces) {
    if (face.maskRef) {
      const p = join(sceneDir, `${face.maskRef}.png`);
      if (existsSync(p)) assets[face.maskRef] = await loadImage(await readFile(p));
    }
  }

  // Decode art
  const artDataUrl = artBase64.startsWith("data:")
    ? artBase64
    : `data:image/png;base64,${artBase64}`;
  const artBuf = Buffer.from(artDataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
  const artImg = await loadImage(artBuf);

  // Map art to faces
  const arts: ArtMap = {};
  for (const face of doc.faces) {
    if (!faceKey || face.key === faceKey) {
      arts[face.key] = artImg as any;
    }
  }

  const canvas = renderScene(doc, assets, arts as any, createCanvas as any);
  const png = toBuffer(canvas as any, "image/png");

  return new NextResponse(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
