/**
 * Render direto (sem servidor TCP) — mesma pipeline do render-server.
 * Usage: bun scripts/render-cli.ts <psd> <art> <out.png> [smartObjectName] [--preview N]
 *        slots extras: --slot "<soName>::<artPath>" (repetível, p/ PSDs multi-face)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname, basename } from "path";
import {
  flattenLayers,
  replaceLinkedSmartObjects,
  composePsd,
  resolveSoTarget,
  preloadDisplacementMaps,
  applyHideRules,
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

await preloadDisplacementMaps(
  allLayers, psdPath, createCanvas as any,
  { exists: existsSync, read: (p) => readFileSync(p), resolve, dirname, basename },
  (buf, opts) => agPsd.readPsd(buf, opts),
  (msg) => step(`WARN: ${msg}`)
);

const smartObjects = allLayers.filter((l: any) => l.placedLayer);
step(`SOs: ${smartObjects.map((l: any) => `"${l.name}"${l.hidden ? "(hidden)" : ""}`).join(", ")}`);

const slots = [{ so: soNameArg || "Your design", art: artPath }, ...extraSlots];
const replacedNames = new Set<string>();
for (const slot of slots) {
  const artImg = await loadImage(readFileSync(resolve(slot.art)));
  const target = resolveSoTarget(allLayers, slot.so);
  if (!target) {
    console.error(`No smart object target found for "${slot.so}"`);
    process.exit(1);
  }
  step(`target "${target.name}" placedId=${target.placedLayer?.id ?? "none"} ← ${slot.art.split(/[/\\]/).pop()}`);
  const replaced = replaceLinkedSmartObjects(allLayers, target, artImg, createCanvas as any);
  step(`replaced: ${replaced.map((r) => `"${r.name}" ${r.width}x${r.height}${r.warped ? " warp" : ""}`).join(", ")}`);
  for (const r of replaced) replacedNames.add(r.name);
}

applyHideRules(allLayers, replacedNames);
step(`hide rules applied`);

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
