/**
 * eval-quads — mede o detector unificado contra os quads golden (ground-truth).
 *
 * Para cada entrada de Render/New Mockups/quads.json, roda detectKeyColorQuad na
 * cena e compara o quad detectado com o quad calibrado via IoU. É o gate que torna
 * evoluir o detector seguro: nenhuma mudança no núcleo deve baixar o IoU médio.
 *
 *   npx tsx --env-file=.env.local scripts/eval-quads.ts
 *   bun scripts/eval-quads.ts
 */
import { join } from "path";
import sharp from "sharp";
import { loadQuads, NEW_MOCKUPS_DIR } from "../src/lib/quad-store";
import { detectKeyColorQuad } from "../src/lib/photo-detect";
import { quadIoU } from "../src/lib/key-color-core";

async function main() {
  const golden = await loadQuads();
  const names = Object.keys(golden);
  if (!names.length) {
    console.log("Nenhum quad golden ainda. Calibre cenas em /calibrate primeiro.");
    return;
  }

  const rows: Array<{ name: string; iou: number; conf: number }> = [];
  for (const name of names) {
    const entry = golden[name];
    const full = join(NEW_MOCKUPS_DIR, name);
    try {
      const m = await sharp(full).metadata();
      const res = await detectKeyColorQuad(full, m.width!, m.height!);
      if (!res) { rows.push({ name, iou: 0, conf: 0 }); continue; }
      rows.push({ name, iou: quadIoU(res.quad, entry.quad), conf: res.confidence });
    } catch (e: any) {
      console.warn(`  ⚠ ${name}: ${e.message}`);
      rows.push({ name, iou: 0, conf: 0 });
    }
  }

  rows.sort((a, b) => a.iou - b.iou);
  console.log("\nIoU detector × golden:\n");
  for (const r of rows) {
    const bar = "█".repeat(Math.round(r.iou * 20)).padEnd(20, "·");
    console.log(`  ${bar} ${(r.iou * 100).toFixed(1).padStart(5)}%  conf ${(r.conf * 100).toFixed(0).padStart(3)}%  ${r.name}`);
  }
  const mean = rows.reduce((s, r) => s + r.iou, 0) / rows.length;
  const median = rows[Math.floor(rows.length / 2)].iou;
  console.log(`\n  média ${(mean * 100).toFixed(1)}%  ·  mediana ${(median * 100).toFixed(1)}%  ·  n=${rows.length}`);
  console.log(`  piores: ${rows.slice(0, 3).map((r) => `${r.name} (${(r.iou * 100).toFixed(0)}%)`).join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
