/** Composita o PSD sem nenhuma modificação — baseline para comparar com o Photoshop.
 * Usage: bun scripts/compose-only.ts <psd> <out.png> [--preview N]
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { composePsd } from "../src/lib/psd-compose";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const [psdPath, outPath] = args;
const previewIdx = process.argv.indexOf("--preview");
const previewMaxPx = previewIdx !== -1 ? parseInt(process.argv[previewIdx + 1] || "1200") : 1200;

const agPsd = await import("ag-psd");
const { createCanvas } = await import("canvas");
agPsd.initializeCanvas(createCanvas as any);

const psd = agPsd.readPsd(new Uint8Array(readFileSync(resolve(psdPath))).buffer as ArrayBuffer, { skipThumbnail: true });
const fullCanvas = composePsd(psd, createCanvas as any);

let outCanvas = fullCanvas;
const scale = previewMaxPx / Math.max(psd.width, psd.height);
if (scale < 1) {
  outCanvas = createCanvas(Math.round(psd.width * scale), Math.round(psd.height * scale));
  outCanvas.getContext("2d").drawImage(fullCanvas, 0, 0, outCanvas.width, outCanvas.height);
}
mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), outCanvas.toBuffer("image/png"));
console.log(`wrote ${outPath} (${outCanvas.width}x${outCanvas.height})`);
