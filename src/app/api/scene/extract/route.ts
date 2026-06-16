import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { createHash } from "crypto";

const SCENES_DIR = join(process.cwd(), ".tmp", "scenes");

export async function POST(req: NextRequest) {
  const { psdPath } = await req.json();

  if (!psdPath || typeof psdPath !== "string" || psdPath.includes("..")) {
    return NextResponse.json({ error: "psdPath required" }, { status: 400 });
  }

  if (!existsSync(psdPath)) {
    return NextResponse.json({ error: `PSD not found: ${psdPath}` }, { status: 404 });
  }

  const normalizedPath = resolve(psdPath).replace(/\\/g, "/");
  const sceneId = createHash("md5").update(normalizedPath).digest("hex").slice(0, 12);
  const sceneDir = join(SCENES_DIR, sceneId);
  const docPath = join(sceneDir, "scene.json");

  // Return cached if already extracted
  if (existsSync(docPath)) {
    const raw = await readFile(docPath, "utf-8");
    const { doc } = JSON.parse(raw);
    return NextResponse.json({ sceneId, doc, cached: true });
  }

  // Dynamic imports — heavy deps, keep out of module scope
  const agPsd = await import("ag-psd");
  const { createNodeAdapter, initializeAgPsdCanvas, extractScene } = await import("@visant/psd-engine");

  const { createCanvas, toBuffer } = await createNodeAdapter();
  await initializeAgPsdCanvas(agPsd);

  const psdBuffer = await readFile(psdPath);
  const psd = agPsd.readPsd(new Uint8Array(psdBuffer).buffer as ArrayBuffer, { skipThumbnail: true });

  const { doc, assets } = extractScene(psd, createCanvas as any);

  await mkdir(sceneDir, { recursive: true });

  // Save scene.json
  await writeFile(docPath, JSON.stringify({ psdPath: normalizedPath, sceneId, doc }, null, 2));

  // Save asset PNGs
  for (const [ref, canvas] of Object.entries(assets)) {
    if (!canvas) continue;
    const png = toBuffer(canvas as any, "image/png");
    await writeFile(join(sceneDir, `${ref}.png`), png);
  }

  return NextResponse.json({ sceneId, doc, cached: false });
}
