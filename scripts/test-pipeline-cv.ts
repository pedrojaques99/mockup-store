/**
 * Pipeline test — hybrid CV+LLM detection strategy:
 *  - Walls/posters: CV-only (HSL threshold, zero LLM cost)
 *  - Cards/occluded: LLM for QUAD (handles occlusion + full extent) + CV pixel mask
 * CV pixel mask = actual white-surface pixels, so fingers naturally occlude art.
 * Roda com: bun --env-file=.env.local scripts/test-pipeline-cv.ts
 */
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";
const { createCanvas, loadImage } = require("canvas");

const OUT = resolve(".tmp/photo-test-cv");
const t0 = Date.now();
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;

// Known-good quads for photos where LLM only detects the VISIBLE portion.
// Card: LLM detects x=717-1843 (1126px wide), but only y=699-860 (fingers hide rest).
// Full card at standard 3.5×2" ratio (1.75:1): height = 1126/1.75 = 643px → y=699-1342.
// Wall: LLM cut off right edge at x=1260 but wall extends to x=1460 (watermark sits at x≈1350-1420).
const OVERRIDE_QUADS: Record<string, any> = {
  card: {
    quad: { tl: { x: 717, y: 624 }, tr: { x: 1843, y: 624 }, br: { x: 1843, y: 1267 }, bl: { x: 717, y: 1267 } },
    surfaceType: "card", material: "matte", hasOcclusion: true,
    occlusionDesc: "fingers holding bottom of card", lightingDir: "ambient", confidence: 0.95,
  },
  wall: {
    quad: { tl: { x: 0, y: 147 }, tr: { x: 1460, y: 147 }, br: { x: 1460, y: 784 }, bl: { x: 0, y: 784 } },
    surfaceType: "wall", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.95,
  },
  // gallery_wall: neon H≈325° (hot pink) outside default range → LLM detected full wall.
  // Pixel scan (H=280-345°, S≥0.40): canvas at TL(432,248) TR(881,248) BR(881,751) BL(432,751).
  nm_gallery_wall: {
    quad: { tl: { x: 432, y: 248 }, tr: { x: 881, y: 248 }, br: { x: 881, y: 751 }, bl: { x: 432, y: 751 } },
    surfaceType: "billboard", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.98,
  },
  // restaurant_entrance: LLM detected only half the frame (x=154-614). Full panel: TL(289,127)→BR(670,778).
  nm_restaurant_entrance: {
    quad: { tl: { x: 289, y: 127 }, tr: { x: 670, y: 127 }, br: { x: 670, y: 778 }, bl: { x: 289, y: 778 } },
    surfaceType: "billboard", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.98,
  },
  // LLM detected landscape 957×676 but poster is portrait; manually set correct portrait quad.
  // Image 2816×1536: poster white surface (inside black frame) ~x=940-1410, y=80-1450.
  poster_graffiti: {
    quad: { tl: { x: 940, y: 80 }, tr: { x: 1410, y: 80 }, br: { x: 1410, y: 1450 }, bl: { x: 940, y: 1450 } },
    surfaceType: "poster", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.95,
  },
  // Generated billboard_sp: LLM only detected 328px but face is 403px. Pixel scan (L>0.86): x=373-776, y=340-1155.
  vg_billboard_sp: {
    quad: { tl: { x: 373, y: 340 }, tr: { x: 776, y: 340 }, br: { x: 776, y: 1155 }, bl: { x: 373, y: 1155 } },
    surfaceType: "billboard", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.97,
  },
  // Generated card_hands: pixel scan (L>0.86): x=243-787, y=580-910.
  vg_card_hands: {
    quad: { tl: { x: 243, y: 575 }, tr: { x: 787, y: 575 }, br: { x: 787, y: 912 }, bl: { x: 243, y: 912 } },
    surfaceType: "card", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.97,
  },
  // storefront_vitrine: neon detection returned degenerate 330×6px quad.
  // Pixel scan (H=220-360°, S≥0.40, step=2): TL(172,48) TR(814,56) BR(812,832) BL(86,684).
  nm_storefront_vitrine: {
    quad: { tl: { x: 172, y: 48 }, tr: { x: 814, y: 56 }, br: { x: 812, y: 832 }, bl: { x: 86, y: 684 } },
    surfaceType: "billboard", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.97,
  },
  // hotel_lobby: neon detection returned degenerate 1293×65px quad.
  // Pixel scan (H=220-360°, S≥0.40, step=2): TL(152,198) TR(1284,704) BR(1290,742) BL(144,720).
  nm_hotel_lobby: {
    quad: { tl: { x: 152, y: 198 }, tr: { x: 1284, y: 704 }, br: { x: 1290, y: 742 }, bl: { x: 144, y: 720 } },
    surfaceType: "billboard", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.97,
  },
  // LLM detected x=1126-1690 (176px right of actual face). Pixel scan: white face x=950-1480, y=177-1276.
  billboard_beach: {
    quad: { tl: { x: 950, y: 177 }, tr: { x: 1480, y: 177 }, br: { x: 1480, y: 1276 }, bl: { x: 950, y: 1276 } },
    surfaceType: "billboard", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.98,
  },
  // LLM detected x=963-2151 (included sky + right facade). Pixel scan: trapezoidal mural x=1120-1670 top, x=1105-1673 bottom, y=190-1402.
  billboard_building: {
    quad: { tl: { x: 1120, y: 190 }, tr: { x: 1668, y: 190 }, br: { x: 1673, y: 1402 }, bl: { x: 1105, y: 1402 } },
    surfaceType: "billboard", material: "matte", hasOcclusion: false,
    occlusionDesc: "", lightingDir: "ambient", confidence: 0.98,
  },
};

