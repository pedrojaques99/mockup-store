/**
 * Renders art layouts onto photo mockup scenes using cached quad/lighting from photo-detect.
 * SSOT: adicionar fotos em TARGETS, rodar photo-detect primeiro pra gerar cache.
 *
 * bun --env-file=.env.local scripts/photo-render.ts
 * bun --env-file=.env.local scripts/photo-render.ts --only nm_billboard_urbano,nm_lobby_corporativo
 */
import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";
const { createCanvas, loadImage } = require("canvas");

const OUT = resolve("Render/Output");
const CACHE_DIR = resolve(".tmp/photo-test-cv");
const ART_DIR = resolve("Render/Art");
const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

// --only filter: bun scripts/photo-render.ts --only nm_billboard_urbano,sp_paulista_billboard
const _onlyIdx = process.argv.indexOf("--only");
const onlyArg = _onlyIdx !== -1 ? process.argv[_onlyIdx + 1] : null;
const ONLY = onlyArg && !onlyArg.startsWith("--") ? new Set(onlyArg.split(",")) : null;

// Photos to process — reuse cached LLM/neon quads
const TARGETS = [
  // SP elegant scenes
  { name: "sp_vilamadelena_poster",  path: ".tmp/photo-test-cv/visant-gen/sp_vilamadelena_poster.png",  artFrame: "Frame 4089.png" },
  { name: "sp_ibirapuera_busstop",   path: ".tmp/photo-test-cv/visant-gen/sp_ibirapuera_busstop.png",   artFrame: "Frame 4090.png" },
  { name: "sp_pinheiros_cafe",       path: ".tmp/photo-test-cv/visant-gen/sp_pinheiros_cafe.png",       artFrame: "Frame 4091.png" },
  { name: "sp_jardins_storefront",   path: ".tmp/photo-test-cv/visant-gen/sp_jardins_storefront.png",   artFrame: "Frame 4092.png" },
  { name: "sp_paulista_billboard",   path: ".tmp/photo-test-cv/visant-gen/sp_paulista_billboard.png",   artFrame: "Frame 4093.png" },
  // Real photos
  { name: "card",            path: "Z:/BOXY/Lab/Bases IA/man black clothes card to face.png",   artFrame: "Frame 4094.png" },
  { name: "poster_shadow",   path: "Z:/BOXY/Lab/Bases IA/visant.co_interesting_angle_shot_photography_of_a_blank_169_rat_877f00c4-1328-46c1-814c-81447fd6826e.png", artFrame: "Frame 4095.png" },
  { name: "billboard_graffiti", path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349407787.png", artFrame: "Frame 4096.png" },
  { name: "wall",            path: "Z:/BOXY/Lab/Bases IA/IN-SITU-007_HOVER-1465x980.png",      artFrame: "Frame 4097.png" },
  { name: "poster_busstop",  path: "Z:/BOXY/Lab/Bases IA/visant.co_interesting_angle_shot_photography_of_a_blank_white_b_3d9e8928-9afc-4452-a668-0824f4ffa204.png", artFrame: "Frame 4098.png" },
  // New Mockups — neon magenta scenes (cache em photo-test-cv com prefixo nm_)
  { name: "nm_billboard_urbano",    path: "Render/New Mockups/01_billboard_urbano.png",    artFrame: "Frame 4089.png" },
  { name: "nm_cafe_poster",         path: "Render/New Mockups/02_cafe_poster.png",         artFrame: "Frame 4090.png" },
  { name: "nm_storefront_vitrine",  path: "Render/New Mockups/03_storefront_vitrine.png",  artFrame: "Frame 4091.png" },
  { name: "nm_lobby_corporativo",   path: "Render/New Mockups/04_lobby_corporativo.png",   artFrame: "Frame 4092.png" },
  { name: "nm_busstop_shelter",     path: "Render/New Mockups/05_busstop_shelter.png",     artFrame: "Frame 4093.png" },
  { name: "nm_gallery_wall",        path: "Render/New Mockups/06_gallery_wall.png",        artFrame: "Frame 4094.png" },
  { name: "nm_restaurant_entrance", path: "Render/New Mockups/07_restaurant_entrance.png", artFrame: "Frame 4095.png" },
  { name: "nm_coworking_office",    path: "Render/New Mockups/08_coworking_office.png",    artFrame: "Frame 4096.png" },
  { name: "nm_street_kiosk",        path: "Render/New Mockups/09_street_kiosk.png",        artFrame: "Frame 4097.png" },
  { name: "nm_hotel_lobby",         path: "Render/New Mockups/10_hotel_lobby.png",         artFrame: "Frame 4098.png" },
  // Bases IA — apparel, packaging, outdoor ads
  { name: "tshirt_man_grey",  path: "Z:/BOXY/Lab/Bases IA/visant.co_a_closet_shot_of_a_black_man_wearing_blank_grey_shirt_e2f6f437-692e-4462-bcef-96657c8f1f28.png", artFrame: "Frame 4089.png" },
  { name: "tshirt_man_black", path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.run4wtZHuIqWzc_a_closet_shot_of_a_black_man_8512232c-711a-4205-b057-82931b712550.png", artFrame: "Frame 4090.png" },
  { name: "woman_texting",    path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runDNbQlpi_wgI_a_woman_walking_and_texting__5178cfd7-52da-430c-adff-a2a7f131409c.png",  artFrame: "Frame 4091.png" },
  { name: "boxes_1",          path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runYnnnQDbY6fE_a_woman_holdin_3_big_shippin_21bd2d19-015d-44a8-ab36-4773f5cdac7a.png",   artFrame: "Frame 4092.png" },
  { name: "boxes_2",          path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runYnnnQDbY6fE_a_woman_holdin_3_big_shippin_550cc82f-24f0-4163-ac98-9da7eb7e53d2.png",   artFrame: "Frame 4093.png" },
  { name: "boxes_3",          path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runYnnnQDbY6fE_a_woman_holdin_3_big_shippin_e464a152-011c-47da-8b58-73a4763cfa5c.png",   artFrame: "Frame 4094.png" },
  { name: "ve_outdoor_1",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738087254803.png",   artFrame: "Frame 4095.png" },
  { name: "ve_outdoor_2",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349399816.png",   artFrame: "Frame 4096.png" },
  { name: "ve_outdoor_3",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349409602.png",   artFrame: "Frame 4097.png" },
  { name: "ve_outdoor_4",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349420694.png",   artFrame: "Frame 4098.png" },
  { name: "ve_outdoor_5",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349424403.png",   artFrame: "Frame 4099.png" },
  { name: "ve_outdoor_6",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349437725.png",   artFrame: "Frame 4100.png" },
];

/**
 * Apply a subtle grain overlay to a rendered canvas — same as Photoshop's Add Noise.
 * Replicates the last step of the PS smart-object mockup workflow:
 *   grain σ ≈ 18px @ 9% overlay → integrates art texture with scene noise.
 * @param intensity  Max noise deviation per channel (1-255). Default 18.
 * @param opacity    Blend opacity (0-1). Default 0.09.
 */
function applyGrain(canvas: any, createCanvasFn: any, intensity = 18, opacity = 0.09): void {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");
  const grain = createCanvasFn(W, H);
  const gCtx = grain.getContext("2d");
  const img = gCtx.createImageData(W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = Math.round((Math.random() - 0.5) * 2 * intensity) + 128;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, n));
    img.data[i + 3] = 255;
  }
  gCtx.putImageData(img, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = "overlay";
  ctx.drawImage(grain, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

async function loadCachedAnalysis(name: string): Promise<any | null> {
  const p = resolve(CACHE_DIR, `${name}-analysis.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8"));
}

/** Scale/crop art image to fit face dimensions (cover mode). */
function scaleArtToFace(artImg: any, faceW: number, faceH: number): any {
  const c = createCanvas(faceW, faceH);
  const ctx = c.getContext("2d");
  const artRatio = artImg.width / artImg.height;
  const faceRatio = faceW / faceH;
  let sx = 0, sy = 0, sw = artImg.width, sh = artImg.height;
  if (artRatio > faceRatio) {
    sw = artImg.height * faceRatio;
    sx = (artImg.width - sw) / 2;
  } else {
    sh = artImg.width / faceRatio;
    sy = (artImg.height - sh) / 2;
  }
  ctx.drawImage(artImg, sx, sy, sw, sh, 0, 0, faceW, faceH);
  return c;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const { extractGrayscaleLayers, extractMask } = await import("../src/lib/photo-shadow");
  const { buildPhotoSceneDoc } = await import("../src/lib/photo-scene");
  const { renderScene } = await import("@visant/psd-engine");

  for (const target of TARGETS) {
    if (ONLY && !ONLY.has(target.name)) continue;
    console.log(`\n${"─".repeat(60)}`);
    console.log(`${ts()} 📸 [${target.name}]`);

    if (!existsSync(target.path)) {
      console.warn(`  ⚠ Not found: ${target.path}`); continue;
    }

    // Load cached analysis (quad + surface type)
    const analysis = await loadCachedAnalysis(target.name);
    if (!analysis) {
      console.warn(`  ⚠ No cached quad for ${target.name} — run test-pipeline-cv first`); continue;
    }

    const meta = await sharp(target.path).metadata();
    const W = meta.width!, H = meta.height!;
    const { quad, surfaceType } = analysis;

    const isCard = surfaceType === "card" || surfaceType === "paper";
    const isBillboard = surfaceType === "billboard" || surfaceType === "poster";

    // Lighting layers (reuse cached if available)
    const screenPath  = resolve(CACHE_DIR, `${target.name}-screen.png`);
    const multiplyPath = resolve(CACHE_DIR, `${target.name}-multiply.png`);
    const maskPath    = resolve(CACHE_DIR, `${target.name}-mask.png`);

    let screenBuf: Buffer, multiplyBuf: Buffer, maskBuf: Buffer;

    if (existsSync(screenPath) && existsSync(multiplyPath) && existsSync(maskPath)) {
      [screenBuf, multiplyBuf, maskBuf] = await Promise.all([
        readFile(screenPath), readFile(multiplyPath), readFile(maskPath)
      ]);
      console.log(`${ts()} ✓ Reusing cached lighting layers`);
    } else {
      // Recompute
      const multiplyFloor = isCard ? 0 : 200;
      const lightingPreBlur = !isCard && !isBillboard ? 25 : 0;
      const { screen, multiply } = await extractGrayscaleLayers(target.path, quad, undefined, multiplyFloor, lightingPreBlur);
      screenBuf = screen; multiplyBuf = multiply;
      maskBuf = await extractMask(W, H, quad, 4);
      console.log(`${ts()} ✓ Fresh lighting layers`);
    }

    // Load Padoo art frame
    const artPath = `${ART_DIR}/${target.artFrame}`;
    if (!existsSync(artPath)) {
      console.warn(`  ⚠ Art not found: ${artPath}`); continue;
    }

    // Build scene doc + render
    const doc = buildPhotoSceneDoc(analysis, {
      screenOpacity:   isCard ? 0 : isBillboard ? 0 : 0.20,
      multiplyOpacity: isCard ? 0.30 : isBillboard ? 0 : 0.45,
    });
    const face = doc.faces[0];
    console.log(`${ts()} ✓ face ${face.innerW}×${face.innerH} | ${surfaceType}`);

    // Use neutralized photo if available — avoids neon/magenta bleed at mask edges.
    // Generated by test-pipeline-cv.ts for genuine neon images (neonMagenta: true).
    const neutralizedPhotoPath = resolve(CACHE_DIR, `${target.name}-photo.png`);
    const photoPath = existsSync(neutralizedPhotoPath) ? neutralizedPhotoPath : target.path;

    const castPath = resolve(CACHE_DIR, `${target.name}-cast.png`);
    const dispPath = resolve(CACHE_DIR, `${target.name}-disp.png`);
    const castBuf  = existsSync(castPath) ? await readFile(castPath) : null;
    const dispBuf  = existsSync(dispPath) ? await readFile(dispPath) : null;

    const [photoImg, screenImg, multiplyImg, maskImg, padooArtImg, castImg, dispImg] = await Promise.all([
      loadImage(photoPath),
      loadImage(screenBuf),
      loadImage(multiplyBuf),
      loadImage(maskBuf),
      loadImage(artPath),
      castBuf ? loadImage(castBuf) : Promise.resolve(null),
      dispBuf ? loadImage(dispBuf) : Promise.resolve(null),
    ]);

    const artCanvas = scaleArtToFace(padooArtImg, face.innerW, face.innerH);

    const assets: Record<string, any> = {
      photo: photoImg,
      light_screen: screenImg,
      light_multiply: multiplyImg,
      mask: maskImg,
    };
    if (castImg) assets.color_cast = castImg;
    if (dispImg) assets.displacement = dispImg;

    const canvas = renderScene(doc, assets, { surface: artCanvas }, createCanvas);

    // Grain overlay — integrates art texture with scene noise (replicates PS Add Noise step)
    applyGrain(canvas, createCanvas);

    const outPath = resolve(OUT, `${target.name}-padoo.png`);
    await writeFile(outPath, (canvas as any).toBuffer("image/png"));
    console.log(`${ts()} ✅ ${outPath.split("\\").pop()}`);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
