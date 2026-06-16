/**
 * End-to-end test do photo-mockup pipeline.
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun scripts/test-photo-mockup.ts
 *
 * Roda o pipeline completo nas 3 fotos de exemplo e salva os resultados em .tmp/photo-test/
 * Usa um logo simples gerado como arte para o teste.
 */
import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";

const PHOTOS = [
  "Z:/BOXY/Lab/Bases IA/man black clothes card to face.png",
  "Z:/BOXY/Lab/Bases IA/visant.co_interesting_angle_shots_photography_of_a_blank_poster_197b3d03-f266-48da-b378-24eadb13cf83.png",
  "Z:/BOXY/Lab/Bases IA/IN-SITU-007_HOVER-1465x980.png",
];

const OUT_DIR = resolve(".tmp/photo-test");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌ Set ANTHROPIC_API_KEY env var first");
  process.exit(1);
}

// Generate a simple test art: white rectangle with colored border + text
async function makeTestArt(width: number, height: number): Promise<Buffer> {
  const { createNodeAdapter } = await import("@visant/psd-engine");
  const { createCanvas, toBuffer } = await createNodeAdapter();

  const canvas = createCanvas(width, height) as any;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, width, height);

  // Border
  ctx.strokeStyle = "#e94560";
  ctx.lineWidth = Math.max(4, width * 0.015);
  const margin = ctx.lineWidth * 2;
  ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);

  // Text
  const fs = Math.max(20, Math.min(width * 0.1, 80));
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${fs}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VISANT", width / 2, height / 2 - fs * 0.4);

  ctx.fillStyle = "#e94560";
  ctx.font = `${fs * 0.4}px Arial`;
  ctx.fillText("DESIGN STUDIO", width / 2, height / 2 + fs * 0.6);

  return toBuffer(canvas, "image/png") as Buffer;
}

const t0 = Date.now();
const elapsed = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

await mkdir(OUT_DIR, { recursive: true });

for (let i = 0; i < PHOTOS.length; i++) {
  const photoPath = PHOTOS[i];
  const name = `photo-${i + 1}`;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`${elapsed()} 📸 Processing: ${photoPath.split("/").pop()}`);

  if (!existsSync(photoPath)) {
    console.warn(`  ⚠ File not found, skipping`);
    continue;
  }

  // ── Step 1: Read image dimensions ──────────────────────────────────────────
  const sharp = (await import("sharp")).default;
  const meta = await sharp(photoPath).metadata();
  const { width = 800, height = 600 } = meta;
  console.log(`${elapsed()} ✓ Loaded ${width}×${height}`);

  // ── Step 2: Analyze with Claude Vision ─────────────────────────────────────
  console.log(`${elapsed()} 🤖 Analyzing surface with Claude Vision...`);
  const { analyzePhoto } = await import("../src/lib/photo-analyze");
  const analysis = await analyzePhoto(photoPath, width, height);
  console.log(`${elapsed()} ✓ Surface: ${analysis.surfaceType} (${analysis.material}), confidence ${(analysis.confidence * 100).toFixed(0)}%`);
  console.log(`         Quad: TL(${analysis.quad.tl.x},${analysis.quad.tl.y}) TR(${analysis.quad.tr.x},${analysis.quad.tr.y}) BR(${analysis.quad.br.x},${analysis.quad.br.y}) BL(${analysis.quad.bl.x},${analysis.quad.bl.y})`);
  if (analysis.hasOcclusion) console.log(`         ⚠ Occlusion: ${analysis.occlusionDesc}`);

  // ── Step 3: Extract shadow map + mask ──────────────────────────────────────
  console.log(`${elapsed()} 🔆 Extracting shadow/lighting map...`);
  const { extractShadowMap, extractMask } = await import("../src/lib/photo-shadow");
  const [shadowBuf, maskBuf] = await Promise.all([
    extractShadowMap(photoPath, analysis.quad),
    extractMask(width, height, analysis.quad),
  ]);
  await Promise.all([
    writeFile(resolve(OUT_DIR, `${name}-shadow.png`), shadowBuf),
    writeFile(resolve(OUT_DIR, `${name}-mask.png`), maskBuf),
  ]);
  console.log(`${elapsed()} ✓ Shadow: ${shadowBuf.length >> 10}KB, Mask: ${maskBuf.length >> 10}KB`);

  // ── Step 4: Build SceneDoc ─────────────────────────────────────────────────
  const { buildPhotoSceneDoc } = await import("../src/lib/photo-scene");
  const doc = buildPhotoSceneDoc(analysis);
  console.log(`${elapsed()} ✓ SceneDoc: face ${doc.faces[0].innerW}×${doc.faces[0].innerH}, ${doc.layers.length} layers`);

  // ── Step 5: Generate test art sized to face ────────────────────────────────
  const artBuf = await makeTestArt(doc.faces[0].innerW, doc.faces[0].innerH);
  console.log(`${elapsed()} 🎨 Test art: ${doc.faces[0].innerW}×${doc.faces[0].innerH}`);

  // ── Step 6: renderScene ────────────────────────────────────────────────────
  console.log(`${elapsed()} 🖨  Rendering...`);
  const { createNodeAdapter, renderScene } = await import("@visant/psd-engine");
  const { createCanvas, loadImage, toBuffer } = await createNodeAdapter();

  const [photoImg, shadowImg, maskImg, artImg] = await Promise.all([
    loadImage(await readFile(photoPath)),
    loadImage(shadowBuf),
    loadImage(maskBuf),
    loadImage(artBuf),
  ]);

  const assets = { photo: photoImg, shadow: shadowImg, mask: maskImg };
  const arts = { surface: artImg };
  const canvas = renderScene(doc, assets, arts as any, createCanvas as any);
  const outBuf = toBuffer(canvas as any, "image/png") as Buffer;

  const outPath = resolve(OUT_DIR, `${name}-result.png`);
  await writeFile(outPath, outBuf);
  console.log(`${elapsed()} ✅ Saved ${outPath} (${outBuf.length >> 10}KB)`);
}

console.log(`\n${"═".repeat(60)}`);
console.log(`✅ All done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`📁 Results in: ${OUT_DIR}`);
