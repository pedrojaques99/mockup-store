/**
 * verify-wysiwyg — prova que a prévia (/calibrate, live-extract) e a produção
 * (/photo-mockup, disco-baked) saem IGUAIS, pois usam o mesmo core.
 *
 * Renderiza a MESMA cena pelos dois caminhos e gera A.png (produção), B.png (prévia)
 * e diff.png (|A−B|), reportando o erro médio por canal. ~0 = WYSIWYG.
 *
 *   npx tsx --env-file=.env.local scripts/verify-wysiwyg.ts [sceneId] [artPng]
 *
 * Sem args: pega a 1ª cena com assets assados em data/photo-scenes (ou .tmp/photo-scenes).
 * Caveat: cenas com máscara SAM assada divergem na luz/máscara se a prévia não receber a
 * SAM (live-extract não a recria) — escolha uma cena sem SAM, ou passe a SAM ao core.
 */
import { existsSync, readdirSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import sharp from "sharp";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createCanvas, loadImage } = require("canvas");
import { renderScene, perspectiveWarp } from "@visant/psd-engine";
import {
  extractSceneAssets, buildBaseComposite, applyLooks,
  type RenderEngine, type SceneAnalysis, type BaseParams, type LooksParams,
} from "../src/lib/photo-render-core";

const engine: RenderEngine = {
  createCanvas, loadImage,
  toBuffer: (c: unknown, t: string) => (c as { toBuffer: (t: string) => Buffer }).toBuffer(t),
  renderScene: renderScene as RenderEngine["renderScene"],
  perspectiveWarp: perspectiveWarp as RenderEngine["perspectiveWarp"],
};

function findScene(id?: string): { dir: string; id: string } {
  const roots = [join(process.cwd(), "data", "photo-scenes"), join(process.cwd(), ".tmp", "photo-scenes")];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const ids = id ? [id] : readdirSync(root);
    for (const sid of ids) {
      const dir = join(root, sid);
      if (existsSync(join(dir, "analysis.json")) && existsSync(join(dir, "shadow.png")) && existsSync(join(dir, "mask.png"))) {
        return { dir, id: sid };
      }
    }
  }
  throw new Error("nenhuma cena com assets assados encontrada (rode /process antes)");
}

/** Arte-teste procedural (grid colorido) → base64. */
function testArt(w: number, h: number): string {
  const c = createCanvas(w, h); const ctx = c.getContext("2d");
  ctx.fillStyle = "#00E64D"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#000"; ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.01);
  for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo((w / 8) * i, 0); ctx.lineTo((w / 8) * i, h); ctx.moveTo(0, (h / 8) * i); ctx.lineTo(w, (h / 8) * i); ctx.stroke(); }
  return (c.toBuffer("image/png") as Buffer).toString("base64");
}

async function meanAbsDiff(a: Buffer, b: Buffer): Promise<number> {
  const A = await sharp(a).ensureAlpha().raw().toBuffer();
  const B = await sharp(b).ensureAlpha().raw().toBuffer();
  const n = Math.min(A.length, B.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(A[i] - B[i]);
  return sum / n;
}

async function main() {
  const argId = process.argv[2];
  const artArg = process.argv[3];
  const { dir, id } = findScene(argId);
  const analysis = JSON.parse(readFileSync(join(dir, "analysis.json"), "utf-8")) as SceneAnalysis;
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8"));
  const rawPhotoPath = join(dir, `photo.${meta.ext}`);
  const cleanPath = join(dir, "photo-clean.png");
  const rawPhoto = readFileSync(rawPhotoPath);

  const innerW = analysis.imageWidth, innerH = analysis.imageHeight; // arte ~ cena (test grid)
  const artBase64 = artArg && existsSync(artArg) ? readFileSync(artArg).toString("base64") : testArt(Math.min(1024, innerW), Math.min(1024, innerH));

  const baseParams: BaseParams = {}; // só geometria/luz/cast default — o que ambos compartilham
  const looksParams: LooksParams = {};

  console.log(`cena: ${id}  (${analysis.imageWidth}×${analysis.imageHeight})`);

  // ── A: PRODUÇÃO (assets de disco) ──
  const diskCast = join(dir, "color-cast.png");
  const A = await buildBaseComposite({
    engine, analysis,
    photo: existsSync(cleanPath) ? readFileSync(cleanPath) : rawPhoto,
    rawPhoto,
    multiply: readFileSync(join(dir, "shadow.png")),
    screen: existsSync(join(dir, "shadow-screen.png")) ? readFileSync(join(dir, "shadow-screen.png")) : readFileSync(join(dir, "shadow.png")),
    mask: readFileSync(join(dir, "mask.png")),
    colorCast: existsSync(diskCast) ? readFileSync(diskCast) : undefined,
    artBase64, params: baseParams, quality: "hd",
  });
  const Apng = await applyLooks({
    engine, analysis, png: A.basePng, fullMask: A.fullMask, rawPhoto, artBase64,
    reflectionMask: existsSync(join(dir, "reflection-mask.png")) ? readFileSync(join(dir, "reflection-mask.png")) : null,
    occluder: existsSync(join(dir, "occluder.png")) ? readFileSync(join(dir, "occluder.png")) : null,
    params: looksParams,
  });

  // ── B: PRÉVIA (live-extract do mesmo raw) ──
  const assets = await extractSceneAssets(rawPhoto, analysis, { fast: false });
  const B = await buildBaseComposite({
    engine, analysis, photo: assets.cleanPhoto, rawPhoto,
    multiply: assets.multiply, screen: assets.screen, mask: assets.mask, colorCast: assets.colorCast,
    artBase64, params: baseParams, quality: "hd",
  });
  const Bpng = await applyLooks({
    engine, analysis, png: B.basePng, fullMask: B.fullMask, rawPhoto, artBase64,
    reflectionMask: assets.reflectionMask, occluder: assets.occluder, params: looksParams,
  });

  const outDir = join(process.cwd(), ".tmp", "wysiwyg-verify");
  mkdirSync(outDir, { recursive: true });
  await sharp(Apng).toFile(join(outDir, "A-producao.png"));
  await sharp(Bpng).toFile(join(outDir, "B-previa.png"));

  const diff = await meanAbsDiff(Apng, Bpng);
  console.log(`\nerro médio por canal (0–255): ${diff.toFixed(3)}`);
  console.log(diff < 1 ? "✅ WYSIWYG — caminhos idênticos (≤1)" : diff < 5 ? "🟡 quase idêntico (provável SAM/relevo de borda)" : "🔴 divergem — investigar");
  console.log(`saída: ${outDir}\\A-producao.png  +  B-previa.png`);
}

main().catch((e) => { console.error(e); process.exit(1); });
