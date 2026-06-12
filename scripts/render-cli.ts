/**
 * Render direto (sem servidor TCP) — mesma pipeline do render-server.
 * Usage: bun scripts/render-cli.ts <psd> <art> <out.png> [smartObjectName] [--preview N]
 *        slots extras: --slot "<soName>::<artPath>" (repetível, p/ PSDs multi-face)
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import {
  SO_TARGET as SO_PATTERNS,
  BRAND_HIDE,
  flattenLayers,
  replaceLinkedSmartObjects,
  composePsd,
} from "@visant/psd-engine";

const rawArgs = process.argv.slice(2);
const extraSlots: Array<{ so: string; art: string }> = [];
const args: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--slot") {
    const [so, art] = (rawArgs[++i] || "").split("::");
    if (so && art) extraSlots.push({ so, art });
  } else if (!rawArgs[i].startsWith("--")) {
    args.push(rawArgs[i]);
  }
}
const [psdPath, artPath, outPath, soNameArg] = args;
const previewIdx = process.argv.indexOf("--preview");
const previewMaxPx = previewIdx !== -1 ? parseInt(process.argv[previewIdx + 1] || "1200") : 0;

if (!psdPath || !artPath || !outPath) {
  console.error("Usage: bun scripts/render-cli.ts <psd> <art> <out.png> [soName] [--preview N] [--slot so::art]...");
  process.exit(1);
}

const t0 = Date.now();
const step = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

const agPsd = await import("ag-psd");
const { createCanvas, loadImage } = await import("canvas");
agPsd.initializeCanvas(createCanvas as any);

step(`reading ${psdPath}`);
const psdBuffer = readFileSync(resolve(psdPath));
const psd = agPsd.readPsd(new Uint8Array(psdBuffer).buffer as ArrayBuffer, { skipThumbnail: true });
step(`parsed ${psd.width}x${psd.height}`);

const allLayers = flattenLayers(psd.children || []);
const smartObjects = allLayers.filter((l: any) => l.placedLayer);
step(`SOs: ${smartObjects.map((l: any) => `"${l.name}"${l.hidden ? "(hidden)" : ""}`).join(", ")}`);

const byArea = (a: any, b: any) =>
  (b.right - b.left) * (b.bottom - b.top) > (a.right - a.left) * (a.bottom - a.top) ? b : a;
const findTarget = (soName: string) => {
  const patternMatches = smartObjects.filter((l: any) => SO_PATTERNS.test(l.name || ""));
  return (
    allLayers.find((l: any) => l.path === soName) ||
    allLayers.find((l: any) => l.name === soName) ||
    allLayers.find((l: any) => l.path?.toLowerCase().includes(soName.toLowerCase())) ||
    allLayers.find((l: any) => l.name?.toLowerCase().includes(soName.toLowerCase())) ||
    (smartObjects.length === 1 ? smartObjects[0] : null) ||
    (patternMatches.length ? patternMatches.reduce(byArea) : null) ||
    (smartObjects.length ? smartObjects.reduce(byArea) : null)
  );
};

const slots = [{ so: soNameArg || "Your design", art: artPath }, ...extraSlots];
const replacedNames = new Set<string>();
for (const slot of slots) {
  const artImg = await loadImage(readFileSync(resolve(slot.art)));
  const target = findTarget(slot.so);
  if (!target) {
    console.error(`No smart object target found for "${slot.so}"`);
    process.exit(1);
  }
  step(`target "${target.name}" placedId=${target.placedLayer?.id ?? "none"} ← ${slot.art.split(/[/\\]/).pop()}`);
  const replaced = replaceLinkedSmartObjects(allLayers, target, artImg, createCanvas as any);
  step(`replaced: ${replaced.map((r) => `"${r.name}" ${r.width}x${r.height}${r.warped ? " warp" : ""}`).join(", ")}`);
  for (const r of replaced) replacedNames.add(r.name);
}
for (const layer of allLayers) {
  if (BRAND_HIDE.test(layer.name || "") && !replacedNames.has(layer.name)) {
    if (layer.__original) layer.__original.hidden = true;
    step(`hide "${layer.name}"`);
  }
}

step("compositing...");
const fullCanvas = composePsd(psd, createCanvas as any);
step("composited");

let outCanvas = fullCanvas;
if (previewMaxPx > 0) {
  const scale = previewMaxPx / Math.max(psd.width, psd.height);
  if (scale < 1) {
    outCanvas = createCanvas(Math.round(psd.width * scale), Math.round(psd.height * scale));
    outCanvas.getContext("2d").drawImage(fullCanvas, 0, 0, outCanvas.width, outCanvas.height);
  }
}

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), outCanvas.toBuffer("image/png"));
step(`wrote ${outPath} (${outCanvas.width}x${outCanvas.height})`);
