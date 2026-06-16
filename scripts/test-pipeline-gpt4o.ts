/**
 * Pipeline test COMPLETO — GPT-4o Vision detecta os quads automaticamente.
 * Arte de teste profissional para validar qualidade visual real.
 * Roda com: bun --env-file=.env.local scripts/test-pipeline-gpt4o.ts
 */
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";
const { createCanvas, loadImage } = require("canvas");

const OUT = resolve(".tmp/photo-test-gpt4o");
const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

const PHOTOS = [
  { name: "card",   path: "Z:/BOXY/Lab/Bases IA/man black clothes card to face.png" },
  { name: "poster", path: "Z:/BOXY/Lab/Bases IA/visant.co_interesting_angle_shots_photography_of_a_blank_poster_197b3d03-f266-48da-b378-24eadb13cf83.png" },
  { name: "wall",   path: "Z:/BOXY/Lab/Bases IA/IN-SITU-007_HOVER-1465x980.png" },
];

/**
 * Arte de teste minimalista e limpa — branca com tipografia bold preta.
 * Cores claras mostram melhor o efeito de shadow/lighting do pipeline.
 */
function makeArt(w: number, h: number, label: string): any {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  // Fundo branco com leve gradiente warm
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#f5f0eb");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Linha accent cinza claro superior
  ctx.fillStyle = "#e0dbd5";
  ctx.fillRect(0, 0, w, Math.max(2, h * 0.008));

  // Logotipo VISANT — preto bold, centrado
  const logoSize = Math.max(32, Math.min(w * 0.18, 180));
  ctx.fillStyle = "#0a0a0a";
  ctx.font = `900 ${logoSize}px Arial Black, Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VISANT", w / 2, h * 0.42);

  // Subtítulo cinza médio
  ctx.fillStyle = "#888880";
  ctx.font = `300 ${Math.round(logoSize * 0.28)}px Arial`;
  ctx.letterSpacing = "0.2em";
  ctx.fillText(label.toUpperCase(), w / 2, h * 0.62);

  // Linha fina inferior
  ctx.fillStyle = "#c8c2bc";
  ctx.fillRect(w * 0.35, h * 0.78, w * 0.30, 1);

  return c;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const { analyzePhoto } = await import("../src/lib/photo-analyze");
  const { extractShadowMap, extractHighlightMap, extractMask } = await import("../src/lib/photo-shadow");
  const { buildPhotoSceneDoc, getShadowParams } = await import("../src/lib/photo-scene");
  const { renderScene } = await import("@visant/psd-engine");

  const results: Array<{ name: string; quad: any; analysis: any; ok: boolean }> = [];

  for (const photo of PHOTOS) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`${ts()} 📸 [${photo.name}] ${photo.path.split("/").pop()}`);

    if (!existsSync(photo.path)) {
      console.warn(`  ⚠ Not found: ${photo.path}`);
      continue;
    }

    const meta = await sharp(photo.path).metadata();
    const W = meta.width!, H = meta.height!;
    console.log(`${ts()} ✓ ${W}×${H}`);

    // ── GPT-4o Vision auto-detect quad ──────────────────────────────
    console.log(`${ts()} 🤖 GPT-4o detecting surface...`);
    let analysis: any;
    try {
      analysis = await analyzePhoto(photo.path, W, H);
      const { quad, surfaceType, material, confidence, hasOcclusion, occlusionDesc } = analysis;
      console.log(`${ts()} ✓ ${surfaceType} / ${material} | confidence ${(confidence * 100).toFixed(0)}%`);
      console.log(`         TL(${quad.tl.x},${quad.tl.y}) TR(${quad.tr.x},${quad.tr.y}) BR(${quad.br.x},${quad.br.y}) BL(${quad.bl.x},${quad.bl.y})`);
      if (hasOcclusion) console.log(`         ⚠ occlusion: ${occlusionDesc}`);
    } catch (e: any) {
      console.error(`${ts()} ✗ Detection failed: ${e.message}`);
      continue;
    }

    // Save analysis
    await writeFile(resolve(OUT, `${photo.name}-analysis.json`), JSON.stringify(analysis, null, 2));

    const { quad } = analysis;
    const { contrastBoost } = getShadowParams(analysis.surfaceType);
    const isGlossy = analysis.material === "glossy" || analysis.surfaceType === "card" || analysis.surfaceType === "screen";

    // ── Shadow + mask extraction ─────────────────────────────────────
    console.log(`${ts()} 🔆 Shadow extraction...`);
    const [shadowBuf, maskBuf, highlightBuf] = await Promise.all([
      extractShadowMap(photo.path, quad, contrastBoost),
      extractMask(W, H, quad, 3),
      isGlossy ? extractHighlightMap(photo.path, quad) : Promise.resolve(null),
    ]);

    await writeFile(resolve(OUT, `${photo.name}-shadow.png`), shadowBuf);
    await writeFile(resolve(OUT, `${photo.name}-mask.png`), maskBuf);
    if (highlightBuf) await writeFile(resolve(OUT, `${photo.name}-highlight.png`), highlightBuf);
    console.log(`${ts()} ✓ shadow ${shadowBuf.length >> 10}KB  mask ${maskBuf.length >> 10}KB${highlightBuf ? `  highlight ${highlightBuf.length >> 10}KB` : ""}`);

    // ── SceneDoc ─────────────────────────────────────────────────────
    const doc = buildPhotoSceneDoc(analysis);
    const face = doc.faces[0];
    console.log(`${ts()} ✓ face ${face.innerW}×${face.innerH} | layers: ${doc.layers.map((l: any) => l.src).join(", ")}`);

    // ── Art canvas ───────────────────────────────────────────────────
    const artCanvas = makeArt(face.innerW, face.innerH, analysis.surfaceType);

    // ── Render ───────────────────────────────────────────────────────
    console.log(`${ts()} 🖨  Rendering...`);
    const [photoImg, shadowImg, maskImg] = await Promise.all([
      loadImage(photo.path),
      loadImage(shadowBuf),
      loadImage(maskBuf),
    ]);

    const assets: any = { photo: photoImg, shadow: shadowImg, mask: maskImg };
    if (highlightBuf) assets.highlight = await loadImage(highlightBuf);

    const canvas = renderScene(doc, assets, { surface: artCanvas }, createCanvas);
    const resultBuf: Buffer = (canvas as any).toBuffer("image/png");

    const outPath = resolve(OUT, `${photo.name}-result.png`);
    await writeFile(outPath, resultBuf);
    console.log(`${ts()} ✅ ${outPath} (${resultBuf.length >> 10}KB)`);

    results.push({ name: photo.name, quad, analysis, ok: true });
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — results in ${OUT}`);
  console.log(`\nDetected quads:`);
  for (const r of results) {
    const q = r.quad;
    const w = Math.max(q.tr.x, q.br.x) - Math.min(q.tl.x, q.bl.x);
    const h = Math.max(q.bl.y, q.br.y) - Math.min(q.tl.y, q.tr.y);
    console.log(`  ${r.name}: ${w}×${h}px | ${r.analysis.surfaceType}/${r.analysis.material}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
