/**
 * Debug CV detection — samples HSL distribution in a known card region
 * to tune thresholds for detectWhiteSurface.
 * bun scripts/debug-cv-detect.ts
 */
import sharp from "sharp";

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

const PHOTOS = [
  {
    name: "card",
    path: "Z:/BOXY/Lab/Bases IA/man black clothes card to face.png",
    // GPT-4o detected card region (from previous test)
    region: { x1: 640, y1: 627, x2: 1920, y2: 986 },
  },
  {
    name: "poster",
    path: "Z:/BOXY/Lab/Bases IA/visant.co_interesting_angle_shots_photography_of_a_blank_poster_197b3d03-f266-48da-b378-24eadb13cf83.png",
    // Upper-center of poster white area (approx)
    region: { x1: 600, y1: 200, x2: 2700, y2: 900 },
  },
  {
    name: "wall",
    path: "Z:/BOXY/Lab/Bases IA/IN-SITU-007_HOVER-1465x980.png",
    // Known wall region (GPT-4o detected y: 196–588)
    region: { x1: 0, y1: 196, x2: 1260, y2: 588 },
  },
];

async function analyzeRegion(path: string, name: string, region: { x1: number; y1: number; x2: number; y2: number }) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const { x1, y1, x2, y2 } = region;

  const lValues: number[] = [], sValues: number[] = [];
  let sampleCount = 0;

  for (let y = y1; y <= y2; y += 4) {
    for (let x = x1; x <= x2; x += 4) {
      const i = (y * width + x) * channels;
      const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      lValues.push(l);
      sValues.push(s);
      sampleCount++;
    }
  }

  lValues.sort((a, b) => a - b);
  sValues.sort((a, b) => a - b);

  const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p)];

  console.log(`\n[${name}] region (${x2 - x1}×${y2 - y1}px) — ${sampleCount} samples`);
  console.log(`  Lightness: P05=${pct(lValues, 0.05).toFixed(3)} P25=${pct(lValues, 0.25).toFixed(3)} P50=${pct(lValues, 0.50).toFixed(3)} P75=${pct(lValues, 0.75).toFixed(3)} P95=${pct(lValues, 0.95).toFixed(3)}`);
  console.log(`  Saturation: P05=${pct(sValues, 0.05).toFixed(3)} P25=${pct(sValues, 0.25).toFixed(3)} P50=${pct(sValues, 0.50).toFixed(3)} P75=${pct(sValues, 0.75).toFixed(3)} P95=${pct(sValues, 0.95).toFixed(3)}`);

  // Count qualifying pixels at different thresholds
  for (const [minL, maxS] of [[0.55, 0.25], [0.60, 0.22], [0.65, 0.20], [0.68, 0.18], [0.72, 0.15]]) {
    const count = lValues.filter((l, i) => l >= minL && sValues[i] <= maxS).length;
    console.log(`  L>=${minL} S<=${maxS}: ${count}/${sampleCount} = ${(count / sampleCount * 100).toFixed(1)}%`);
  }
}

// Also run full-row scan to see what the row coverage looks like for card
async function rowScan(path: string, width: number, height: number, minL: number, maxS: number) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;

  console.log(`\nRow coverage scan (L>=${minL} S<=${maxS})`);
  const activeRows: number[] = [];
  for (let y = 600; y <= 1000; y += 10) {
    let qualified = 0, total = 0;
    for (let x = 0; x < width; x += 3) {
      const i = (y * width + x) * ch;
      const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      total++;
      if (l >= minL && s <= maxS) qualified++;
    }
    const frac = qualified / total;
    if (frac > 0.05) activeRows.push(y);
    if (frac > 0.10) console.log(`  y=${y}: ${(frac * 100).toFixed(1)}% (${qualified}/${total})`);
  }
  console.log(`  Active rows (>5%): ${activeRows.join(", ")}`);
}

async function main() {
  for (const photo of PHOTOS) {
    await analyzeRegion(photo.path, photo.name, photo.region);
  }

  // Extra: row scan for card
  console.log("\n--- Card row scan ---");
  const cardMeta = await sharp("Z:/BOXY/Lab/Bases IA/man black clothes card to face.png").metadata();
  await rowScan("Z:/BOXY/Lab/Bases IA/man black clothes card to face.png", cardMeta.width!, cardMeta.height!, 0.55, 0.25);
}

main().catch(console.error);
