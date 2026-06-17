/**
 * Pixel-perfect prep for our generated magenta scenes — reuses the app's own
 * CV neon pipeline (findNeonQuad) + psd-engine render. Zero LLM.
 *
 * Renders a debug-green calibration art (corner triangles + crosshair) into each
 * scene's magenta surface so any warp/perspective error is instantly visible,
 * AND writes a pixel-perfect analysis.json (quad + surfaceType) next to the result.
 *
 * Run: bun --env-file=.env.local scripts/prepare-hockey.ts
 */
import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, basename } from "path";
import sharp from "sharp";
const { createCanvas, loadImage } = require("canvas");

const OUT = resolve(".tmp/hockey-prepared");

// hue: force magenta hueCenter (~328° for #FF1493) on blue-dominant cinematic
// scenes, otherwise the auto vivid-hue detector locks onto the blue background.
const SCENES: Array<{ name: string; path: string; hue?: number }> = [
  { name: "jersey",         path: "Z:/BOXY/mockup-store/Render/New Mockups/Hockey_Brand_2026-06-16/04_jersey__nano-banana-pro.png" },
  { name: "duffel_bag",     path: "Z:/BOXY/mockup-store/Render/New Mockups/Hockey_Brand_2026-06-16/06_duffel_bag__gpt-image-2.png" },
  { name: "blade_taping",   path: "Z:/BOXY/mockup-store/Render/New Mockups/Hockey_Brand_2026-06-16/Cinematic_Maison/14_blade_taping__gpt-image-2.png", hue: 328 },
  { name: "helmet_tunnel",  path: "Z:/BOXY/mockup-store/Render/New Mockups/Hockey_Brand_2026-06-16/Cinematic_Maison/15_helmet_tunnel__gpt-image-2.png", hue: 328 },
  { name: "paulista",       path: "Z:/BOXY/mockup-store/Render/New Mockups/BR_Scenes_2026-06-16/11_paulista_billboard__gemini-3-pro.png" },
];

/** Vivid green debug canvas — corner triangles + crosshair + edge ticks. */
function makeArtDebugGreen(w: number, h: number): any {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#00E64D";
  ctx.fillRect(0, 0, w, h);
  const cs = Math.round(Math.min(w, h) * 0.18);
  ([[0,0,"#FF2222"],[w,0,"#2255FF"],[w,h,"#FFE000"],[0,h,"#FFFFFF"]] as Array<[number,number,string]>).forEach(([cx,cy,col],i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (i===0||i===3?cs:-cs), cy);
    ctx.lineTo(cx, cy + (i===0||i===1?cs:-cs));
    ctx.closePath();
    ctx.fill();
  });
  const lw = Math.max(2, Math.round(Math.min(w,h)*0.012));
  ctx.strokeStyle = "#000"; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
  const tk = Math.round(Math.min(w,h)*0.04);
  for (const frac of [0.25, 0.75]) {
    ctx.beginPath(); ctx.moveTo(w*frac-tk,0); ctx.lineTo(w*frac+tk,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w*frac-tk,h); ctx.lineTo(w*frac+tk,h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,h*frac-tk); ctx.lineTo(0,h*frac+tk); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w,h*frac-tk); ctx.lineTo(w,h*frac+tk); ctx.stroke();
  }
  return c;
}

/** Draw the detected quad outline + corner dots over the original for QA. */
async function saveQuadOverlay(srcPath: string, W: number, H: number, q: any, outPath: string) {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.drawImage(await loadImage(srcPath), 0, 0, W, H);
  ctx.strokeStyle = "#00FF00"; ctx.lineWidth = Math.max(2, W*0.003);
  ctx.beginPath();
  ctx.moveTo(q.tl.x,q.tl.y); ctx.lineTo(q.tr.x,q.tr.y);
  ctx.lineTo(q.br.x,q.br.y); ctx.lineTo(q.bl.x,q.bl.y); ctx.closePath(); ctx.stroke();
  const r = Math.max(4, W*0.006);
  ([["tl","#FF2222"],["tr","#2255FF"],["br","#FFE000"],["bl","#FFFFFF"]] as Array<[string,string]>).forEach(([k,col])=>{
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q[k].x,q[k].y,r,0,Math.PI*2); ctx.fill();
  });
  await writeFile(outPath, (c as any).toBuffer("image/png"));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const { findNeonQuad } = await import("../src/lib/photo-detect");
  const { extractGrayscaleLayers, extractMask, expandQuad, neutralizeNeonPixels } = await import("../src/lib/photo-shadow");
  const { buildPhotoSceneDoc } = await import("../src/lib/photo-scene");
  const { renderScene } = await import("@visant/psd-engine");

  for (const s of SCENES) {
    console.log(`\n── ${s.name} ──`);
    if (!existsSync(s.path)) { console.warn(`  ⚠ not found: ${s.path}`); continue; }
    const meta = await sharp(s.path).metadata();
    const W = meta.width!, H = meta.height!;

    const quad = await findNeonQuad(s.path, W, H, s.hue, s.hue ? 25 : 40);
    if (!quad) { console.warn(`  ⚠ no neon surface detected`); continue; }
    console.log(`  quad TL(${quad.tl.x},${quad.tl.y}) TR(${quad.tr.x},${quad.tr.y}) BR(${quad.br.x},${quad.br.y}) BL(${quad.bl.x},${quad.bl.y})`);

    const analysis = {
      quad, surfaceType: "poster", material: "matte", hasOcclusion: false,
      occlusionDesc: "", lightingDir: "ambient", confidence: 0.99,
      imageWidth: W, imageHeight: H, avgLightness: 0.8,
    };
    await writeFile(resolve(OUT, `${s.name}-analysis.json`), JSON.stringify(analysis, null, 2));
    await saveQuadOverlay(s.path, W, H, quad, resolve(OUT, `${s.name}-quad.png`));

    // Neutralize magenta → grayscale (keeps real lighting), expand mask to cover boundary
    const photoBuf = await neutralizeNeonPixels(s.path, W, H);
    const maskQuad = expandQuad(quad, 25, W, H);
    const maskBuf = await extractMask(W, H, maskQuad, 0);
    const { screen, multiply } = await extractGrayscaleLayers(photoBuf, quad, undefined, 0, 0);

    const doc = buildPhotoSceneDoc(analysis, { screenOpacity: 0.2, multiplyOpacity: 0.45 });
    const face = doc.faces[0];
    const art = makeArtDebugGreen(face.innerW, face.innerH);

    const assets: any = {
      photo: await loadImage(photoBuf),
      light_screen: await loadImage(screen),
      light_multiply: await loadImage(multiply),
      mask: await loadImage(maskBuf),
    };
    const canvas = renderScene(doc, assets, { surface: art }, createCanvas);
    await writeFile(resolve(OUT, `${s.name}-result.png`), (canvas as any).toBuffer("image/png"));
    console.log(`  ✅ ${s.name}-result.png (face ${face.innerW}×${face.innerH})`);
  }
  console.log(`\nDone — ${OUT}`);
}
main().catch(e => { console.error(e); process.exit(1); });
