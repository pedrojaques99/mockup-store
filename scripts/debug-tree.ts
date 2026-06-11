/**
 * Dump the full layer tree of a PSD with everything relevant to compositing:
 * bounds, hidden, opacity, fill opacity, blend mode, clipping, masks,
 * placedLayer transforms, canvas presence, adjustment types.
 * Usage: bun scripts/debug-tree.ts "<path-to.psd>"
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const psdPath = process.argv[2];
if (!psdPath) {
  console.error("Usage: bun scripts/debug-tree.ts <path.psd>");
  process.exit(1);
}

const agPsd = await import("ag-psd");
const { createCanvas } = await import("canvas");
agPsd.initializeCanvas(createCanvas as any);

const buf = readFileSync(resolve(psdPath));
const psd = agPsd.readPsd(new Uint8Array(buf).buffer as ArrayBuffer, { skipThumbnail: true });

console.log(`PSD ${psd.width}x${psd.height}\n`);

function fmt(n: number | undefined) {
  return n === undefined ? "?" : String(Math.round(n));
}

function describe(layer: any, depth: number) {
  const ind = "  ".repeat(depth);
  const kind = layer.children ? "GROUP" : layer.placedLayer ? "SO" : layer.adjustment ? `ADJ(${layer.adjustment.type})` : layer.text ? "TEXT" : "LAYER";
  const bounds = `[${fmt(layer.left)},${fmt(layer.top)} ${fmt((layer.right ?? 0) - (layer.left ?? 0))}x${fmt((layer.bottom ?? 0) - (layer.top ?? 0))}]`;
  const flags = [
    layer.hidden ? "HIDDEN" : "",
    layer.clipping ? "CLIP" : "",
    layer.mask ? `MASK[${fmt(layer.mask.left)},${fmt(layer.mask.top)} ${fmt((layer.mask.right ?? 0) - (layer.mask.left ?? 0))}x${fmt((layer.mask.bottom ?? 0) - (layer.mask.top ?? 0))}${layer.mask.disabled ? " disabled" : ""}${layer.mask.canvas ? " cv" : " nocv"}]` : "",
    layer.canvas ? `cv${layer.canvas.width}x${layer.canvas.height}` : "nocanvas",
    layer.opacity !== undefined && layer.opacity < 1 ? `op=${layer.opacity.toFixed(2)}` : "",
    layer.fillOpacity !== undefined && layer.fillOpacity < 1 ? `fill=${layer.fillOpacity.toFixed(2)}` : "",
    layer.blendMode && layer.blendMode !== "normal" && layer.blendMode !== "pass through" ? `blend=${layer.blendMode}` : "",
    layer.effects ? `FX(${Object.keys(layer.effects).filter(k => k !== "disabled").join(",")})${layer.effects.disabled ? " disabled" : ""}` : "",
    layer.vectorMask ? "VECMASK" : "",
  ].filter(Boolean).join(" ");

  console.log(`${ind}${kind} "${layer.name}" ${bounds} ${flags}`);

  if (layer.placedLayer) {
    const pl = layer.placedLayer;
    console.log(`${ind}   placed: ${pl.width}x${pl.height} transform=[${(pl.transform || []).map((n: number) => Math.round(n)).join(",")}]`);
    if (pl.nonAffineTransform) {
      const same = JSON.stringify(pl.transform) === JSON.stringify(pl.nonAffineTransform);
      console.log(`${ind}   nonAffine${same ? "=transform" : `=[${pl.nonAffineTransform.map((n: number) => Math.round(n)).join(",")}]`}`);
    }
  }

  for (const child of layer.children || []) describe(child, depth + 1);
}

for (const child of psd.children || []) describe(child, 0);
