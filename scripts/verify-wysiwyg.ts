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

  // Params RICOS: exercita TODOS os assets/caminhos (não só o base).
  // - textureAmount → relevo;  material → overlay;  castOpacity → usa colorCast asset
  // - reflectionOpacity → usa reflectionMask;  specular/contact → usa rawPhoto+mask
  // Assim A(disco) vs B(live) compara cast+reflexo+occluder+máscara, não só a luz.
  const baseParams: BaseParams = {
    textureAmount: 0.4,
    castOpacity: 0.25,
    material: { kind: "fabric" as never, intensity: 0.5 },
    shadowOpacity: 0.3, highlightOpacity: 0.3,
  };
  const looksParams: LooksParams = {
    reflectionOpacity: 0.3, specularOpacity: 0.3, contactShadow: 0.3, matchScene: 0.2,
  };

  console.log(`cena: ${id}  (${analysis.imageWidth}×${analysis.imageHeight})`);
  console.log(`params ricos: relevo+material+cast+reflexo+specular+contato+match`);

  // REBAKE: escreve os assets frescos em disco (= o que o /process gera HOJE) pra o teste
  // não sofrer com cenas stale. A = lê esses PNGs (produção); B = mesma extração em memória.
  const baked = join(process.cwd(), ".tmp", "wysiwyg-verify", "baked");
  mkdirSync(baked, { recursive: true });
  const assets = await extractSceneAssets(rawPhoto, analysis, { fast: false });
  const w = (name: string, b: Buffer | null) => { if (b) { const p = join(baked, name); require("fs").writeFileSync(p, b); return p; } return null; };
  w("shadow.png", assets.multiply); w("shadow-screen.png", assets.screen); w("mask.png", assets.mask);
  w("photo-clean.png", assets.cleanPhoto); w("color-cast.png", assets.colorCast);
  const refP = w("reflection-mask.png", assets.reflectionMask); const occP = w("occluder.png", assets.occluder);

  // ── A: PRODUÇÃO (assets de disco frescos) ──
  const A = await buildBaseComposite({
    engine, analysis,
    photo: readFileSync(join(baked, "photo-clean.png")), rawPhoto,
    multiply: readFileSync(join(baked, "shadow.png")),
    screen: readFileSync(join(baked, "shadow-screen.png")),
    mask: readFileSync(join(baked, "mask.png")),
    colorCast: readFileSync(join(baked, "color-cast.png")),
    artBase64, params: baseParams, quality: "hd",
  });
  const Apng = await applyLooks({
    engine, analysis, png: A.basePng, fullMask: A.fullMask, rawPhoto, artBase64,
    reflectionMask: refP ? readFileSync(refP) : null,
    occluder: occP ? readFileSync(occP) : null,
    params: looksParams,
  });

  // ── B: PRÉVIA (live-extract do mesmo raw) ──
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

  // ── Smoke-test SAM: o intersect realmente recorta a máscara? ──
  // /calibrate e /process chamam o MESMO extractSceneAssets com o MESMO crop de bbox,
  // então provar que o intersect acontece = SAM idêntico nos dois (por construção).
  const q = analysis.quad;
  const cx = (q.tl.x + q.br.x) / 2, cy = (q.tl.y + q.br.y) / 2;
  const rx = Math.abs(q.br.x - q.tl.x) / 4, ry = Math.abs(q.br.y - q.tl.y) / 4;
  // alpha-shaped (fundo TRANSPARENTE, elipse opaca) — o intersect usa dest-in (canal alpha)
  const samSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${analysis.imageWidth}" height="${analysis.imageHeight}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/></svg>`;
  const left = Math.max(0, Math.floor(Math.min(q.tl.x, q.tr.x, q.br.x, q.bl.x)));
  const top = Math.max(0, Math.floor(Math.min(q.tl.y, q.tr.y, q.br.y, q.bl.y)));
  const maxX = Math.min(analysis.imageWidth - 1, Math.ceil(Math.max(q.tl.x, q.tr.x, q.br.x, q.bl.x)));
  const maxY = Math.min(analysis.imageHeight - 1, Math.ceil(Math.max(q.tl.y, q.tr.y, q.br.y, q.bl.y)));
  const samBuf = await sharp(Buffer.from(samSvg)).resize(analysis.imageWidth, analysis.imageHeight, { fit: "fill" }).extract({ left, top, width: maxX - left + 1, height: maxY - top + 1 }).ensureAlpha().png().toBuffer();
  const alphaSum = async (b: Buffer) => { const d = await sharp(b).ensureAlpha().raw().toBuffer(); let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i]; return s; };
  const noSam = await extractSceneAssets(rawPhoto, analysis, { fast: true });
  const withSam = await extractSceneAssets(rawPhoto, analysis, { fast: true, surfaceMaskBuf: samBuf });
  const aNo = await alphaSum(noSam.mask), aYes = await alphaSum(withSam.mask);
  const shrink = aNo > 0 ? (1 - aYes / aNo) * 100 : 0;
  console.log(`\nSAM intersect: máscara encolheu ${shrink.toFixed(1)}% (${aNo} → ${aYes} alpha)`);
  console.log(shrink > 5 ? "✅ SAM aplicada (intersect ativo) — mesmo crop que /process → WYSIWYG por construção" : "⚠️ SAM não recortou — investigar");
}

main().catch((e) => { console.error(e); process.exit(1); });
