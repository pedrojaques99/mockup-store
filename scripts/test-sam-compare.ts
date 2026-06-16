/**
 * Compara 2 modelos SAM para detecção de quad em fotos problemáticas.
 *
 * Modelos testados:
 *   lang     — tmappdev/lang-segment-anything  (~$0.0014/call, ~5s)
 *   grounded — schananas/grounded_sam          (~$0.003/call, ~8s)
 *
 * Saída: .tmp/sam-compare/<photo>-<model>-mask.png  (máscara binária)
 *        .tmp/sam-compare/<photo>-<model>-result.png (mockup renderizado)
 *        .tmp/sam-compare/report.json
 *
 * bun --env-file=.env.local scripts/test-sam-compare.ts
 * bun --env-file=.env.local scripts/test-sam-compare.ts --photos tshirt_man_grey,ve_outdoor_2
 * bun --env-file=.env.local scripts/test-sam-compare.ts --model lang
 */
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";
const { createCanvas } = require("canvas");

const OUT = resolve(".tmp/sam-compare");
const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

// ── CLI flags ─────────────────────────────────────────────────────────────────
const _photosIdx = process.argv.indexOf("--photos");
const photosArg = _photosIdx !== -1 ? process.argv[_photosIdx + 1] : null;
const PHOTO_FILTER = photosArg ? new Set(photosArg.split(",").map(s => s.trim())) : null;

const _modelIdx = process.argv.indexOf("--model");
const MODEL_ARG = _modelIdx !== -1 ? process.argv[_modelIdx + 1] : null;
const MODELS: Array<"lang" | "grounded"> = MODEL_ARG === "lang" ? ["lang"] : MODEL_ARG === "grounded" ? ["grounded"] : ["lang", "grounded"];