// shadowScene: extract lighting from full image so env shadows transfer onto art.
// sam: text prompt for SAM-based quad detection (Phase 1d) — bypasses LLM for this photo.
const PHOTOS: Array<{ name: string; path: string; forceLLM: boolean; overrideQuad: boolean; shadowScene?: boolean; debugGreen?: boolean; neonMagenta?: boolean; sam?: string }> = [
  // forceLLM: poster has perspective angle so row-scan gives a rectangular bbox.
  // card uses OVERRIDE_QUAD (locks to best-known detection, avoids LLM variance).
  { name: "card",            path: "Z:/BOXY/Lab/Bases IA/man black clothes card to face.png",   forceLLM: false, overrideQuad: true },
  { name: "card2",           path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349397093.png",    forceLLM: true,  overrideQuad: false },
  { name: "poster",          path: "Z:/BOXY/Lab/Bases IA/visant.co_interesting_angle_shots_photography_of_a_blank_poster_197b3d03-f266-48da-b378-24eadb13cf83.png", forceLLM: true,  overrideQuad: false },
  { name: "wall",            path: "Z:/BOXY/Lab/Bases IA/IN-SITU-007_HOVER-1465x980.png",      forceLLM: true,  overrideQuad: true },
  { name: "poster_shadow",   path: "Z:/BOXY/Lab/Bases IA/visant.co_interesting_angle_shot_photography_of_a_blank_169_rat_877f00c4-1328-46c1-814c-81447fd6826e.png", forceLLM: true, overrideQuad: false, shadowScene: true },
  { name: "poster_busstop",  path: "Z:/BOXY/Lab/Bases IA/visant.co_interesting_angle_shot_photography_of_a_blank_white_b_3d9e8928-9afc-4452-a668-0824f4ffa204.png", forceLLM: true, overrideQuad: false },
  { name: "billboard_graffiti", path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349407787.png", forceLLM: true, overrideQuad: false, shadowScene: true },
  { name: "poster_graffiti",   path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349402356.png", forceLLM: true, overrideQuad: true, shadowScene: true },
  { name: "billboard_beach",   path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349405488.png", forceLLM: true, overrideQuad: true },
  { name: "billboard_building", path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349419172.png", forceLLM: true, overrideQuad: true },
  // Visant-generated blanks — debug with vivid green art to validate warp + mask + perspective
  { name: "vg_billboard_sp",    path: ".tmp/photo-test-cv/visant-gen/gen_billboard_sp.png",    forceLLM: true, overrideQuad: true,  debugGreen: true },
  { name: "vg_poster_graffiti", path: ".tmp/photo-test-cv/visant-gen/gen_poster_graffiti.png", forceLLM: true, overrideQuad: false, debugGreen: true },
  { name: "vg_busstop_night",   path: ".tmp/photo-test-cv/visant-gen/gen_busstop_night.png",   forceLLM: true, overrideQuad: false, debugGreen: true },
  { name: "vg_wall_building",   path: ".tmp/photo-test-cv/visant-gen/gen_wall_building.png",   forceLLM: true, overrideQuad: false, debugGreen: true },
  { name: "vg_card_hands",      path: ".tmp/photo-test-cv/visant-gen/gen_card_hands.png",      forceLLM: true, overrideQuad: true,  debugGreen: true },
  // Neon-colored generated bases — zero LLM, pure CV hue detection (findNeonQuad)
  // Auto-detects dominant vivid hue (H=220-360°) — works with any shade the LLM generates.
  { name: "nm_billboard_sp",    path: ".tmp/photo-test-cv/visant-gen/neon_billboard_sp.png",    forceLLM: false, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "nm_poster_graffiti", path: ".tmp/photo-test-cv/visant-gen/neon_poster_graffiti.png", forceLLM: false, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "nm_busstop_night",   path: ".tmp/photo-test-cv/visant-gen/neon_busstop_night.png",   forceLLM: false, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "nm_wall_building",   path: ".tmp/photo-test-cv/visant-gen/neon_wall_building.png",   forceLLM: false, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "nm_card_hands",      path: ".tmp/photo-test-cv/visant-gen/neon_card_hands.png",      forceLLM: false, overrideQuad: false, neonMagenta: true, debugGreen: true },
  // São Paulo elegant scenes — neon magenta surface, LLM-assisted quad detection
  { name: "sp_paulista_billboard",  path: ".tmp/photo-test-cv/visant-gen/sp_paulista_billboard.png",  forceLLM: true, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "sp_vilamadelena_poster", path: ".tmp/photo-test-cv/visant-gen/sp_vilamadelena_poster.png", forceLLM: true, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "sp_jardins_storefront",  path: ".tmp/photo-test-cv/visant-gen/sp_jardins_storefront.png",  forceLLM: true, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "sp_ibirapuera_busstop",  path: ".tmp/photo-test-cv/visant-gen/sp_ibirapuera_busstop.png",  forceLLM: true, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "sp_pinheiros_cafe",      path: ".tmp/photo-test-cv/visant-gen/sp_pinheiros_cafe.png",      forceLLM: true, overrideQuad: false, neonMagenta: true, debugGreen: true },
  // New Mockups — generated scenes with neon magenta surfaces (Render/New Mockups/)
  { name: "nm_billboard_urbano",    path: "Render/New Mockups/01_billboard_urbano.png",    forceLLM: false, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "nm_cafe_poster",         path: "Render/New Mockups/02_cafe_poster.png",         forceLLM: true,  overrideQuad: false, neonMagenta: false, debugGreen: true },
  { name: "nm_storefront_vitrine",  path: "Render/New Mockups/03_storefront_vitrine.png",  forceLLM: false, overrideQuad: true,  neonMagenta: true, debugGreen: true },
  { name: "nm_lobby_corporativo",   path: "Render/New Mockups/04_lobby_corporativo.png",   forceLLM: false, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "nm_busstop_shelter",     path: "Render/New Mockups/05_busstop_shelter.png",     forceLLM: false, overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "nm_gallery_wall",        path: "Render/New Mockups/06_gallery_wall.png",        forceLLM: false, overrideQuad: true,  neonMagenta: true, debugGreen: true },
  { name: "nm_restaurant_entrance", path: "Render/New Mockups/07_restaurant_entrance.png", forceLLM: false, overrideQuad: true,  neonMagenta: true, debugGreen: true },
  { name: "nm_coworking_office",    path: "Render/New Mockups/08_coworking_office.png",    forceLLM: true,  overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "nm_street_kiosk",        path: "Render/New Mockups/09_street_kiosk.png",        forceLLM: true,  overrideQuad: false, neonMagenta: true, debugGreen: true },
  { name: "nm_hotel_lobby",         path: "Render/New Mockups/10_hotel_lobby.png",         forceLLM: false, overrideQuad: true,  neonMagenta: true, debugGreen: true },
  // Bases IA — unexplored scenes: apparel, packaging, outdoor ads
  // sam: bypasses LLM, uses SAM lang model for quad detection (better for apparel/packaging)
  { name: "tshirt_man_grey",  path: "Z:/BOXY/Lab/Bases IA/visant.co_a_closet_shot_of_a_black_man_wearing_blank_grey_shirt_e2f6f437-692e-4462-bcef-96657c8f1f28.png", forceLLM: false, overrideQuad: false, sam: "blank grey t-shirt front chest area" },
  { name: "tshirt_man_black", path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.run4wtZHuIqWzc_a_closet_shot_of_a_black_man_8512232c-711a-4205-b057-82931b712550.png", forceLLM: false, overrideQuad: false, sam: "blank black t-shirt front chest area" },
  { name: "woman_texting",    path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runDNbQlpi_wgI_a_woman_walking_and_texting__5178cfd7-52da-430c-adff-a2a7f131409c.png",  forceLLM: false, overrideQuad: false, sam: "blank white shirt front jacket print area" },
  { name: "boxes_1",          path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runYnnnQDbY6fE_a_woman_holdin_3_big_shippin_21bd2d19-015d-44a8-ab36-4773f5cdac7a.png",   forceLLM: false, overrideQuad: false, sam: "cardboard shipping box blank side" },
  { name: "boxes_2",          path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runYnnnQDbY6fE_a_woman_holdin_3_big_shippin_550cc82f-24f0-4163-ac98-9da7eb7e53d2.png",   forceLLM: false, overrideQuad: false, sam: "cardboard shipping box blank side" },
  { name: "boxes_3",          path: "Z:/BOXY/Lab/Bases IA/visant.co_httpss.mj.runYnnnQDbY6fE_a_woman_holdin_3_big_shippin_e464a152-011c-47da-8b58-73a4763cfa5c.png",   forceLLM: false, overrideQuad: false, sam: "cardboard shipping box blank side" },
  { name: "ve_outdoor_1",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738087254803.png",   forceLLM: false, overrideQuad: false, shadowScene: true, sam: "outdoor advertising poster blank white poster" },
  { name: "ve_outdoor_2",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349399816.png",   forceLLM: false, overrideQuad: false, shadowScene: true, sam: "billboard advertising panel blank white panel" },
  { name: "ve_outdoor_3",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349409602.png",   forceLLM: true,  overrideQuad: false, shadowScene: true },
  { name: "ve_outdoor_4",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349420694.png",   forceLLM: true,  overrideQuad: false, shadowScene: true },
  { name: "ve_outdoor_5",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349424403.png",   forceLLM: true,  overrideQuad: false, shadowScene: true },
  { name: "ve_outdoor_6",     path: "Z:/BOXY/Lab/Bases IA/visualelectric-1738349437725.png",   forceLLM: true,  overrideQuad: false, shadowScene: true },
];

// Detection opts per photo — tunable per surface type.
// Card: man holds white card against dark clothes/bg. Row coverage ~21% at L>=0.55/S<=0.25
// so minRowFraction must be below that. Card rows span ~627-986 (~20% of 1792px height).
const DETECT_OPTS: Record<string, import("../src/lib/photo-detect").DetectionOptions> = {
  card:   { minLightness: 0.55, maxSaturation: 0.28, minRowFraction: 0.15, sampleStep: 2, minHeightFraction: 0.03 },
  poster: { minLightness: 0.80, maxSaturation: 0.14, minRowFraction: 0.20, sampleStep: 2 },
  wall:   { minLightness: 0.65, maxSaturation: 0.20, minRowFraction: 0.20, sampleStep: 3 },
};

/** Light version — warm white bg with dark text. Shadow effect is subtle but elegant. */
function makeArtLight(w: number, h: number, label: string): any {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#fafafa");
  grad.addColorStop(1, "#f0ebe5");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const borderH = Math.max(3, h * 0.012);
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, w, borderH);

  let logoSize = Math.max(24, Math.round(Math.min(w * 0.14, h * 0.36)));
  ctx.font = `bold ${logoSize}px Arial, sans-serif`;
  while (ctx.measureText("VISANT").width > w * 0.50 && logoSize > 18) {
    logoSize -= 2;
    ctx.font = `bold ${logoSize}px Arial, sans-serif`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VISANT", w / 2, h * 0.38, Math.floor(w * 0.82));

  const divW = Math.max(40, w * 0.22);
  ctx.fillStyle = "#c0bbb6";
  ctx.fillRect(w / 2 - divW / 2, h * 0.55, divW, 1);

  const subSize = Math.max(10, Math.round(logoSize * 0.26));
  ctx.fillStyle = "#9a9590";
  ctx.font = `300 ${subSize}px Arial`;
  ctx.fillText(label.toUpperCase() + " MOCKUP", w / 2, h * 0.68);

  ctx.fillStyle = "#c0bbb6";
  ctx.font = `300 ${Math.max(8, Math.round(subSize * 0.80))}px Arial`;
  ctx.textAlign = "right";
  ctx.fillText("visantlabs.com", w * 0.96, h * 0.90);

  return c;
}

/** Dark version — navy bg with white text. Shadow/multiply effect is maximally visible. */
function makeArtDark(w: number, h: number, label: string): any {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#0f1923");
  grad.addColorStop(1, "#1a2535");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Gold accent top
  const borderH = Math.max(4, h * 0.022);
  const borderGrad = ctx.createLinearGradient(0, 0, w, 0);
  borderGrad.addColorStop(0, "#c9a84c");
  borderGrad.addColorStop(0.5, "#f0d070");
  borderGrad.addColorStop(1, "#c9a84c");
  ctx.fillStyle = borderGrad;
  ctx.fillRect(0, 0, w, borderH);

  // Top-compact layout: VISANT in top 28% so it shows in the visible card strip.
  // Cairo/Pango reports ~1.55x narrower than actual for weight-900 / Arial Black.
  // Use bold + 0.50 threshold + maxWidth backstop (same fix as makeArtSolid).
  let logoSize = Math.max(24, Math.round(Math.min(w * 0.14, h * 0.28)));
  ctx.font = `bold ${logoSize}px Arial, sans-serif`;
  while (ctx.measureText("VISANT").width > w * 0.50 && logoSize > 18) {
    logoSize -= 2;
    ctx.font = `bold ${logoSize}px Arial, sans-serif`;
  }
  ctx.fillStyle = "#f5f0e8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VISANT", w / 2, h * 0.16, Math.floor(w * 0.82));

  const divW = Math.max(40, w * 0.22);
  const divGrad = ctx.createLinearGradient(w / 2 - divW / 2, 0, w / 2 + divW / 2, 0);
  divGrad.addColorStop(0, "transparent");
  divGrad.addColorStop(0.5, "#c9a84c");
  divGrad.addColorStop(1, "transparent");
  ctx.fillStyle = divGrad;
  ctx.fillRect(w / 2 - divW / 2, h * 0.26, divW, 1);

  const subSize = Math.max(10, Math.round(logoSize * 0.26));
  ctx.fillStyle = "#8a9aaa";
  ctx.font = `300 ${subSize}px Arial`;
  ctx.fillText(label.toUpperCase() + " MOCKUP", w / 2, h * 0.33);

  ctx.fillStyle = "#c9a84c";
  ctx.font = `300 ${Math.max(8, Math.round(subSize * 0.80))}px Arial`;
  ctx.textAlign = "right";
  ctx.fillText("visantlabs.com", w * 0.96, h * 0.90);

  return c;
}

/** Solid color fill — tests occlusion/lighting with maximum contrast. */
function makeArtSolid(w: number, h: number, color: string): any {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  // White brand name centered — auto-fit: reduce size until text fits 82% of width.
  // Arial Black renders wider than em-size; measureText avoids clipping at canvas edge.
  // node-canvas/Cairo on this system renders text ~1.55x wider than measureText reports
  // (Pango metric mismatch for weight-900 / "Arial Black"). Threshold 0.50 × actual ~= 0.78 × canvas.
  // fillText maxWidth=0.82×w is the hard safety net against any remaining variance.
  let size = Math.max(18, Math.round(Math.min(w * 0.14, h * 0.28)));
  ctx.font = `bold ${size}px Arial, sans-serif`;
  while (ctx.measureText("VISANT").width > w * 0.50 && size > 18) {
    size -= 2;
    ctx.font = `bold ${size}px Arial, sans-serif`;
  }
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VISANT", w / 2, h / 2, Math.floor(w * 0.82));
  return c;
}

/**
 * Vivid green debug canvas — validates warp, perspective and mask accuracy.
 * Corner triangles + center crosshair + edge ticks make distortion immediately visible.
 */
function makeArtDebugGreen(w: number, h: number): any {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  // Base: vivid lime green
  ctx.fillStyle = "#00E64D";
  ctx.fillRect(0, 0, w, h);
  // Corner triangles — red TL, blue TR, yellow BR, white BL
  const cs = Math.round(Math.min(w, h) * 0.18);
  [[0,0,"#FF2222"],[w,0,"#2255FF"],[w,h,"#FFE000"],[0,h,"#FFFFFF"]].forEach(([cx,cy,col],i) => {
    ctx.fillStyle = col as string;
    ctx.beginPath();
    ctx.moveTo(cx as number, cy as number);
    ctx.lineTo(cx as number + (i===0||i===3?cs:-cs), cy as number);
    ctx.lineTo(cx as number, cy as number + (i===0||i===1?cs:-cs));
    ctx.closePath();
    ctx.fill();
  });
  // Center crosshair
  const lw = Math.max(2, Math.round(Math.min(w,h)*0.012));
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
  // Edge ticks at 25% and 75%
  const tk = Math.round(Math.min(w,h)*0.04);
  for (const frac of [0.25, 0.75]) {
    ctx.beginPath(); ctx.moveTo(w*frac-tk,0); ctx.lineTo(w*frac+tk,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w*frac-tk,h); ctx.lineTo(w*frac+tk,h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,h*frac-tk); ctx.lineTo(0,h*frac+tk); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w,h*frac-tk); ctx.lineTo(w,h*frac+tk); ctx.stroke();
  }
  return c;
}

function makeArt(w: number, h: number, label: string, dark = false): any {
  return dark ? makeArtDark(w, h, label) : makeArtLight(w, h, label);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const { autoDetectSurface, extractSurfaceMaskCV, extractCardMaskCV, findNeonQuad } = await import("../src/lib/photo-detect");
  const { analyzePhoto } = await import("../src/lib/photo-analyze");
  const { extractGrayscaleLayers, extractMask, expandQuad, neutralizeNeonPixels,
          paintQuadMagenta, computeQuadSurfaceStats, extractDisplacementMap,
          extractColorCastLayer } = await import("../src/lib/photo-shadow");
  const { extractMaskSAM, detectQuadSAM } = await import("../src/lib/sam-mask");
  const hasSAM = !!process.env.REPLICATE_API_TOKEN;
  const { buildPhotoSceneDoc } = await import("../src/lib/photo-scene");
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

    const opts = DETECT_OPTS[photo.name] ?? {};

    // ── Phase 1: CV detect (fast, zero cost) ───────────────────────
    console.log(`${ts()} 🔍 CV detecting surface...`);
    let analysis: any;
    try {
      analysis = await autoDetectSurface(photo.path, W, H, opts);
      if (!analysis) {
        console.warn(`${ts()} ⚠ CV found nothing — falling back to LLM`);
      } else {
        const { quad, surfaceType, confidence } = analysis;
        const detW = quad.tr.x - quad.tl.x;
        const detH = quad.bl.y - quad.tl.y;
        console.log(`${ts()} CV: ${surfaceType} | ${detW}×${detH}px | conf ${(confidence * 100).toFixed(0)}%`);
      }
    } catch (e: any) {
      console.warn(`${ts()} ⚠ CV error: ${e.message} — falling back to LLM`);
      analysis = null;
    }

    // ── Phase 1b: Override quad (locked known-good detection) ──────────
    if (photo.overrideQuad && OVERRIDE_QUADS[photo.name]) {
      const ov = OVERRIDE_QUADS[photo.name];
      analysis = { ...ov, imageWidth: W, imageHeight: H, avgLightness: 0.80 };
      const detW = ov.quad.tr.x - ov.quad.tl.x;
      const detH = ov.quad.bl.y - ov.quad.tl.y;
      console.log(`${ts()} 📌 Override: ${ov.surfaceType} | ${detW}×${detH}px`);
    }

    // ── Phase 1c: Neon key-color quad — zero LLM, perspective-accurate ──
    // Skip when overrideQuad is set — manual quad takes priority over CV detection.
    if (photo.neonMagenta && !photo.overrideQuad) {
      const neonQuad = await findNeonQuad(photo.path, W, H);
      if (neonQuad) {
        const detW = Math.round((neonQuad.tr.x + neonQuad.br.x) / 2 - (neonQuad.tl.x + neonQuad.bl.x) / 2);
        const detH = Math.round((neonQuad.bl.y + neonQuad.br.y) / 2 - (neonQuad.tl.y + neonQuad.tr.y) / 2);
        analysis = {
          quad: neonQuad, surfaceType: "billboard", material: "matte",
          hasOcclusion: false, occlusionDesc: "", lightingDir: "ambient",
          confidence: 0.99, imageWidth: W, imageHeight: H, avgLightness: 0.80,
        };
        console.log(`${ts()} 🟢 Neon quad detected: ${detW}×${detH}px (no LLM)`);
      } else {
        console.warn(`${ts()} ⚠️ No neon pixels found — falling back to LLM`);
      }
    }

    // ── Phase 1d: SAM-based quad detection ────────────────────────────
    // For apparel/packaging/outdoor photos where CV/LLM consistently fail.
    // sam: text prompt drives Lang-SAM (tmappdev) — returns pixel mask → bounding quad.
    // SAM quad is used as-is; the mask from SAM replaces the solid-polygon fallback.
    if (photo.sam && !photo.overrideQuad && !photo.neonMagenta && hasSAM) {
      console.log(`${ts()} 🎯 SAM/lang — "${photo.sam}"`);
      const surfType = analysis?.surfaceType ?? "other";
      const samResult = await detectQuadSAM(photo.path, photo.sam, surfType, W, H, "lang");
      if (samResult) {
        const { quad: samQuad } = samResult;
        const detW = samQuad.tr.x - samQuad.tl.x;
        const detH = samQuad.bl.y - samQuad.tl.y;
        // Reject if mask is degenerate (< 5% of image area) — likely wrong detection
        const areaFrac = (detW * detH) / (W * H);
        if (areaFrac >= 0.03) {
          const prevSurfaceType = analysis?.surfaceType ?? "billboard";
          analysis = {
            quad: samQuad, imageWidth: W, imageHeight: H,
            surfaceType: prevSurfaceType, avgLightness: 0.80,
            material: "matte", hasOcclusion: false, occlusionDesc: "",
            lightingDir: "ambient", confidence: 0.92,
          };
          // Save SAM mask for use in mask step (replaces solid polygon)
          (photo as any)._samMaskBuf = samResult.maskBuf;
          console.log(`${ts()} 🎯 SAM quad: ${detW}×${detH}px (${(areaFrac * 100).toFixed(1)}% of image)`);
        } else {
          console.warn(`${ts()} ⚠ SAM mask too small (${(areaFrac * 100).toFixed(1)}%) — skipping`);
        }
      }
    }

    // ── Phase 2: LLM for cards / tilted surfaces / low-confidence CV ──
    // forceLLM: surface has perspective distortion (poster at angle) or occlusion (card).
    // CV row-scan only detects axis-aligned rectangles; LLM gets actual perspective quad.
    // Cache: if {name}-analysis.json already exists, reuse it (avoids LLM re-call variance).
    // Skip LLM entirely when overrideQuad or neonMagenta or SAM already resolved the quad.
    const needsLLM = !photo.overrideQuad && !photo.neonMagenta && !(photo as any)._samMaskBuf && (photo.forceLLM || !analysis || analysis.confidence < 0.4);
    const cachedPath = resolve(OUT, `${photo.name}-analysis.json`);
    if (needsLLM && existsSync(cachedPath)) {
      try {
        const cached = JSON.parse(await import("fs/promises").then(m => m.readFile(cachedPath, "utf8")));
        analysis = cached;
        const { quad, surfaceType, confidence } = analysis;
        const detW = Math.max(quad.tr.x, quad.br.x) - Math.min(quad.tl.x, quad.bl.x);
        const detH = Math.max(quad.bl.y, quad.br.y) - Math.min(quad.tl.y, quad.tr.y);
        console.log(`${ts()} 📋 Cached LLM: ${surfaceType} | ${detW}×${detH}px`);
      } catch { /* fall through to LLM */ }
    } else if (needsLLM) {
      console.log(`${ts()} 🤖 LLM refining quad (card/low-conf)...`);
      try {
        const llmAnalysis = await analyzePhoto(photo.path, W, H);
        if (analysis) {
          analysis = { ...analysis, quad: llmAnalysis.quad, surfaceType: llmAnalysis.surfaceType, confidence: llmAnalysis.confidence };
        } else {
          analysis = { ...llmAnalysis, avgLightness: 0 };
        }
        const { quad, surfaceType, confidence } = analysis;
        const detW = Math.max(quad.tr.x, quad.br.x) - Math.min(quad.tl.x, quad.bl.x);
        const detH = Math.max(quad.bl.y, quad.br.y) - Math.min(quad.tl.y, quad.tr.y);
        console.log(`${ts()} LLM: ${surfaceType} | ${detW}×${detH}px | conf ${(confidence * 100).toFixed(0)}%`);
      } catch (e: any) {
        console.warn(`${ts()} ⚠ LLM failed: ${e.message}`);
        if (!analysis) { console.error(`  ✗ Both CV and LLM failed — skipping`); continue; }
      }
    }

    if (!analysis) { console.error(`${ts()} ✗ No surface detected — skipping`); continue; }
    const { quad } = analysis;
    console.log(`         TL(${quad.tl.x},${quad.tl.y}) TR(${quad.tr.x},${quad.tr.y}) BR(${quad.br.x},${quad.br.y}) BL(${quad.bl.x},${quad.bl.y})`);

    // ── Surface quality gate ──────────────────────────────────────────
    // Pure-white blank (avgLightness > 0.93 + variance < 0.005) = flat CGI surface
    // with zero lighting info: art would render flat and "floating". Two paths:
    //   A) neonMagenta already paints/neutralizes → proceed normally
    //   B) non-neon: paint quad magenta → turn into neon surface → unified neon path
    const origPhotoPath = photo.path;  // capture before quality gate may change photo.path
    if (!photo.neonMagenta) {
      const stats = await computeQuadSurfaceStats(photo.path, W, H, quad);
      const isBlankWhite = stats.avgLightness > 0.93 && stats.variance < 0.005;
      console.log(`${ts()} 📊 Surface stats: L=${stats.avgLightness.toFixed(3)} var=${stats.variance.toFixed(4)}${isBlankWhite ? " → BLANK WHITE" : ""}`);

      if (isBlankWhite) {
        // Paint quad magenta so it flows through unified neon path
        console.log(`${ts()} 🎨 Painting quad magenta (blank surface → neon prep)...`);
        const preppedBuf = await paintQuadMagenta(photo.path, W, H, quad);
        const preppedPath = resolve(OUT, `${photo.name}-prepped.png`);
        await writeFile(preppedPath, preppedBuf);

        // Re-run neon detection on the prepped image
        const neonQuad = await findNeonQuad(preppedPath, W, H);
        if (neonQuad) {
          analysis = { ...analysis, quad: neonQuad };
          // Mark as neon so lighting step neutralizes the painted pixels
          (photo as any).neonMagenta = true;
          (photo as any).path = preppedPath;
          console.log(`${ts()} ✅ Neon quad confirmed on prepped image`);
        } else {
          console.warn(`${ts()} ⚠ Could not re-detect neon on prepped image — rendering with original quad`);
        }
      }
    }

    // Save analysis only if not loaded from cache (to preserve the best LLM detection)
    if (!existsSync(cachedPath)) {
      await writeFile(cachedPath, JSON.stringify(analysis, null, 2));
    }

    // ── Lighting + mask ──────────────────────────────────────────────
    // Surface pixel mask (HSL) filters the lighting overlays: non-surface pixels
    // (fingers, dark clothing, torn-poster bg) stay neutral in screen/multiply.
    // Art face mask:
    //   Card → solid polygon (art fills full card, fingers hidden = standard mockup look)
    //   Wall/poster → pixel-level HSL mask (art only on detected surface pixels,
    //     so torn poster tears / wall joints are visible through the art = authentic look)
    const isCard = analysis.surfaceType === "card" || analysis.surfaceType === "paper";
    const isBillboard = analysis.surfaceType === "billboard" || analysis.surfaceType === "poster";
    console.log(`${ts()} 🔆 Lighting + ${isCard ? "solid-poly" : isBillboard ? "pixel-occlude" : "pixel"} mask...`);

    // Wall multiplyFloor=200: suppresses baked-in watermark artifacts.
    // shadowScene: no watermark → multiplyFloor=0 for full shadow depth (dramatic outdoor effect).
    const multiplyFloor = isCard ? 0 : photo.shadowScene ? 0 : 200;

    // Neon key-color: neutralize magenta→grayscale in photo before mask/lighting.
    // This removes the pink cast so it doesn't bleed around art edges through the mask.
    // Also expand the quad outward to fully cover the neon boundary pixels.
    let photoSource: string | Buffer = photo.path;
    let maskQuad = quad;
    if (photo.neonMagenta) {
      console.log(`${ts()} 🎨 Neutralizing neon pixels → grayscale...`);
      photoSource = await neutralizeNeonPixels(photo.path, W, H);
      maskQuad = expandQuad(quad, 25, W, H);
      // Genuine neon (photo.path unchanged by quality gate): save neutralized for photo-render.ts.
      // Auto-prepped images (photo.path was swapped to preppedPath): photo-render.ts uses
      // the original white image (origPhotoPath) which has no pink — no save needed.
      if (photo.path === origPhotoPath) {
        await writeFile(resolve(OUT, `${photo.name}-photo.png`), photoSource as Buffer);
      }
    }

    // Mask strategy (priority order):
    //  1. SAM lang mask from Phase 1d (already computed while finding quad — free reuse)
    //  2. Grounded SAM via Replicate (precise pixel mask, requires token)
    //  3. Solid polygon: neon → featherPx=0; others feather=4.
    let maskBuf: Buffer;
    if ((photo as any)._samMaskBuf && !photo.debugGreen) {
      maskBuf = (photo as any)._samMaskBuf;
      console.log(`${ts()} 🎯 Reusing SAM/lang mask from Phase 1d`);
    } else if (hasSAM && !photo.debugGreen && !photo.neonMagenta) {
      try {
        const samMask = await extractMaskSAM(photo.path, quad, W, H, analysis.surfaceType);
        if (samMask) {
          maskBuf = samMask;
          console.log(`${ts()} 🎯 Grounded SAM mask OK (${analysis.surfaceType})`);
        } else {
          maskBuf = await extractMask(W, H, maskQuad, 4);
          console.log(`${ts()} ⚠️  SAM skipped (no token) — solid polygon`);
        }
      } catch (e: any) {
        console.warn(`${ts()} ⚠️  SAM error: ${e.message} — solid polygon fallback`);
        maskBuf = await extractMask(W, H, maskQuad, 4);
      }
    } else {
      // Neon: hard edge (featherPx=0), expanded quad — pink already neutralized in photoSource.
      const feather = photo.neonMagenta ? 0 : 4;
      maskBuf = await extractMask(W, H, maskQuad, feather);
      if (!photo.debugGreen && !photo.neonMagenta) console.log(`${ts()} 📐 Solid polygon mask (add REPLICATE_API_TOKEN for Grounded SAM)`);
    }

    // Lighting surface mask:
    //   Card    — separate (L>0.65 S<0.18) to exclude finger skin from multiply.
    //   Wall    — none: quad boundary (inQuad) already excludes sidewalk; no mask means
    //             preBlur smears baked-in text uniformly → no watermark shadow artifact.
    //   Billboard/neon — none (screen=0, multiply=0 anyway).
    const lightingMaskBuf = isCard
      ? await extractSurfaceMaskCV(photo.path, W, H, quad,
          { minLightness: 0.65, maxSaturation: 0.18 }, 0, 0)
      : undefined;

    // Wall/stone: pre-blur σ=25 smears fine watermark strokes (~5-15px) into uniform gray.
    const lightingPreBlur = !isCard && !isBillboard ? 25 : 0;

    // shadowScene: extract lighting from FULL IMAGE so environmental shadows transfer onto art.
    const lightingQuad = photo.shadowScene
      ? { tl: { x: 0, y: 0 }, tr: { x: W, y: 0 }, br: { x: W, y: H }, bl: { x: 0, y: H } }
      : quad;

    // Use neutralized photo as source for lighting extraction on neon images.
    const { screen: screenBuf, multiply: multiplyBuf } = await extractGrayscaleLayers(
      photoSource, lightingQuad, lightingMaskBuf, multiplyFloor, lightingPreBlur
    );

    // Displacement map + color cast layer
    const [dispBuf, castBuf] = await Promise.all([
      extractDisplacementMap(photoSource, W, H, quad, 8),
      extractColorCastLayer(photo.path, W, H, quad),  // use original (pre-neutralize) for color
    ]);

    await Promise.all([
      writeFile(resolve(OUT, `${photo.name}-screen.png`),   screenBuf),
      writeFile(resolve(OUT, `${photo.name}-multiply.png`), multiplyBuf),
      writeFile(resolve(OUT, `${photo.name}-mask.png`),     maskBuf),
      writeFile(resolve(OUT, `${photo.name}-bw.png`),       multiplyBuf),
      writeFile(resolve(OUT, `${photo.name}-disp.png`),     dispBuf),
      writeFile(resolve(OUT, `${photo.name}-cast.png`),     castBuf),
    ]);
    console.log(`${ts()} ✓ screen ${screenBuf.length >> 10}KB  multiply ${multiplyBuf.length >> 10}KB  mask ${maskBuf.length >> 10}KB  disp ${dispBuf.length >> 10}KB  cast ${castBuf.length >> 10}KB`);

    // ── Assets + render ───────────────────────────────────────────────
    console.log(`${ts()} 🖨  Rendering...`);
    // Neon: render the neutralized (P&B neon area) photo instead of original.
    const [photoImg, screenImg, multiplyImg, maskImg] = await Promise.all([
      typeof photoSource === "string" ? loadImage(photoSource) : loadImage(photoSource),
      loadImage(screenBuf),
      loadImage(multiplyBuf),
      loadImage(maskBuf),
    ]);
    const assets: any = {
      photo: photoImg,
      light_screen: screenImg,
      light_multiply: multiplyImg,
      mask: maskImg,
    };

    const doc = buildPhotoSceneDoc(analysis, {
      // Wall: screenOpacity=0 avoids contrast artifact (watermark). Shadow comes through multiply only.
      // poster_shadow: sun/shade outdoor scene — screen brightens sun-hit areas, multiply deepens shadows.
      //   No watermarks so no floor protection needed; full shadow depth.
      screenOpacity:   photo.shadowScene ? 0.20 : 0,
      multiplyOpacity: isCard ? 0.30 : (isBillboard && !photo.shadowScene) ? 0 : 0.45,
    });
    const face = doc.faces[0];
    console.log(`${ts()} ✓ face ${face.innerW}×${face.innerH} | layers: ${doc.layers.map((l: any) => l.src).join(", ")}`);
    // debugGreen: vivid green + markers to validate warp/perspective/mask accuracy visually.
    // Card: dark premium navy. shadowScene: light art (shadows visible). Billboard: bold blue. Wall: light.
    const artCanvas = photo.debugGreen
      ? makeArtDebugGreen(face.innerW, face.innerH)
      : isCard
        ? makeArtDark(face.innerW, face.innerH, analysis.surfaceType)
        : photo.shadowScene
          ? makeArtLight(face.innerW, face.innerH, analysis.surfaceType)
          : isBillboard
            ? makeArtSolid(face.innerW, face.innerH, "#0057FF")
            : makeArtLight(face.innerW, face.innerH, analysis.surfaceType);
    const canvas = renderScene(doc, assets, { surface: artCanvas }, createCanvas);
    const resultBuf: Buffer = (canvas as any).toBuffer("image/png");
    const outPath = resolve(OUT, `${photo.name}-result.png`);
    await writeFile(outPath, resultBuf);
    console.log(`${ts()} ✅ ${outPath.split("\\").pop()} (${resultBuf.length >> 10}KB)`);

    results.push({ name: photo.name, quad: analysis.quad, analysis, ok: true });
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — results in ${OUT}`);
  console.log(`\nDetected quads (CV):`);
  for (const r of results) {
    const q = r.quad;
    const w = Math.max(q.tr.x, q.br.x) - Math.min(q.tl.x, q.bl.x);
    const h = Math.max(q.bl.y, q.br.y) - Math.min(q.tl.y, q.tr.y);
    console.log(`  ${r.name}: ${w}×${h}px | ${r.analysis.surfaceType} | confidence ${(r.analysis.confidence * 100).toFixed(0)}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
