/**
 * Batch photo-mockup renderer.
 * Processes a folder of photos into rendered mockups without the Next.js server.
 *
 * Usage:
 *   bun --env-file=.env.local scripts/photo-mockup-batch.ts \
 *     --photos "Render/New Mockups" \
 *     --art   "Render/Art/logo.png" \
 *     --out   "Render/Output/batch" \
 *     [--fx   '{"warmth":20,"grain":5}'] \
 *     [--shadow 0.8] \
 *     [--force]
 *
 * --photos  Directory of source photos (jpg/png/webp)
 * --art     Artwork PNG/JPG to apply
 * --out     Output directory for rendered PNGs + summary.json
 * --fx      JSON FX params: grain, warmth, saturation, brightness
 * --shadow  Shadow intensity 0-1 (default 0.9)
 * --force   Re-process even if cached results exist
 */

import { readdir, readFile, writeFile, mkdir, existsSync } from "node:fs/promises";
import { existsSync as exists } from "node:fs";
import { join, extname, basename, resolve } from "node:path";
import sharp from "sharp";

import { analyzePhoto } from "../src/lib/photo-analyze";
import { extractGrayscaleLayers, extractMask, cleanMagentaMarker, extractOccluder } from "../src/lib/photo-shadow";
import { buildPhotoSceneDoc } from "../src/lib/photo-scene";
import { applyRenderFX, type RenderFX } from "../src/lib/photo-fx";

// ── CLI args ──────────────────────────────────────────────────────────────────

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const photosDir  = arg("--photos");
const artPath    = arg("--art");
const outDir     = arg("--out", "Render/Output/batch");
const fxJson     = arg("--fx", "{}");
const shadowStr  = arg("--shadow", "0.9");
const force      = process.argv.includes("--force");

if (!photosDir || !artPath) {
  console.error("Usage: bun scripts/photo-mockup-batch.ts --photos <dir> --art <file> [--out <dir>] [--fx <json>] [--shadow 0.8] [--force]");
  process.exit(1);
}

const fx: RenderFX = JSON.parse(fxJson);
const shadowOpacity = Math.max(0, Math.min(1, parseFloat(shadowStr)));
const CACHE_DIR = join(process.cwd(), ".tmp", "photo-scenes");

// ── Helpers ───────────────────────────────────────────────────────────────────

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function listImages(dir: string): Promise<string[]> {
  const entries = await readdir(resolve(dir), { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase()))
    .map(e => join(resolve(dir), e.name))
    .sort();
}

function makeId(photoPath: string): string {
  const hash = Bun.hash(photoPath + basename(artPath!)).toString(16).padStart(16, "0").slice(0, 16);
  return hash;
}

