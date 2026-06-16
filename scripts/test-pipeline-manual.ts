/**
 * Pipeline test — quads manuais, shadow via sharp, render via canvas direto.
 * Roda com: bun scripts/test-pipeline-manual.ts
 */
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";
const { createCanvas, loadImage } = require("canvas");

const OUT = resolve(".tmp/photo-test");
const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

const TESTS = [
  {
    name: "card",
    photo: "Z:/BOXY/Lab/Bases IA/man black clothes card to face.png",
    // Card corners from visual inspection of original 2560×1792
    quad: { tl: { x: 546, y: 533 }, tr: { x: 2083, y: 521 }, br: { x: 2095, y: 998 }, bl: { x: 555, y: 1012 } },
    surfaceType: "card",
    material: "glossy",
  },
  {
    name: "poster",
    photo: "Z:/BOXY/Lab/Bases IA/visant.co_interesting_angle_shots_photography_of_a_blank_poster_197b3d03-f266-48da-b378-24eadb13cf83.png",
    quad: { tl: { x: 720, y: 145 }, tr: { x: 2375, y: 145 }, br: { x: 2375, y: 1210 }, bl: { x: 720, y: 1210 } },
    surfaceType: "poster",
    material: "matte",
  },
  {
    name: "wall",
    photo: "Z:/BOXY/Lab/Bases IA/IN-SITU-007_HOVER-1465x980.png",
    quad: { tl: { x: 12, y: 92 }, tr: { x: 1453, y: 88 }, br: { x: 1453, y: 875 }, bl: { x: 12, y: 878 } },
    surfaceType: "wall",
    material: "rough",
  },
];

// Surface-aware shadow config
const SHADOW_CONFIG: Record<string, { opacity: number; contrast: number }> = {
  card:   { opacity: 0.75, contrast: 0.4 },
  poster: { opacity: 0.88, contrast: 0.25 },
  wall:   { opacity: 0.92, contrast: 0.2 },
};

function makeArt(w: number, h: number): any {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#0f0c29");
  grad.addColorStop(0.5, "#302b63");
  grad.addColorStop(1, "#24243e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#e94560";
  ctx.fillRect(0, h * 0.08, w, h * 0.035);
  ctx.fillRect(0, h * 0.88, w, h * 0.035);

  const fs = Math.max(24, Math.min(w * 0.12, 120));
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 ${fs}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VISANT", w / 2, h * 0.42);

  ctx.fillStyle = "#e94560";
  ctx.font = `400 ${Math.round(fs * 0.32)}px Arial`;
  ctx.fillText("CREATIVE STUDIO", w / 2, h * 0.62);

  return c;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const { extractShadowMap, extractHighlightMap, extractMask } = await import("../src/lib/photo-shadow");
  const { buildPhotoSceneDoc } = await import("../src/lib/photo-scene");
  const { renderScene } = await import("@visant/psd-engine");

  for (const test of TESTS) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`${ts()} 📸 [${test.name}] ${test.surfaceType} / ${test.material}`);

    if (!existsSync(test.photo)) {
      console.warn(`  ⚠ Not found: ${test.photo}`);
      continue;
    }

    const meta = await sharp(test.photo).metadata();
    const W = meta.width!, H = meta.height!;
    console.log(`${ts()} ✓ ${W}×${H}`);

    const clamp = (p: { x: number; y: number }) => ({
      x: Math.max(0, Math.min(W, p.x)),
      y: Math.max(0, Math.min(H, p.y)),
    });
    const quad = {
      tl: clamp(test.quad.tl), tr: clamp(test.quad.tr),
      br: clamp(test.quad.br), bl: clamp(test.quad.bl),
    };

    const cfg = SHADOW_CONFIG[test.surfaceType] ?? { opacity: 0.85, contrast: 0.2 };
    const isGlossy = test.material === "glossy";

    console.log(`${ts()} 🔆 Shadow extraction (contrast boost: ${cfg.contrast})...`);
    const shadowTask = extractShadowMap(test.photo, quad, cfg.contrast);
    const maskTask = extractMask(W, H, quad, 3);
    const highlightTask = isGlossy ? extractHighlightMap(test.photo, quad) : Promise.resolve(null);

    const [shadowBuf, maskBuf, highlightBuf] = await Promise.all([shadowTask, maskTask, highlightTask]);

    await writeFile(resolve(OUT, `${test.name}-shadow.png`), shadowBuf);
    await writeFile(resolve(OUT, `${test.name}-mask.png`), maskBuf);
    if (highlightBuf) await writeFile(resolve(OUT, `${test.name}-highlight.png`), highlightBuf);
    console.log(`${ts()} ✓ shadow ${shadowBuf.length >> 10}KB  mask ${maskBuf.length >> 10}KB${highlightBuf ? `  highlight ${highlightBuf.length >> 10}KB` : ""}`);

    // SceneDoc — pass surfaceType and material for smart defaults
    const analysis = {
      quad, surfaceType: test.surfaceType, material: test.material,
      hasOcclusion: false, occlusionDesc: "", lightingDir: "ambient",
      confidence: 1, imageWidth: W, imageHeight: H,
    };
    const doc = buildPhotoSceneDoc(analysis);
    const face = doc.faces[0];
    console.log(`${ts()} ✓ face ${face.innerW}×${face.innerH} | layers: ${doc.layers.map(l => l.src).join(", ")}`);

    // Art canvas
    const artCanvas = makeArt(face.innerW, face.innerH);

    // Load images for renderScene
    console.log(`${ts()} 🖨  renderScene...`);
    const [photoImg, shadowImg, maskImg] = await Promise.all([
      loadImage(test.photo),
      loadImage(shadowBuf),
      loadImage(maskBuf),
    ]);

    const assets: any = { photo: photoImg, shadow: shadowImg, mask: maskImg };
    if (highlightBuf) {
      assets.highlight = await loadImage(highlightBuf);
    }

    const canvas = renderScene(doc, assets, { surface: artCanvas }, createCanvas);

    const resultBuf: Buffer = (canvas as any).toBuffer("image/png");
    const outPath = resolve(OUT, `${test.name}-result.png`);
    await writeFile(outPath, resultBuf);
    console.log(`${ts()} ✅ ${outPath} (${resultBuf.length >> 10}KB)`);

    // Small shadow preview
    const prev = await sharp(shadowBuf).resize(Math.round(W / 4)).png().toBuffer();
    await writeFile(resolve(OUT, `${test.name}-shadow-sm.png`), prev);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — results in ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
