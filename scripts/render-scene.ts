/**
 * Render a mockup from a pre-extracted Scene Package — no PSD needed.
 * Usage:
 *   bun scripts/render-scene.ts --scene <sceneId> --art <art.png> --out <output.png>
 *   bun scripts/render-scene.ts --scene <sceneId> --art <art.png> --face <faceKey>
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { renderScene, createNodeAdapter } from "@visant/psd-engine";
import type { SceneDoc, AssetMap, ArtMap } from "@visant/psd-engine";

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const sceneId = arg("scene");
const artPath = arg("art");
const faceKey = arg("face", ""); // optional face key override
const outPath = arg("out", ".tmp/scene-render.png");
const scenesBase = arg("scenes", ".tmp/scenes");

if (!sceneId || !artPath) {
  console.error("Usage: bun scripts/render-scene.ts --scene <id> --art <art.png> --out <out.png>");
  process.exit(1);
}

const t0 = Date.now();
const step = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

const sceneDir = resolve(scenesBase, sceneId);
const docPath = resolve(sceneDir, "scene.json");

if (!existsSync(docPath)) {
  console.error(`Scene not found: ${sceneDir}`);
  console.error(`Run: bun scripts/extract-scene.ts --psd <file.psd> first`);
  process.exit(1);
}

const { createCanvas, loadImage, toBuffer } = await createNodeAdapter();

step(`loading scene ${sceneId}`);
const { doc }: { doc: SceneDoc } = JSON.parse(readFileSync(docPath, "utf-8"));
step(`${doc.width}×${doc.height}, ${doc.faces.length} face(s): ${doc.faces.map((f) => `"${f.name}" [${f.key}]`).join(", ")}`);

// Load all asset PNGs
step("loading assets...");
const assets: AssetMap = {};
for (const layer of doc.layers) {
  const p = resolve(sceneDir, `${layer.src}.png`);
  if (existsSync(p)) assets[layer.src] = await loadImage(readFileSync(p));
}
for (const face of doc.faces) {
  if (face.maskRef) {
    const p = resolve(sceneDir, `${face.maskRef}.png`);
    if (existsSync(p)) assets[face.maskRef] = await loadImage(readFileSync(p));
  }
}
step(`loaded ${Object.keys(assets).length} asset(s)`);

// Load art
step(`loading art: ${artPath}`);
const artImg = await loadImage(readFileSync(resolve(artPath)));

// Map art to all faces (or specific face if --face given)
const arts: ArtMap = {};
for (const face of doc.faces) {
  if (!faceKey || face.key === faceKey) {
    arts[face.key] = artImg;
  }
}
step(`applying art to ${Object.keys(arts).length} face(s)`);

// Render
step("rendering...");
const canvas = renderScene(doc, assets, arts, createCanvas as any);

// Save output
const png = toBuffer(canvas, "image/png");
writeFileSync(resolve(outPath), png);
step(`saved ${outPath} (${(canvas as any).width}×${(canvas as any).height})`);
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
