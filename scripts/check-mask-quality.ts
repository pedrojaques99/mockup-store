/** Quick mask quality check — reports white pixel coverage and edge stats. */
import sharp from "sharp";
import { existsSync } from "fs";

const MASKS = [
  { name: "card",   path: ".tmp/photo-test-cv/card-mask.png",   expectedCoverage: [0.3, 0.9] },
  { name: "poster", path: ".tmp/photo-test-cv/poster-mask.png", expectedCoverage: [0.3, 0.9] },
  { name: "wall",   path: ".tmp/photo-test-cv/wall-mask.png",   expectedCoverage: [0.7, 1.0] },
];

async function main() {
  for (const m of MASKS) {
    if (!existsSync(m.path)) { console.log(`[${m.name}] not found`); continue; }
    const { data, info } = await sharp(m.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = info.width * info.height;
    let white = 0, gray = 0, black = 0;
    for (let i = 0; i < px; i++) {
      const v = data[i * 4]; // R channel
      if (v > 200) white++;
      else if (v > 50) gray++;
      else black++;
    }
    const cov = white / px;
    const ok = cov >= m.expectedCoverage[0] && cov <= m.expectedCoverage[1];
    console.log(`[${m.name}] ${info.width}×${info.height}px | white=${(white/px*100).toFixed(1)}% gray=${(gray/px*100).toFixed(1)}% black=${(black/px*100).toFixed(1)}% ${ok ? "✓" : "⚠"}`);
  }
}
main().catch(console.error);
