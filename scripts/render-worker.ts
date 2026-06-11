import { MockupSDK } from "@printmadehq/mockup-generator";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

function getArg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const psdPath = getArg("psd");
const artPath = getArg("art");
const smartObject = getArg("smart-object", "Your design");
const outputPath = getArg("output", "/tmp/render-output.png");
const hideRaw = getArg("hide");
const hideLayers = hideRaw ? hideRaw.split(",").map((s) => s.trim()) : [];

if (!psdPath || !artPath) {
  console.error("Usage: bun render-worker.ts --psd <path> --art <path> [--smart-object <name>] [--output <path>]");
  process.exit(1);
}

console.log(`Rendering: ${psdPath}`);
console.log(`Art: ${artPath}`);
console.log(`Smart Object: ${smartObject}`);

const psdBuffer = readFileSync(resolve(psdPath));
const artBuffer = readFileSync(resolve(artPath));

const sdk = await MockupSDK.create({ mode: "serverless" });

const replacements: Array<{ name: string; image: Buffer; fillMode: string }> = [
  { name: smartObject, image: artBuffer, fillMode: "fill" },
];

// Hide layers by replacing with transparent pixel
if (hideLayers.length > 0) {
  const sharp = (await import("sharp")).default;
  const transparent = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();

  for (const layer of hideLayers) {
    replacements.push({ name: layer, image: transparent, fillMode: "fill" });
  }
}

const result = await sdk.generate({
  psd: psdBuffer,
  replacements,
  exports: [{ format: "png", quality: 90 }],
});

if (result.exports?.length > 0) {
  writeFileSync(resolve(outputPath), Buffer.from(result.exports[0].buffer));
  console.log(`Output: ${outputPath} (${(result.exports[0].size / 1024).toFixed(0)}KB)`);
} else {
  console.error("No output produced");
  process.exit(1);
}