// ── Photos to test ────────────────────────────────────────────────────────────
// Focus on the ones that rendered badly. samPrompt = text sent to Lang-SAM.
const PHOTOS: Array<{
  name: string;
  path: string;
  surfaceType: string;
  samPrompt: string;
}> = [
  {
    name: "tshirt_man_grey",
    path: "Z:/BOXY/Lab/Bases IA/visant.co_a_closet_shot_of_a_black_man_wearing_blank_grey_shirt_e2f6f437-692e-4462-bcef-96657c8f1f28.png",
    surfaceType: "tshirt",
    samPrompt: "blank grey t-shirt front, shirt chest print area",
  },
  {
    name: "tshirt_man_black",
    path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.run4wtZHuIqWzc_a_closet_shot_of_a_black_man_8512232c-711a-4205-b057-82931b712550.png",
    surfaceType: "tshirt",
    samPrompt: "blank black t-shirt front, shirt chest area",
  },
  {
    name: "ve_outdoor_2",
    path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349399816.png",
    surfaceType: "billboard",
    samPrompt: "billboard panel, outdoor advertising panel, blank white panel",
  },
  {
    name: "ve_outdoor_1",
    path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738087254803.png",
    surfaceType: "poster",
    samPrompt: "poster, outdoor poster, blank white poster board",
  },
  {
    name: "woman_texting",
    path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runDNbQlpi_wgI_a_woman_walking_and_texting__5178cfd7-52da-430c-adff-a2a7f131409c.png",
    surfaceType: "fabric",
    samPrompt: "blank white shirt front, jacket print area, clothing",
  },
  {
    name: "boxes_1",
    path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runYnnnQDbY6fE_a_woman_holdin_3_big_shippin_21bd2d19-015d-44a8-ab36-4773f5cdac7a.png",
    surfaceType: "box",
    samPrompt: "shipping cardboard box, blank cardboard box side",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Draw a coloured quad outline on an image buffer for visual debugging. */
async function overlayQuad(
  photoPath: string,
  quad: any,
  color = "#00FF00",
): Promise<Buffer> {
  const meta = await sharp(photoPath).metadata();
  const W = meta.width!, H = meta.height!;
  const svg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <polygon
        points="${quad.tl.x},${quad.tl.y} ${quad.tr.x},${quad.tr.y} ${quad.br.x},${quad.br.y} ${quad.bl.x},${quad.bl.y}"
        fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="20,10"
      />
      <circle cx="${quad.tl.x}" cy="${quad.tl.y}" r="12" fill="${color}" />
      <circle cx="${quad.tr.x}" cy="${quad.tr.y}" r="12" fill="${color}" />
      <circle cx="${quad.br.x}" cy="${quad.br.y}" r="12" fill="${color}" />
      <circle cx="${quad.bl.x}" cy="${quad.bl.y}" r="12" fill="${color}" />
      <text x="${quad.tl.x + 16}" y="${quad.tl.y + 4}" font-size="28" fill="${color}" font-family="monospace">TL</text>
      <text x="${quad.tr.x - 48}" y="${quad.tr.y + 4}" font-size="28" fill="${color}" font-family="monospace">TR</text>
      <text x="${quad.br.x - 48}" y="${quad.br.y + 20}" font-size="28" fill="${color}" font-family="monospace">BR</text>
      <text x="${quad.bl.x + 16}" y="${quad.bl.y + 20}" font-size="28" fill="${color}" font-family="monospace">BL</text>
    </svg>`;
  return sharp(photoPath).composite([{ input: Buffer.from(svg), blend: "over" }]).png().toBuffer();
}

async function main() {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error("❌ REPLICATE_API_TOKEN not set in .env.local");
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });

  const { detectQuadSAM } = await import("../src/lib/sam-mask");
  const { buildPhotoSceneDoc } = await import("../src/lib/photo-scene");
  const { extractGrayscaleLayers, extractMask, extractColorCastLayer } = await import("../src/lib/photo-shadow");
  const { renderScene } = await import("@visant/psd-engine");

  const report: any[] = [];

  for (const photo of PHOTOS) {
    if (PHOTO_FILTER && !PHOTO_FILTER.has(photo.name)) continue;
    if (!existsSync(photo.path)) { console.warn(`⚠ Not found: ${photo.path}`); continue; }

    const meta = await sharp(photo.path).metadata();
    const W = meta.width!, H = meta.height!;

    console.log(`\n${"─".repeat(60)}`);
    console.log(`${ts()} 📸 [${photo.name}] ${W}×${H}`);

    const entry: any = { name: photo.name, W, H, results: {} };

    for (const model of MODELS) {
      console.log(`${ts()} 🧠 SAM/${model} — "${photo.samPrompt}"`);
      const result = await detectQuadSAM(photo.path, photo.samPrompt, photo.surfaceType, W, H, model);

      if (!result) {
        console.warn(`${ts()} ⚠ SAM/${model} returned null`);
        entry.results[model] = { error: "null result" };
        continue;
      }

      const { quad, maskBuf } = result;
      const qW = quad.tr.x - quad.tl.x;
      const qH = quad.bl.y - quad.tl.y;
      console.log(`${ts()} ✓ quad ${qW}×${qH}px | TL(${quad.tl.x},${quad.tl.y}) BR(${quad.br.x},${quad.br.y})`);

      // Save mask
      await writeFile(resolve(OUT, `${photo.name}-${model}-mask.png`), maskBuf);

      // Save quad overlay on original photo
      const overlay = await overlayQuad(photo.path, quad, model === "lang" ? "#00EEFF" : "#FF6600");
      await writeFile(resolve(OUT, `${photo.name}-${model}-overlay.png`), overlay);

      // Render mockup with SAM quad
      const analysis = {
        quad, imageWidth: W, imageHeight: H,
        surfaceType: photo.surfaceType, avgLightness: 0.80, confidence: 0.95,
        material: "matte", hasOcclusion: false, occlusionDesc: "", lightingDir: "ambient",
      };

      // Lighting
      const isCard = photo.surfaceType === "card" || photo.surfaceType === "paper";
      const { screen, multiply } = await extractGrayscaleLayers(photo.path, quad, undefined, 0, 0);
      const castBuf = await extractColorCastLayer(photo.path, W, H, quad);

      const doc = buildPhotoSceneDoc(analysis, {
        screenOpacity: 0.15,
        multiplyOpacity: isCard ? 0.30 : 0.35,
      });
      const face = doc.faces[0];

      // Simple test art: solid blue
      const artCanvas = createCanvas(face.innerW, face.innerH);
      const artCtx = artCanvas.getContext("2d");
      artCtx.fillStyle = "#0057FF";
      artCtx.fillRect(0, 0, face.innerW, face.innerH);
      artCtx.fillStyle = "#FFFFFF";
      artCtx.font = `bold ${Math.round(Math.min(face.innerW, face.innerH) * 0.12)}px Arial`;
      artCtx.textAlign = "center";
      artCtx.textBaseline = "middle";
      artCtx.fillText(`SAM/${model}`, face.innerW / 2, face.innerH / 2);

      const { loadImage } = require("canvas");
      const [photoImg, screenImg, multiplyImg, maskImg] = await Promise.all([
        loadImage(photo.path), loadImage(screen), loadImage(multiply), loadImage(maskBuf),
      ]);
      const assets: any = { photo: photoImg, light_screen: screenImg, light_multiply: multiplyImg, mask: maskImg };

      const canvas = renderScene(doc, assets, { surface: artCanvas }, createCanvas);
      const resultBuf: Buffer = (canvas as any).toBuffer("image/png");
      await writeFile(resolve(OUT, `${photo.name}-${model}-result.png`), resultBuf);

      console.log(`${ts()} ✅ Saved mask + overlay + result`);
      entry.results[model] = { quad, quadW: qW, quadH: qH };
    }

    report.push(entry);
  }

  await writeFile(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);
  console.log(`\nFiles per photo: *-mask.png, *-overlay.png, *-result.png`);
  console.log(`  lang (cyan outline) vs grounded (orange outline)`);
}

main().catch(e => { console.error(e); process.exit(1); });