async function processPhoto(
  photoPath: string,
  artBuf: Buffer,
  outDir: string,
  idx: number,
  total: number,
): Promise<{ success: boolean; output?: string; error?: string }> {
  const label = `[${idx + 1}/${total}] ${basename(photoPath)}`;
  const id = makeId(photoPath);
  const cacheDir = join(CACHE_DIR, id);
  const outPng = join(outDir, `${String(idx + 1).padStart(3, "0")}_${basename(photoPath, extname(photoPath))}.png`);

  // Skip if already rendered
  if (!force && exists(outPng)) {
    console.log(`  ✓ ${label} — skipped (exists)`);
    return { success: true, output: outPng };
  }

  await mkdir(cacheDir, { recursive: true });

  try {
    // 1. Get image dimensions
    const meta = await sharp(photoPath).metadata();
    const W = meta.width!;
    const H = meta.height!;

    // 2. Analyze (cache in .tmp)
    const analysisPath = join(cacheDir, "analysis.json");
    let analysis: any;
    if (!force && exists(analysisPath)) {
      analysis = JSON.parse(await readFile(analysisPath, "utf-8"));
      process.stdout.write(`  ↻ ${label} — analysis cached\n`);
    } else {
      process.stdout.write(`  ⟳ ${label} — analyzing…\n`);
      analysis = await analyzePhoto(photoPath, W, H);
      analysis.id = id;
      await writeFile(analysisPath, JSON.stringify(analysis, null, 2));
    }

    const quad = analysis.quad;

    // 3. Process (extract lighting, mask, clean)
    const shadowPath = join(cacheDir, "shadow.png");
    const maskPath   = join(cacheDir, "mask.png");
    if (force || !exists(shadowPath) || !exists(maskPath)) {
      process.stdout.write(`  ⟳ ${label} — extracting lighting…\n`);
      const [{ screen, multiply }, maskBuf, cleanBuf, occluderBuf] = await Promise.all([
        extractGrayscaleLayers(photoPath, quad),
        extractMask(W, H, quad),
        cleanMagentaMarker(photoPath),
        extractOccluder(photoPath, quad),
      ]);
      await Promise.all([
        writeFile(shadowPath, multiply),
        writeFile(join(cacheDir, "shadow-screen.png"), screen),
        writeFile(maskPath, maskBuf),
        writeFile(join(cacheDir, "photo-clean.png"), cleanBuf),
        ...(occluderBuf ? [writeFile(join(cacheDir, "occluder.png"), occluderBuf)] : []),
      ]);
    }

    // 4. Render
    process.stdout.write(`  ⟳ ${label} — rendering…\n`);
    const { createNodeAdapter, renderScene } = await import("@visant/psd-engine");
    const { createCanvas, loadImage, toBuffer } = await createNodeAdapter();

    const cleanPhotoPath = join(cacheDir, "photo-clean.png");
    const photoFile = exists(cleanPhotoPath) ? cleanPhotoPath : photoPath;
    const screenPath = join(cacheDir, "shadow-screen.png");

    const [photoImg, multiplyImg, maskImg, screenImg] = await Promise.all([
      loadImage(await readFile(photoFile)),
      loadImage(await readFile(shadowPath)),
      loadImage(await readFile(maskPath)),
      exists(screenPath) ? loadImage(await readFile(screenPath)) : Promise.resolve(null),
    ]);

    const artImg = await loadImage(artBuf);

    const sceneOpts = { multiplyOpacity: shadowOpacity };
    const doc = buildPhotoSceneDoc(analysis, sceneOpts);

    const assets: any = {
      photo: photoImg,
      light_multiply: multiplyImg,
      light_screen: screenImg ?? multiplyImg,
      mask: maskImg,
    };
    const arts: any = { surface: artImg };

    const canvas = renderScene(doc, assets, arts, createCanvas as any);
    let png = toBuffer(canvas as any, "image/png") as Buffer;

    // 5. Occluder
    const occluderPath = join(cacheDir, "occluder.png");
    if (exists(occluderPath)) {
      png = await sharp(png)
        .composite([{ input: await readFile(occluderPath), blend: "over" }])
        .png()
        .toBuffer();
    }

    // 6. FX
    if (Object.keys(fx).length > 0) {
      png = await applyRenderFX(png, fx);
    }

    await writeFile(outPng, png);
    console.log(`  ✓ ${label} — saved ${basename(outPng)}`);
    return { success: true, output: outPng };

  } catch (e: any) {
    console.error(`  ✗ ${label} — ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const t0 = Date.now();
const resolvedOut = resolve(outDir);
await mkdir(resolvedOut, { recursive: true });

console.log(`\nPhoto Mockup Batch`);
console.log(`  Photos : ${resolve(photosDir)}`);
console.log(`  Art    : ${resolve(artPath)}`);
console.log(`  Out    : ${resolvedOut}`);
console.log(`  Shadow : ${shadowOpacity}  FX: ${fxJson}\n`);

const photos = await listImages(photosDir);
if (photos.length === 0) {
  console.error("No images found in --photos directory."); process.exit(1);
}

const artBuf = await readFile(resolve(artPath));
const results: Array<{ photo: string; success: boolean; output?: string; error?: string }> = [];

for (let i = 0; i < photos.length; i++) {
  const r = await processPhoto(photos[i], artBuf, resolvedOut, i, photos.length);
  results.push({ photo: basename(photos[i]), ...r });
}

const summary = {
  total: results.length,
  success: results.filter(r => r.success).length,
  failed: results.filter(r => !r.success).length,
  durationMs: Date.now() - t0,
  art: basename(artPath),
  shadowOpacity,
  fx,
  results,
};

await writeFile(join(resolvedOut, "_summary.json"), JSON.stringify(summary, null, 2));

console.log(`\nDone — ${summary.success}/${summary.total} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (summary.failed > 0) console.log(`Failed: ${results.filter(r => !r.success).map(r => r.photo).join(", ")}`);
