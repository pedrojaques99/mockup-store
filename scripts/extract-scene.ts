/**
 * Extract a Scene Package from a PSD — one-time preprocessing step.
 * Saves SceneDoc JSON + asset PNGs to .tmp/scenes/{sceneId}/
 *
 * Usage:
 *   bun scripts/extract-scene.ts --psd "Z:/mockups/billboard.psd"
 *   bun scripts/extract-scene.ts --psd "Z:/mockups/billboard.psd" --out .tmp/scenes
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, basename } from "path";
import { createHash } from "crypto";
import { extractScene, createNodeAdapter, initializeAgPsdCanvas } from "@visant/psd-engine";

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const psdPath = arg("psd");
const outBase = arg("out", ".tmp/scenes");

if (!psdPath) {
  console.error("Usage: bun scripts/extract-scene.ts --psd <file.psd> [--out <dir>]");
  process.exit(1);
}

const t0 = Date.now();
const step = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

const agPsd = await import("ag-psd");
const { createCanvas, loadImage, toBuffer } = await createNodeAdapter();

await initializeAgPsdCanvas(agPsd);

step(`reading ${basename(psdPath)}`);
const psdBuffer = readFileSync(resolve(psdPath));
const psd = agPsd.readPsd(new Uint8Array(psdBuffer).buffer as ArrayBuffer, { skipThumbnail: true });
step(`parsed ${psd.width}×${psd.height}`);

step("extracting scene...");
const { doc, assets } = extractScene(psd, createCanvas as any);
step(`extracted: ${doc.faces.length} face(s), ${doc.layers.length} layer(s)`);

if (doc.warnings.length) {
  for (const w of doc.warnings) console.warn(`  ⚠ ${w}`);
}

// Scene ID = MD5 of normalized path (stable, short)
const sceneId = createHash("md5").update(resolve(psdPath).replace(/\\/g, "/")).digest("hex").slice(0, 12);
const outDir = resolve(outBase, sceneId);
mkdirSync(outDir, { recursive: true });

// Save SceneDoc as JSON
const docPath = resolve(outDir, "scene.json");
writeFileSync(docPath, JSON.stringify({ psdPath: resolve(psdPath).replace(/\\/g, "/"), sceneId, doc }, null, 2));
step(`saved scene.json (${doc.faces.map((f) => f.name).join(", ")})`);

// Save each asset canvas as PNG
for (const [ref, canvas] of Object.entries(assets)) {
  if (!canvas) continue;
  const png = toBuffer(canvas, "image/png");
  const assetPath = resolve(outDir, `${ref}.png`);
  writeFileSync(assetPath, png);
  step(`saved ${ref}.png (${(canvas as any).width}×${(canvas as any).height})`);
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Scene ID: ${sceneId}`);
console.log(`Output:   ${outDir}`);
console.log(`\nTest render:`);
console.log(`  bun scripts/render-scene.ts --scene ${sceneId} --art <art.png> --out .tmp/scene-render.png`);
